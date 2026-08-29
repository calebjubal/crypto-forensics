'use strict';

const { randomUUID, createHash } = require('node:crypto');
const { train, score: isolationScore, seededRandom } = require('./isolation-forest');
const { audit } = require('./database');
const { hash } = require('./validation');
const FEATURE_NAMES = ['log_output_btc', 'fee_ratio', 'log_inputs', 'log_outputs', 'log_observations', 'log_sources', 'log_observation_span_seconds', 'log_source_minute_transactions'];
const RULE_VERSION = '1.0.0';

function vector(row) {
  return [Math.log1p(row.output_sat / 1e8), row.input_sat ? row.fee_sat / row.input_sat : 0,
    Math.log1p(row.inputs), Math.log1p(row.outputs), Math.log1p(row.observations), Math.log1p(row.sources),
    Math.log1p(row.span_ms / 1000), Math.log1p(row.burst)];
}
function median(values) {
  const sorted = values.slice().sort((a, b) => a - b), n = sorted.length;
  return n ? (sorted[Math.floor(n / 2)] + sorted[Math.floor((n - 1) / 2)]) / 2 : 0;
}
function* chunks(db, sql, cursorColumn) {
  let cursor = '';
  const statement = db.prepare(`${sql} WHERE ${cursorColumn}>? ORDER BY ${cursorColumn} LIMIT 1000`);
  while (true) {
    const rows = statement.all(cursor);
    if (!rows.length) return;
    yield* rows;
    cursor = String(rows[rows.length - 1][cursorColumn]);
  }
}

function reasonsFor(row, anomaly, baseline) {
  const reasons = [];
  const add = (code, category, points, explanation) => reasons.push({ code, category, points, explanation });
  const amount = row.output_sat / 1e8, ratio = row.input_sat ? row.fee_sat / row.input_sat : 0;
  if (amount >= 100 && Math.log1p(amount) > baseline.amountCutoff) add('VALUE_OUTLIER', 'Value anomaly', 25, `${amount.toFixed(8)} BTC output exceeds 100 BTC and the robust dataset cutoff of ${Math.expm1(baseline.amountCutoff).toFixed(4)} BTC. Large transfers can be legitimate.`);
  if (ratio > 0.05 && row.fee_sat >= 10000) add('HIGH_FEE', 'Fee anomaly', 28, `Fee is ${(ratio * 100).toFixed(2)}% of input value (${(row.fee_sat / 1e8).toFixed(8)} BTC); threshold is >5% and ≥0.0001 BTC. Incomplete input metadata can produce misleading fees.`);
  if (row.outputs >= 10) add('FAN_OUT', 'Transaction structure', 20, `${row.outputs} outputs meet the ≥10-output fan-out threshold. Exchange payouts and batching are common benign explanations.`);
  if (row.inputs >= 10 && !row.coinjoin) add('CONSOLIDATION', 'Transaction structure', 18, `${row.inputs} inputs meet the ≥10-input consolidation threshold. This does not establish illicit activity.`);
  if (row.burst >= 12) add('SOURCE_BURST', 'Network burst', 28, `A source IP associated with this TXID observed ${row.burst} distinct TXIDs within one UTC minute; threshold is ≥12. Relays, NAT and shared infrastructure can explain this pattern.`);
  if (row.observations >= 30 && row.sources >= 8) add('PROPAGATION', 'Propagation pattern', 10, `${row.observations} observations across ${row.sources} source IPs. Coverage differences and normal propagation can explain this.`);
  if (anomaly !== null && anomaly >= 0.55) {
    const points = anomaly >= 0.62 ? 22 : 12;
    add('ISOLATION_FOREST', 'Statistical outlier', points, `Isolation Forest score ${anomaly.toFixed(3)} exceeds 0.55${anomaly >= 0.62 ? ' (strong threshold 0.62)' : ''}. This is relative unusualness, not a probability of wrongdoing. Inspect the measured features against the saved baseline.`);
  }
  if (row.coinjoin) add('COLLABORATIVE_CAUTION', 'Clustering caution', 0, 'At least 3 inputs and 3 equal-valued outputs suggest a possible collaborative transaction. Common-input clustering was excluded for this transaction; this pattern is not itself suspicious.');
  return reasons;
}

