'use strict';
const { app, BrowserWindow, ipcMain, dialog, session, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { Worker } = require('node:worker_threads');
require('./src/offline').denyNetwork();
if (require('electron-squirrel-startup')) app.quit();

// Direct local files and OS IPC only: no web server, updater or remote debugger.
for (const flag of ['disable-background-networking','disable-component-update','disable-domain-reliability','disable-sync','no-pings','disable-breakpad']) app.commandLine.appendSwitch(flag);
app.commandLine.appendSwitch('host-resolver-rules','MAP * ~NOTFOUND');
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy','disable_non_proxied_udp');
app.commandLine.appendSwitch('disable-features','MediaRouter,OptimizationHints,AutofillServerCommunication,WebRtcHideLocalIpsWithMdns');
app.commandLine.appendSwitch('no-proxy-server');
if (process.env.SATOSHI_TEST_DATA && !app.isPackaged) app.setPath('userData',path.resolve(process.env.SATOSHI_TEST_DATA));
app.setName('Satoshi Trace');
let win, worker, nextId = 0, activeJob = false;
const pending = new Map(), cancellation = new SharedArrayBuffer(4);
const indexPath = path.join(__dirname,'index.html');
function request(action,payload) {
  return new Promise((resolve,reject) => {
    const id = ++nextId; pending.set(id,{resolve,reject});
    worker.postMessage({ id, action, payload });
  });
}
function handle(channel, fn) {
  ipcMain.handle(channel,async (event,payload) => {
    let localMainFrame = false;
    try {
      const { fileURLToPath } = require('node:url');
      localMainFrame = !event.senderFrame.parent && path.resolve(fileURLToPath(event.senderFrame.url)).toLowerCase() === path.resolve(indexPath).toLowerCase();
    } catch {}
    if (event.sender !== win?.webContents || !localMainFrame) throw new Error('Untrusted IPC sender.');
    return fn(payload);
  });
}
async function job(action,payload) {
  if (activeJob) throw new Error('Another operation is already running.');
  activeJob = true; Atomics.store(new Int32Array(cancellation),0,0);
  win.webContents.send('job-progress',{ phase:'Starting',percent:0 });
  try { return await request(action,payload); }
  finally { activeJob = false; if (!win.isDestroyed()) win.webContents.send('job-progress',null); }
}
app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((contents,permission,callback)=>callback(false));
  ses.setPermissionCheckHandler(()=>false);
  ses.on('will-download',event=>event.preventDefault());
  ses.webRequest.onBeforeRequest({ urls:['<all_urls>'] },(details,callback)=> {
    let allowed = false;
    try {
      const url = new URL(details.url);
      if (url.protocol === 'file:') {
        const { fileURLToPath } = require('node:url');
        const relative = path.relative(__dirname,fileURLToPath(url));
        allowed = !relative.startsWith('..') && !path.isAbsolute(relative);
      }
    } catch {}
    callback({ cancel:!allowed });
  });
  worker = new Worker(path.join(__dirname,'src','worker.js'),{workerData:{database:path.join(app.getPath('userData'),'evidence','case.sqlite'),cancellation}});
  worker.on('message',message=> {
    if ('progress' in message) { if (win && !win.isDestroyed()) win.webContents.send('job-progress',message.progress); return; }
    const waiting = pending.get(message.id); if (!waiting) return;
    pending.delete(message.id); message.error ? waiting.reject(new Error(message.error)) : waiting.resolve(message.result);
  });
  worker.on('error',error=> { for (const p of pending.values()) p.reject(error); pending.clear(); if (win && !win.isDestroyed()) win.webContents.send('fatal-error',error.message); });
  worker.on('exit',code=> { if (code !== 0) { for (const p of pending.values()) p.reject(new Error(`Evidence worker stopped (${code}). Restart the application.`)); pending.clear(); } });
  handle('summary',()=>request('summary'));
  handle('page',payload=>request('page',payload));
  handle('detail',payload=>request('detail',payload));
  handle('cluster',payload=>request('cluster',payload));
  handle('review',payload=>request('review',payload));
  handle('errors',payload=>request('errors',payload));
  handle('model',()=>request('model'));
  handle('analyze',()=>job('analyze'));
  handle('cancel',()=>{Atomics.store(new Int32Array(cancellation),0,1);return true;});
  handle('import',async()=> {
    const selection = await dialog.showOpenDialog(win,{title:'Import offline evidence',properties:['openFile','multiSelections'],filters:[{name:'Bitcoin metadata',extensions:['csv','json','xml']}]});
    if (selection.canceled) return null;
    for (const file of selection.filePaths) if (file.startsWith('\\\\')) throw new Error('Network-share paths are not allowed. Copy evidence to a local drive first.');
    return job('import',{files:selection.filePaths});
  });
  handle('export',async payload=> {
    const format = payload?.format === 'csv' ? 'csv' : 'json';
    const selected = await dialog.showSaveDialog(win,{title:'Export investigative leads',defaultPath:`satoshi-leads-${Date.now()}.${format}`,filters:[{name:format.toUpperCase(),extensions:[format]}]});
    if (selected.canceled) return null;
    if (selected.filePath.startsWith('\\\\')) throw new Error('Use a local path.');
    const temp = selected.filePath+`.${Date.now()}.partial`;
    try {const result = await job('export',{file:temp,format});fs.renameSync(temp,selected.filePath);return {...result,file:selected.filePath};}
    catch(error) {try {fs.unlinkSync(temp);} catch {} throw error;}
  });
  handle('environment',()=>({application:app.getVersion(),electron:process.versions.electron,node:process.versions.node,database:path.join(app.getPath('userData'),'evidence','case.sqlite'),transport:'Electron IPC / worker MessagePort',network:'Blocked',ports:0}));
  win = new BrowserWindow({width:1480,height:960,minWidth:1060,minHeight:720,backgroundColor:'#f4f6f9',title:'Satoshi Trace · Offline Bitcoin Forensics',webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,webviewTag:false,devTools:!app.isPackaged,spellcheck:false}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  win.webContents.on('will-attach-webview',event=>event.preventDefault());
  await win.loadFile(indexPath);
}).catch(error=>{dialog.showErrorBox('Satoshi Trace could not start',error.message);app.quit();});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{Atomics.store(new Int32Array(cancellation),0,1);worker?.terminate();});
