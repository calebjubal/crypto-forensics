'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const invoke = channel => payload => ipcRenderer.invoke(channel,payload);
contextBridge.exposeInMainWorld('forensics',{
  summary:invoke('summary'),page:invoke('page'),detail:invoke('detail'),cluster:invoke('cluster'),review:invoke('review'),
  errors:invoke('errors'),model:invoke('model'),analyze:invoke('analyze'),cancel:invoke('cancel'),importFiles:invoke('import'),
  loadDemo:invoke('demo'),templates:invoke('templates'),exportReport:invoke('export'),environment:invoke('environment'),
  onProgress:callback=>{const listener=(_,value)=>callback(value);ipcRenderer.on('job-progress',listener);return ()=>ipcRenderer.removeListener('job-progress',listener);},
  onFatal:callback=>ipcRenderer.on('fatal-error',(_,message)=>callback(message)),
});
