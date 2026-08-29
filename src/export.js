'use strict';

const fs = require('node:fs');
const { once } = require('node:events');
const { audit } = require('./database');

// Prevent spreadsheet formula execution in exported text cells.
function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"'+text.replaceAll('"','""')+'"';
}

async function exportReport(db, file, format = 'json', cancelled = () => false, context = {}) {
  if (!['csv','json'].includes(format)) throw new Error('Unsupported report format.');
  const stream = fs.createWriteStream(file, { flags: 'wx' });
  let failure;
  stream.on('error', error => { failure = error; });
  async function write(value) { if (failure) throw failure; if (!stream.write(value)) await once(stream,'drain'); }
  try {
    const run = db.prepare('SELECT * FROM analysis_runs ORDER BY rowid DESC LIMIT 1').get();
    const imports = db.prepare('SELECT * FROM imports ORDER BY created').all();
    const revision = Number(db.prepare("SELECT value FROM metadata WHERE key='revision'").get().value);
    const metadata = { application: 'Satoshi Trace', exportedAt: new Date().toISOString(), schemaVersion: 1,
      warning: 'Investigative hypotheses only. Scores are not probabilities of wrongdoing. IP observations do not establish wallet ownership. Source geo/ASN is supplied metadata, not verified geolocation.',
      stale: !run || run.revision !== revision, analysis: run ? {...run, config: JSON.parse(run.config), model: JSON.parse(run.model)} : null, imports };
    if (format === 'json') await write(JSON.stringify(metadata).slice(0,-1)+',"leads":[\n');
    else await write(['txid','score','priority','category','status','explanation','notes','run_id','results_stale'].map(csvCell).join(',')+'\r\n');
    let count = 0;
    for (const row of db.prepare(`SELECT l.*,coalesce(r.status,'New') AS status,coalesce(r.notes,'') AS notes FROM lead_scores l LEFT JOIN lead_reviews r ON r.txid=l.txid WHERE l.score>=25 ORDER BY score DESC,txid`).iterate()) {
      if (cancelled()) throw new Error('Export cancelled.');
      row.reasons = JSON.parse(row.reasons); row.features = JSON.parse(row.features);
      if (format === 'json') {
        row.observations = db.prepare('SELECT * FROM observations WHERE txid=? ORDER BY ts_ms,id').all(row.txid);
        row.blockchain = db.prepare('SELECT * FROM transactions WHERE txid=?').get(row.txid);
        row.provenance = db.prepare('SELECT p.* FROM provenance p JOIN observations o ON o.id=p.observation_id WHERE o.txid=?').all(row.txid);
        await write((count ? ',\n':'')+JSON.stringify(row));
      } else await write([row.txid,row.score,row.priority,row.category,row.status,row.reasons.map(r=>`${r.code} (+${r.points}): ${r.explanation}`).join(' | '),row.notes,row.run_id,metadata.stale].map(csvCell).join(',')+'\r\n');
      count++;
    }
    if (format === 'json') await write('],"audit":'+JSON.stringify(db.prepare('SELECT * FROM audit ORDER BY id').all())+'}');
    stream.end(); await once(stream,'finish');
    audit(db,'report.exported',{ format, leads: count },context);
    return { file, count };
  } catch(error) { stream.destroy(); throw error; }
}
module.exports = { exportReport, csvCell };
