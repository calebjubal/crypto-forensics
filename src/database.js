'use strict';

const { DatabaseSync } = require('node:sqlite');
const { randomUUID, randomBytes, scryptSync, timingSafeEqual } = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { normalize } = require('./validation');
const { records } = require('./parsers');

const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,64}$/;
const PASSWORD_MINIMUM = 12;
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT OR IGNORE INTO metadata VALUES ('schema_version','1');
    INSERT OR IGNORE INTO metadata VALUES ('revision','0');
    CREATE TABLE IF NOT EXISTS imports(id TEXT PRIMARY KEY, name TEXT NOT NULL, format TEXT NOT NULL,
      sha256 TEXT, bytes INTEGER DEFAULT 0, rows INTEGER DEFAULT 0, accepted INTEGER DEFAULT 0,
      duplicates INTEGER DEFAULT 0, rejected INTEGER DEFAULT 0, new_transactions INTEGER DEFAULT 0, created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS transactions(txid TEXT PRIMARY KEY, input_addresses TEXT NOT NULL,
      output_addresses TEXT NOT NULL, input_amounts TEXT NOT NULL, output_amounts TEXT NOT NULL,
      input_sat INTEGER NOT NULL, output_sat INTEGER NOT NULL, fee_sat INTEGER NOT NULL,
      coinjoin INTEGER NOT NULL, data_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS observations(id INTEGER PRIMARY KEY, txid TEXT NOT NULL REFERENCES transactions(txid),
      timestamp TEXT NOT NULL, ts_ms INTEGER NOT NULL, src_ip TEXT NOT NULL, dst_ip TEXT NOT NULL,
      src_port INTEGER NOT NULL, dst_port INTEGER NOT NULL, geo_country TEXT, asn TEXT, fingerprint TEXT NOT NULL UNIQUE);
    CREATE INDEX IF NOT EXISTS observations_tx ON observations(txid,ts_ms);
    CREATE INDEX IF NOT EXISTS observations_source_time ON observations(src_ip,ts_ms);
    CREATE INDEX IF NOT EXISTS observations_time ON observations(ts_ms);
    CREATE TABLE IF NOT EXISTS addresses(txid TEXT NOT NULL REFERENCES transactions(txid), address TEXT NOT NULL,
      side TEXT NOT NULL, PRIMARY KEY(txid,address,side));
    CREATE INDEX IF NOT EXISTS addresses_address ON addresses(address,txid);
    CREATE TABLE IF NOT EXISTS provenance(import_id TEXT NOT NULL REFERENCES imports(id), row_number INTEGER NOT NULL,
      observation_id INTEGER NOT NULL REFERENCES observations(id), outcome TEXT NOT NULL, PRIMARY KEY(import_id,row_number));
    CREATE INDEX IF NOT EXISTS provenance_observation ON provenance(observation_id);
    CREATE TABLE IF NOT EXISTS import_errors(import_id TEXT NOT NULL REFERENCES imports(id), row_number INTEGER NOT NULL,
      reason TEXT NOT NULL, PRIMARY KEY(import_id,row_number));
    CREATE TABLE IF NOT EXISTS analysis_runs(id TEXT PRIMARY KEY, created TEXT NOT NULL, revision INTEGER NOT NULL,
      transaction_count INTEGER NOT NULL, config TEXT NOT NULL, model TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS lead_scores(txid TEXT PRIMARY KEY REFERENCES transactions(txid), score INTEGER NOT NULL,
      priority TEXT NOT NULL, category TEXT NOT NULL, reasons TEXT NOT NULL, anomaly REAL,
      features TEXT NOT NULL, run_id TEXT NOT NULL REFERENCES analysis_runs(id));
    CREATE INDEX IF NOT EXISTS scores_priority ON lead_scores(score DESC,txid);
    CREATE TABLE IF NOT EXISTS lead_reviews(txid TEXT PRIMARY KEY REFERENCES transactions(txid),
      status TEXT NOT NULL DEFAULT 'New', notes TEXT NOT NULL DEFAULT '', updated TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS clusters(id TEXT PRIMARY KEY, size INTEGER NOT NULL, tx_count INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS cluster_members(address TEXT PRIMARY KEY, cluster_id TEXT NOT NULL REFERENCES clusters(id));
    CREATE INDEX IF NOT EXISTS members_cluster ON cluster_members(cluster_id);
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, timestamp TEXT NOT NULL, action TEXT NOT NULL, details TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS audit_timestamp ON audit(timestamp DESC);
    CREATE TABLE IF NOT EXISTS users(username TEXT PRIMARY KEY COLLATE NOCASE, salt TEXT NOT NULL,
      password_hash TEXT NOT NULL, created TEXT NOT NULL, last_login TEXT);`);
  return db;
}

function audit(db, action, details = {}, context = {}) {
  const entry = { ...details };
  if (context.username) entry.actor = context.username;
  if (context.sessionId) entry.sessionId = context.sessionId;
  db.prepare('INSERT INTO audit(timestamp,action,details) VALUES(?,?,?)').run(new Date().toISOString(), action, JSON.stringify(entry));
}

function validateCredentials(input, creating = false) {
  const username = String(input?.username || '').trim();
  const password = String(input?.password || '');
  if (!USERNAME_PATTERN.test(username)) throw new Error('Username must be 3–64 characters using letters, numbers, dot, underscore, or hyphen.');
  if (creating && (password.length < PASSWORD_MINIMUM || password.length > 256)) throw new Error('Password must contain 12–256 characters.');
  if (!creating && !password) throw new Error('Enter your password.');
  return { username, password };
}

function authenticationStatus(db) {
  return { configured: db.prepare('SELECT count(*) AS count FROM users').get().count > 0 };
}

function createInitialUser(db, input) {
  if (authenticationStatus(db).configured) throw new Error('A local account is already configured.');
  const { username, password } = validateCredentials(input, true);
  const salt = randomBytes(16);
  const passwordHash = scryptSync(password, salt, 32, SCRYPT_OPTIONS);
  const created = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('INSERT INTO users(username,salt,password_hash,created,last_login) VALUES(?,?,?,?,?)')
      .run(username, salt.toString('hex'), passwordHash.toString('hex'), created, created);
    audit(db, 'auth.account_created', { username }, { username });
    audit(db, 'auth.login_succeeded', { username, initialSetup: true }, { username });
    db.exec('COMMIT');
    return { username };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function authenticate(db, input) {
  const { username, password } = validateCredentials(input);
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  let expected = Buffer.alloc(32);
  let salt = Buffer.alloc(16);
  if (user) {
    expected = Buffer.from(user.password_hash, 'hex');
    salt = Buffer.from(user.salt, 'hex');
  }
  const actual = scryptSync(password, salt, 32, SCRYPT_OPTIONS);
  const valid = !!user && expected.length === actual.length && timingSafeEqual(expected, actual);
  if (!valid) {
    audit(db, 'auth.login_failed', { username }, { username });
    throw new Error('Invalid username or password.');
  }
  const loginTime = new Date().toISOString();
  db.prepare('UPDATE users SET last_login=? WHERE username=?').run(loginTime, user.username);
  audit(db, 'auth.login_succeeded', { username: user.username }, { username:user.username });
  return { username: user.username };
}

async function importFile(db, file, onProgress = () => {}, cancelled = () => false, context = {}) {
  const stats = { id: randomUUID(), name: path.basename(file), format: path.extname(file).slice(1).toUpperCase(), rows: 0, accepted: 0, duplicates: 0, rejected: 0, new_transactions: 0, bytes: 0, created: new Date().toISOString() };
  const size = fs.statSync(file).size;
  if (!fs.statSync(file).isFile()) throw new Error('Select a regular file.');
  const findTx = db.prepare('SELECT data_hash FROM transactions WHERE txid=?');
  const insertTx = db.prepare('INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?,?)');
  const insertAddress = db.prepare('INSERT OR IGNORE INTO addresses VALUES(?,?,?)');
  const insertObs = db.prepare('INSERT OR IGNORE INTO observations(txid,timestamp,ts_ms,src_ip,dst_ip,src_port,dst_port,geo_country,asn,fingerprint) VALUES(?,?,?,?,?,?,?,?,?,?)');
  const findObs = db.prepare('SELECT id FROM observations WHERE fingerprint=?');
  const provenance = db.prepare('INSERT INTO provenance VALUES(?,?,?,?)');
  const reject = db.prepare('INSERT INTO import_errors VALUES(?,?,?)');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('INSERT INTO imports(id,name,format,created) VALUES(?,?,?,?)').run(stats.id, stats.name, stats.format, stats.created);
    for await (const row of records(file, stats, cancelled)) {
      if (cancelled()) throw new Error('Import cancelled; this file was rolled back.');
      stats.rows++;
      let record;
      try {
        record = normalize(row);
        const previous = findTx.get(record.txid);
        if (previous && previous.data_hash !== record.data_hash) throw new Error('Conflicting blockchain data for an existing TXID. Existing evidence was preserved.');
      } catch (error) {
        reject.run(stats.id, stats.rows, error.message); stats.rejected++; continue;
      }
      const r = record;
      if (!findTx.get(r.txid)) {
        insertTx.run(r.txid, JSON.stringify(r.input_addresses), JSON.stringify(r.output_addresses), JSON.stringify(r.input_amounts), JSON.stringify(r.output_amounts), r.input_sat, r.output_sat, r.fee_sat, r.coinjoin, r.data_hash);
        for (const addr of r.input_addresses) insertAddress.run(r.txid, addr, 'input');
        for (const addr of r.output_addresses) insertAddress.run(r.txid, addr, 'output');
        stats.new_transactions++;
      }
      const result = insertObs.run(r.txid, r.timestamp, r.ts_ms, r.src_ip, r.dst_ip, r.src_port, r.dst_port, r.geo_country, r.asn, r.fingerprint);
      const outcome = result.changes ? 'accepted' : 'duplicate';
      stats[result.changes ? 'accepted' : 'duplicates']++;
      provenance.run(stats.id, stats.rows, findObs.get(r.fingerprint).id, outcome);
      if (stats.rows % 500 === 0) onProgress({ phase: 'Importing', name: stats.name, rows: stats.rows, percent: Math.min(99, Math.round(stats.bytes / Math.max(size, 1) * 100)) });
    }
    if (!stats.rows) throw new Error('No records found in the file.');
    if (cancelled()) throw new Error('Import cancelled; this file was rolled back.');
    db.prepare('UPDATE imports SET sha256=?,bytes=?,rows=?,accepted=?,duplicates=?,rejected=?,new_transactions=? WHERE id=?').run(stats.sha256, stats.bytes, stats.rows, stats.accepted, stats.duplicates, stats.rejected, stats.new_transactions, stats.id);
    if (stats.accepted) db.exec("UPDATE metadata SET value=CAST(value AS INTEGER)+1 WHERE key='revision'");
    audit(db, 'import.completed', stats, context);
    db.exec('COMMIT');
    onProgress({ phase: 'Imported', name: stats.name, rows: stats.rows, percent: 100 });
    return stats;
  } catch (error) {
    db.exec('ROLLBACK');
    audit(db, 'import.rolled_back', { name: stats.name, reason: error.message }, context);
    throw error;
  }
}

function deleteImport(db, id, context = {}) {
  if (typeof id !== 'string' || !id) throw new Error('Invalid evidence source.');
  const source = db.prepare('SELECT * FROM imports WHERE id=?').get(id);
  if (!source) throw new Error('Evidence source not found.');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('DROP TABLE IF EXISTS temp.removed_observations; DROP TABLE IF EXISTS temp.orphan_transactions;');
    db.prepare('CREATE TEMP TABLE removed_observations AS SELECT observation_id AS id FROM provenance WHERE import_id=?').run(id);
    const linked = db.prepare('SELECT count(*) AS count FROM removed_observations').get().count;
    db.prepare('DELETE FROM provenance WHERE import_id=?').run(id);
    const removedObservations = db.prepare('DELETE FROM observations WHERE id IN (SELECT id FROM removed_observations) AND NOT EXISTS (SELECT 1 FROM provenance WHERE provenance.observation_id=observations.id)').run().changes;
    db.exec('CREATE TEMP TABLE orphan_transactions AS SELECT txid FROM transactions WHERE NOT EXISTS (SELECT 1 FROM observations WHERE observations.txid=transactions.txid);');
    const removedTransactions = db.prepare('SELECT count(*) AS count FROM orphan_transactions').get().count;
    db.exec(`DELETE FROM lead_scores;
      DELETE FROM cluster_members;
      DELETE FROM clusters;
      DELETE FROM lead_reviews WHERE txid IN (SELECT txid FROM orphan_transactions);
      DELETE FROM addresses WHERE txid IN (SELECT txid FROM orphan_transactions);
      DELETE FROM transactions WHERE txid IN (SELECT txid FROM orphan_transactions);`);
    db.prepare('DELETE FROM import_errors WHERE import_id=?').run(id);
    db.prepare('DELETE FROM imports WHERE id=?').run(id);
    db.exec("UPDATE metadata SET value=CAST(value AS INTEGER)+1 WHERE key='revision'");
    const result = { id, name: source.name, linkedRows: linked, removedObservations, removedTransactions };
    audit(db, 'import.deleted', result, context);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.exec('DROP TABLE IF EXISTS temp.removed_observations; DROP TABLE IF EXISTS temp.orphan_transactions;');
  }
}

function summary(db) {
  const scalar = sql => Object.values(db.prepare(sql).get())[0];
  const run = db.prepare('SELECT id,created,revision,transaction_count,config FROM analysis_runs ORDER BY rowid DESC LIMIT 1').get();
  const revision = Number(scalar("SELECT value FROM metadata WHERE key='revision'"));
  return {
    transactions: scalar('SELECT count(*) FROM transactions'), observations: scalar('SELECT count(*) FROM observations'),
    addresses: scalar('SELECT count(DISTINCT address) FROM addresses'), clusters: scalar('SELECT count(*) FROM clusters WHERE size>1'),
    leads: scalar("SELECT count(*) FROM lead_scores WHERE score>=25"), urgent: scalar("SELECT count(*) FROM lead_scores WHERE priority IN ('Critical','High')"),
    volume_sat: scalar('SELECT coalesce(sum(output_sat),0) FROM transactions'),
    imports: db.prepare('SELECT * FROM imports ORDER BY created DESC').all(),
    priorities: db.prepare('SELECT priority,count(*) AS count FROM lead_scores WHERE score>=25 GROUP BY priority').all(),
    countries: db.prepare("SELECT coalesce(geo_country,'—') AS country,count(*) AS count FROM observations GROUP BY geo_country ORDER BY count DESC LIMIT 7").all(),
    timeline: db.prepare("SELECT substr(timestamp,1,10) AS day,count(*) AS count,count(DISTINCT txid) AS tx_count FROM observations GROUP BY day ORDER BY day DESC LIMIT 30").all().reverse(),
    run, revision, stale: !run || run.revision !== revision,
    activity: db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 6').all(),
  };
}

function page(db, type, options = {}) {
  const offset = Math.max(0, Math.floor(Number(options.offset) || 0));
  const limit = Math.min(100, Math.max(1, Math.floor(Number(options.limit) || 25)));
  const search = String(options.search || '').slice(0, 200);
  const params = [];
  let select, where = [], order;
  if (type === 'transactions' || type === 'leads') {
    select = `FROM transactions t LEFT JOIN lead_scores l ON l.txid=t.txid LEFT JOIN lead_reviews r ON r.txid=t.txid`;
    if (type === 'leads') where.push('l.score>=25');
    if (search) {
      where.push('(t.txid LIKE ? OR EXISTS(SELECT 1 FROM addresses a WHERE a.txid=t.txid AND a.address LIKE ?) OR EXISTS(SELECT 1 FROM observations o WHERE o.txid=t.txid AND (o.src_ip LIKE ? OR o.dst_ip LIKE ?)))');
      for (let i = 0; i < 4; i++) params.push(`%${search}%`);
    }
    if (options.priority && options.priority !== 'All priorities') { where.push('l.priority=?'); params.push(String(options.priority)); }
    if (options.status && options.status !== 'All statuses') { where.push("coalesce(r.status,'New')=?"); params.push(String(options.status)); }
    const filters = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const total = db.prepare(`SELECT count(*) AS count ${select}${filters}`).get(...params).count;
    order = type === 'leads' ? 'l.score DESC,t.txid' : 't.rowid DESC';
    const rows = db.prepare(`SELECT t.txid,t.output_sat,t.fee_sat,t.coinjoin,l.score,l.priority,l.category,l.anomaly,l.reasons,
      coalesce(r.status,'New') AS status,(SELECT min(timestamp) FROM observations o WHERE o.txid=t.txid) AS timestamp,
      (SELECT count(*) FROM observations o WHERE o.txid=t.txid) AS observations,
      (SELECT src_ip FROM observations o WHERE o.txid=t.txid ORDER BY ts_ms,id LIMIT 1) AS src_ip
      ${select}${filters} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, limit, offset);
    return { rows, total, limit, offset };
  }
  if (type === 'clusters') {
    const filter = search ? ' AND EXISTS(SELECT 1 FROM cluster_members m WHERE m.cluster_id=c.id AND m.address LIKE ?)' : '';
    if (search) params.push(`%${search}%`);
    return { rows: db.prepare(`SELECT * FROM clusters c WHERE size>1${filter} ORDER BY size DESC,id LIMIT ? OFFSET ?`).all(...params, limit, offset),
      total: db.prepare(`SELECT count(*) AS n FROM clusters c WHERE size>1${filter}`).get(...params).n, limit, offset };
  }
  if (type === 'audit') {
    const total = db.prepare('SELECT count(*) AS count FROM audit').get().count;
    return { rows: db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT ? OFFSET ?').all(limit, offset), total, limit, offset };
  }
  throw new Error('Unknown page.');
}

function detail(db, txid) {
  const transaction = db.prepare('SELECT t.*,l.score,l.priority,l.category,l.reasons,l.features,l.anomaly,l.run_id FROM transactions t LEFT JOIN lead_scores l ON l.txid=t.txid WHERE t.txid=?').get(txid);
  if (!transaction) throw new Error('Transaction not found.');
  const observations = db.prepare('SELECT * FROM observations WHERE txid=? ORDER BY ts_ms,id LIMIT 250').all(txid);
  const total = db.prepare('SELECT count(*) AS n FROM observations WHERE txid=?').get(txid).n;
  const sources = db.prepare(`SELECT i.id,i.name,i.sha256,count(*) AS row_count FROM provenance p JOIN observations o ON o.id=p.observation_id JOIN imports i ON i.id=p.import_id WHERE o.txid=? GROUP BY i.id`).all(txid);
  const clusters = db.prepare('SELECT DISTINCT c.* FROM clusters c JOIN cluster_members m ON m.cluster_id=c.id JOIN addresses a ON a.address=m.address WHERE a.txid=? AND c.size>1').all(txid);
  const review = db.prepare('SELECT * FROM lead_reviews WHERE txid=?').get(txid) || { status: 'New', notes: '' };
  return { transaction, observations, observationTotal: total, sources, clusters, review };
}

function clusterDetail(db, id) {
  const cluster = db.prepare('SELECT * FROM clusters WHERE id=?').get(id);
  if (!cluster) throw new Error('Cluster not found.');
  return { cluster, members: db.prepare('SELECT address FROM cluster_members WHERE cluster_id=? ORDER BY address LIMIT 250').all(id),
    transactions: db.prepare(`SELECT DISTINCT t.txid,t.output_sat,t.coinjoin FROM transactions t JOIN addresses a ON a.txid=t.txid JOIN cluster_members m ON m.address=a.address WHERE m.cluster_id=? LIMIT 100`).all(id) };
}

function review(db, input, context = {}) {
  if (!['New', 'In review', 'Escalated', 'Dismissed'].includes(input.status)) throw new Error('Invalid review status.');
  if (typeof input.notes !== 'string' || input.notes.length > 10000) throw new Error('Notes must contain at most 10,000 characters.');
  if (!db.prepare('SELECT 1 FROM transactions WHERE txid=?').get(input.txid)) throw new Error('Transaction not found.');
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO lead_reviews VALUES(?,?,?,?) ON CONFLICT(txid) DO UPDATE SET status=excluded.status,notes=excluded.notes,updated=excluded.updated').run(input.txid,input.status,input.notes,new Date().toISOString());
    audit(db, 'lead.reviewed', { txid: input.txid, status: input.status }, context);
    db.exec('COMMIT'); return { saved: true };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

module.exports = { openDatabase, importFile, deleteImport, summary, page, detail, clusterDetail, review, audit,
  authenticationStatus, createInitialUser, authenticate };