function analyze(db, onProgress = () => {}, cancelled = () => false) {
  const check = () => { if (cancelled()) throw new Error('Analysis cancelled; previous results preserved.'); };
  const total = db.prepare('SELECT count(*) AS n FROM transactions').get().n;
  if (!total) throw new Error('Import evidence before running analysis.');
  const id = randomUUID(), created = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    onProgress({ phase: 'Correlating exact TXIDs and UTC observation windows', percent: 5 });
    check();
    db.exec(`DROP TABLE IF EXISTS temp.source_minutes; DROP TABLE IF EXISTS temp.tx_bursts; DROP TABLE IF EXISTS temp.features;
      CREATE TEMP TABLE source_minutes AS SELECT src_ip,CAST(ts_ms/60000 AS INTEGER) AS minute,count(DISTINCT txid) AS n FROM observations GROUP BY src_ip,minute;
      CREATE INDEX temp.source_minutes_idx ON source_minutes(src_ip,minute);
      CREATE TEMP TABLE tx_bursts AS SELECT o.txid,max(s.n) AS burst FROM observations o JOIN source_minutes s ON s.src_ip=o.src_ip AND s.minute=CAST(o.ts_ms/60000 AS INTEGER) GROUP BY o.txid;
      CREATE UNIQUE INDEX temp.tx_bursts_idx ON tx_bursts(txid);
      CREATE TEMP TABLE features AS SELECT t.txid,t.output_sat,t.input_sat,t.fee_sat,t.coinjoin,
        json_array_length(t.input_addresses) AS inputs,json_array_length(t.output_addresses) AS outputs,
        count(o.id) AS observations,count(DISTINCT o.src_ip) AS sources,
        max(o.ts_ms)-min(o.ts_ms) AS span_ms,b.burst
        FROM transactions t JOIN observations o ON o.txid=t.txid JOIN tx_bursts b ON b.txid=t.txid GROUP BY t.txid;
      CREATE UNIQUE INDEX temp.features_idx ON features(txid);`);
    check();
    const random = seededRandom(73129), reservoir = [], digest = createHash('sha256');
    let seen = 0;
    for (const row of chunks(db,'SELECT * FROM features','txid')) {
      check(); const values = vector(row); digest.update(JSON.stringify(row)); seen++;
      if (reservoir.length < 8192) reservoir.push(values);
      else { const position = Math.floor(random() * seen); if (position < 8192) reservoir[position] = values; }
    }
    const centers = FEATURE_NAMES.map((_, index) => median(reservoir.map(row => row[index])));
    const deviations = FEATURE_NAMES.map((_, index) => median(reservoir.map(row => Math.abs(row[index] - centers[index]))));
    const baseline = { medians: centers, mad: deviations, amountCutoff: centers[0] + 6 * Math.max(0.1, deviations[0]) };
    onProgress({ phase: 'Training local Isolation Forest', percent: 25 });
    const model = train(reservoir);
    check();
    const revision = Number(db.prepare("SELECT value FROM metadata WHERE key='revision'").get().value);
    const config = { ruleVersion: RULE_VERSION, featureNames: FEATURE_NAMES, seed: 73129, trees: 64, maxTrainingRows: 8192,
      trainingRows: reservoir.length, subsample: 256, modelAvailable: !!model, minimumModelRows: 32,
      priorityThresholds: { Critical: 75, High: 50, Medium: 25, Low: 0 }, baseline, featureSha256: digest.digest('hex'),
      clustering: 'Common-input heuristic; excludes ≥3 inputs with ≥3 equal positive outputs; never links ownership through IP or output/change heuristics.' };
    db.prepare('INSERT INTO analysis_runs VALUES(?,?,?,?,?,?)').run(id,created,revision,total,JSON.stringify(config),JSON.stringify(model));
    db.exec('DELETE FROM lead_scores; DELETE FROM cluster_members; DELETE FROM clusters;');
    const insert = db.prepare('INSERT INTO lead_scores VALUES(?,?,?,?,?,?,?,?)');
    seen = 0;
    for (const row of chunks(db,'SELECT * FROM features','txid')) {
      check();
      const anomaly = isolationScore(model, vector(row)), reasons = reasonsFor(row, anomaly, baseline);
      const score = Math.min(100, reasons.reduce((sum, reason) => sum + reason.points, 0));
      const priority = score >= 75 ? 'Critical' : score >= 50 ? 'High' : score >= 25 ? 'Medium' : 'Low';
      const primary = reasons.slice().sort((a,b) => b.points-a.points).find(reason => reason.points > 0);
      insert.run(row.txid,score,priority,primary?.category || 'Baseline',JSON.stringify(reasons),anomaly,JSON.stringify(row),id);
      if (++seen % 1000 === 0) onProgress({ phase: 'Scoring transactions', percent: 30 + Math.round(seen / total * 35) });
    }
    onProgress({ phase: 'Clustering common-input address hypotheses', percent: 70 });
    // Memory is O(unique addresses); transaction features and scores remain on disk.
    const parents = new Map();
    function find(value) {
      if (!parents.has(value)) parents.set(value, value);
      let root = value;
      while (parents.get(root) !== root) root = parents.get(root);
      while (parents.get(value) !== value) { const next = parents.get(value); parents.set(value, root); value = next; }
      return root;
    }
    function union(a,b) { a = find(a); b = find(b); if (a !== b) parents.set(a < b ? b : a, a < b ? a : b); }
    for (const row of chunks(db,'SELECT DISTINCT address FROM addresses','address')) { check(); find(row.address); }
    for (const row of chunks(db,'SELECT txid,input_addresses,coinjoin FROM transactions','txid')) {
      if (row.coinjoin) continue;
      check(); const inputs = JSON.parse(row.input_addresses);
      for (let i = 1; i < inputs.length; i++) union(inputs[0], inputs[i]);
    }
    const sizes = new Map();
    for (const addr of parents.keys()) { const root = find(addr); sizes.set(root, (sizes.get(root) || 0) + 1); }
    const insertCluster = db.prepare('INSERT INTO clusters VALUES(?,?,0)'), insertMember = db.prepare('INSERT INTO cluster_members VALUES(?,?)');
    const ids = new Map();
    for (const [root,size] of sizes) { check(); const clusterId = `ENT-${hash(root).slice(0,16).toUpperCase()}`; ids.set(root,clusterId); insertCluster.run(clusterId,size); }
    for (const addr of parents.keys()) { check(); insertMember.run(addr,ids.get(find(addr))); }
    db.exec(`UPDATE clusters SET tx_count=(SELECT count(DISTINCT a.txid) FROM addresses a JOIN cluster_members m ON m.address=a.address WHERE m.cluster_id=clusters.id)`);
    check();
    audit(db, 'analysis.completed', { id, transactions: total, model: model ? 'Isolation Forest' : 'Rules only: fewer than 32 transactions', ruleVersion: RULE_VERSION });
    db.exec('COMMIT');
    onProgress({ phase: 'Analysis complete', percent: 100 });
    return { id, created, transactions: total, modelAvailable: !!model };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  finally { db.exec('DROP TABLE IF EXISTS temp.features; DROP TABLE IF EXISTS temp.tx_bursts; DROP TABLE IF EXISTS temp.source_minutes;'); }
}

module.exports = { analyze, vector, reasonsFor, RULE_VERSION, FEATURE_NAMES };
