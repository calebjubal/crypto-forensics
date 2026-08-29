'use strict';
const { parentPort, workerData } = require('node:worker_threads');
require('./offline').denyNetwork();
const { openDatabase, importFile, summary, page, detail, clusterDetail, review } = require('./database');
const { analyze } = require('./analytics');
const { exportReport } = require('./export');
const db = openDatabase(workerData.database);
const cancellation = new Int32Array(workerData.cancellation);
const cancelled = () => Atomics.load(cancellation,0) === 1;
let busy = false;
parentPort.on('message', async ({ id, action, payload = {} }) => {
  if (busy) { parentPort.postMessage({ id, error: 'A background job is running. Please wait for it to finish.' }); return; }
  busy = true;
  const progress = value => parentPort.postMessage({ id, progress: value });
  try {
    let result;
    switch (action) {
      case 'summary': result = summary(db); break;
      case 'page': result = page(db,payload.type,payload.options); break;
      case 'detail': result = detail(db,payload.txid); break;
      case 'cluster': result = clusterDetail(db,payload.id); break;
      case 'review': result = review(db,payload); break;
      case 'import': {
        result = [];
        for (const file of payload.files) { if (cancelled()) break; result.push(await importFile(db,file,progress,cancelled)); }
        break;
      }
      case 'analyze': result = analyze(db,progress,cancelled); break;
      case 'errors': result = db.prepare('SELECT * FROM import_errors WHERE import_id=? ORDER BY row_number LIMIT 200').all(payload.id); break;
      case 'model': {
        const run = db.prepare('SELECT id,created,revision,transaction_count,config FROM analysis_runs ORDER BY rowid DESC LIMIT 1').get();
        result = { run, audit: db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 100').all() }; break;
      }
      case 'export': result = await exportReport(db,payload.file,payload.format,cancelled); break;
      case 'close': db.close(); result = true; break;
      default: throw new Error('Unknown worker operation.');
    }
    parentPort.postMessage({ id, result });
  } catch (error) { parentPort.postMessage({ id, error: error.message }); }
  finally { busy = false; }
});
