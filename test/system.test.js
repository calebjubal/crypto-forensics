"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const {
  openDatabase,
  importFile,
  deleteImport,
  summary,
  page,
  detail,
  review,
  authenticationStatus,
  createInitialUser,
  authenticate,
} = require("../src/database");
const { analyze } = require("../src/analytics");
const { makeRows, serialize } = require("../test-support/fixtures");
const { normalize, satoshis } = require("../src/validation");
const { csvCell } = require("../src/export");
const temporary = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), "satoshi-trace-test-"));

test("exact BTC conversion and strict evidence validation", () => {
  assert.equal(satoshis("0.00000001"), 1);
  assert.equal(satoshis("21000000.00000000"), 2100000000000000);
  assert.throws(() => satoshis("1e2"), /decimal/);
  assert.throws(
    () => normalize({ ...makeRows(1)[0], timestamp: "2026-08-12T10:00:00" }),
    /timezone/,
  );
  assert.throws(
    () => normalize({ ...makeRows(1)[0], txid: "bad" }),
    /64 hexadecimal/,
  );
});
test("returns large aggregate values without unsafe JavaScript conversion", () => {
  const db = openDatabase(":memory:");
  const insert = db.prepare(
    "INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?,?)",
  );
  for (let index = 0; index < 5; index++) {
    const txid = index.toString(16).padStart(64, "0");
    insert.run(
      txid,
      '["input"]',
      '["output"]',
      '["20000000.00000000"]',
      '["20000000.00000000"]',
      2000000000000000,
      2000000000000000,
      0,
      0,
      txid,
    );
  }
  assert.equal(summary(db).volume_sat, "10000000000000000");
  db.close();
});
for (const format of ["csv", "json", "xml"])
  test(`streams and records provenance for ${format.toUpperCase()}`, async () => {
    const dir = temporary(),
      file = path.join(dir, `fixture.${format}`),
      db = openDatabase(":memory:");
    fs.writeFileSync(file, serialize(makeRows(6), format));
    const result = await importFile(db, file);
    assert.ok(result.accepted >= 6);
    assert.equal(result.rejected, 0);
    assert.match(result.sha256, /^[a-f0-9]{64}$/);
    const s = summary(db);
    assert.equal(s.transactions, 6);
    assert.ok(s.observations >= 6);
    assert.equal(s.imports.length, 1);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
test("rejects malformed rows but preserves valid evidence", async () => {
  const dir = temporary(),
    file = path.join(dir, "mixed.json"),
    rows = makeRows(3);
  rows.push({ ...rows[0], txid: "bad" });
  rows.push({ ...rows[1], input_amounts: ["0.00000001"] });
  fs.writeFileSync(file, JSON.stringify(rows));
  const db = openDatabase(":memory:"),
    result = await importFile(db, file);
  assert.equal(result.rejected, 2);
  assert.equal(summary(db).transactions, 3);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
test("rolls back a whole file on parser failure", async () => {
  const dir = temporary(),
    file = path.join(dir, "broken.json"),
    db = openDatabase(":memory:");
  fs.writeFileSync(file, '[{"timestamp":');
  await assert.rejects(importFile(db, file));
  assert.equal(summary(db).imports.length, 0);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
test("stores a scrypt-backed local account and rejects invalid credentials", () => {
  const db = openDatabase(":memory:");
  assert.equal(authenticationStatus(db).configured, false);
  const account = createInitialUser(db, {
    username: "investigator.one",
    password: "correct horse battery staple",
  });
  assert.equal(account.username, "investigator.one");
  assert.equal(authenticationStatus(db).configured, true);
  assert.throws(
    () =>
      createInitialUser(db, {
        username: "second",
        password: "another secure password",
      }),
    /already configured/,
  );
  assert.throws(
    () =>
      authenticate(db, {
        username: "investigator.one",
        password: "wrong password",
      }),
    /Invalid username or password/,
  );
  assert.equal(
    authenticate(db, {
      username: "INVESTIGATOR.ONE",
      password: "correct horse battery staple",
    }).username,
    "investigator.one",
  );
  const entries = page(db, "audit", { limit: 20 });
  assert.ok(entries.rows.some((row) => row.action === "auth.login_failed"));
  assert.ok(entries.rows.some((row) => row.action === "auth.login_succeeded"));
  db.close();
});
test("removes only evidence no longer supported by another source", async () => {
  const dir = temporary(),
    first = path.join(dir, "first.json"),
    second = path.join(dir, "second.json"),
    content = serialize(makeRows(8), "json"),
    db = openDatabase(":memory:");
  fs.writeFileSync(first, content);
  fs.writeFileSync(second, content);
  const a = await importFile(db, first),
    b = await importFile(db, second);
  const before = summary(db);
  assert.equal(before.imports.length, 2);
  deleteImport(db, a.id, { username: "tester", sessionId: "test-session" });
  const shared = summary(db);
  assert.equal(shared.imports.length, 1);
  assert.equal(shared.observations, before.observations);
  deleteImport(db, b.id, { username: "tester", sessionId: "test-session" });
  const empty = summary(db);
  assert.equal(empty.imports.length, 0);
  assert.equal(empty.observations, 0);
  assert.equal(empty.transactions, 0);
  const activity = page(db, "audit", { limit: 10 });
  assert.ok(
    activity.rows.some(
      (row) =>
        row.action === "import.deleted" &&
        JSON.parse(row.details).actor === "tester",
    ),
  );
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
test("correlates, trains, clusters and emits explainable leads", async () => {
  const dir = temporary(),
    file = path.join(dir, "large.json"),
    db = openDatabase(":memory:");
  fs.writeFileSync(file, serialize(makeRows(180), "json"));
  await importFile(db, file);
  const run = analyze(db);
  assert.equal(run.modelAvailable, true);
  const s = summary(db);
  assert.equal(s.stale, false);
  assert.ok(s.leads > 0);
  assert.ok(s.clusters > 0);
  const leads = page(db, "leads", { limit: 10 });
  assert.ok(leads.total > 0);
  assert.ok(leads.rows[0].score >= 25);
  const d = detail(db, leads.rows[0].txid);
  assert.ok(JSON.parse(d.transaction.reasons).some((r) => r.points > 0));
  assert.ok(d.sources.length > 0);
  assert.ok(d.observations.length > 0);
  review(db, {
    txid: leads.rows[0].txid,
    status: "In review",
    notes: "Corroboration pending.",
  });
  assert.equal(detail(db, leads.rows[0].txid).review.status, "In review");
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
test("neutralizes CSV formula cells", () => {
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell("-2"), '"\'-2"');
});
