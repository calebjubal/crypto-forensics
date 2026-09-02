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
  clusterDetail,
  review,
  authenticationStatus,
  createInitialUser,
  authenticate,
} = require("../src/database");
const { analyze } = require("../src/analytics");
const { makeRows, serialize } = require("../test-support/fixtures");
const { normalize, satoshis } = require("../src/validation");
const { csvCell } = require("../src/export");
const {
  mapOverview,
  mapLead,
  combineRoutes,
  OVERVIEW_ROUTE_LIMIT,
  FOCUS_WALLET_LIMIT,
} = require("../src/map");
const {
  createGeoLocator,
  responseLocation,
  countryFallback,
  annotateLocation,
} = require("../src/geolocation");
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
  const overviewNext = page(db, "leads", { limit: 5, offset: 5 });
  assert.equal(overviewNext.limit, 5);
  assert.equal(overviewNext.offset, 5);
  for (let index = 1; index < leads.rows.length; index++) {
    const previous = leads.rows[index - 1],
      current = leads.rows[index];
    if (previous.score === current.score)
      assert.ok(previous.anomaly >= current.anomaly);
  }
  const d = detail(db, leads.rows[0].txid);
  assert.ok(JSON.parse(d.transaction.reasons).some((r) => r.points > 0));
  assert.ok(d.sources.length > 0);
  assert.ok(d.observations.length > 0);
  const clusters = page(db, "clusters", { limit: 1 });
  assert.ok(clusters.rows.length > 0);
  const cluster = clusterDetail(db, clusters.rows[0].id);
  assert.ok(cluster.graph.links.length > 0);
  assert.ok(cluster.graph.linkTotal >= cluster.graph.links.length);
  assert.ok(
    cluster.graph.links.every(
      (link) => link.address && /^[0-9a-f]{64}$/.test(link.txid),
    ),
  );
  review(db, {
    txid: leads.rows[0].txid,
    status: "In review",
    notes: "Corroboration pending.",
  });
  assert.equal(detail(db, leads.rows[0].txid).review.status, "In review");
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
test("graph embeddings join repeatedly co-occurring wallet hypotheses", async () => {
  const dir = temporary(),
    file = path.join(dir, "embedding.json"),
    db = openDatabase(":memory:"),
    rows = [...new Map(makeRows(7).map((row) => [row.txid, row])).values()],
    shapes = [
      { inputs: ["funding_alpha"], outputs: ["wallet_alpha", "wallet_beta"] },
      { inputs: ["funding_beta"], outputs: ["wallet_alpha", "wallet_beta"] },
      { inputs: ["wallet_alpha"], outputs: ["spend_alpha"] },
      { inputs: ["wallet_beta"], outputs: ["spend_beta"] },
      { inputs: ["funding_gamma"], outputs: ["wallet_gamma", "wallet_delta"] },
      { inputs: ["wallet_gamma"], outputs: ["spend_gamma"] },
      { inputs: ["wallet_delta"], outputs: ["spend_delta"] },
    ];
  rows.forEach((row, index) => {
    row.input_addresses = shapes[index].inputs;
    row.output_addresses = shapes[index].outputs;
    row.input_amounts = shapes[index].inputs.map(() => "1.00000000");
    row.output_amounts = shapes[index].outputs.map((_, outputIndex) =>
      outputIndex ? "0.49000000" : "0.50000000",
    );
  });
  fs.writeFileSync(file, serialize(rows, "json"));
  await importFile(db, file);
  assert.equal(
    db.prepare("SELECT value FROM metadata WHERE key='schema_version'").get().value,
    "2",
  );
  analyze(db);
  analyze(db);
  const memberships = db
      .prepare(
        "SELECT address,cluster_id FROM cluster_members WHERE address IN ('wallet_alpha','wallet_beta') ORDER BY address",
      )
      .all(),
    config = JSON.parse(
      db.prepare("SELECT config FROM analysis_runs ORDER BY created DESC LIMIT 1").get()
        .config,
    );
  assert.equal(memberships.length, 2);
  assert.equal(memberships[0].cluster_id, memberships[1].cluster_id);
  const embeddingCluster = clusterDetail(db, memberships[0].cluster_id);
  assert.equal(embeddingCluster.embeddingLinks.length, 1);
  assert.equal(embeddingCluster.embeddingLinks[0].shared_contexts, 2);
  assert.ok(embeddingCluster.embeddingLinks[0].similarity >= 0.82);
  const oneOffMemberships = db
    .prepare(
      "SELECT address,cluster_id FROM cluster_members WHERE address IN ('wallet_gamma','wallet_delta') ORDER BY address",
    )
    .all();
  assert.equal(oneOffMemberships.length, 2);
  assert.notEqual(oneOffMemberships[0].cluster_id, oneOffMemberships[1].cluster_id);
  assert.ok(config.graphEmbedding.candidatePairs >= 1);
  assert.ok(config.graphEmbedding.acceptedLinks >= 1);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
test("aggregates every observation for the map and expands a selected lead", async () => {
  const dir = temporary(),
    file = path.join(dir, "map.json"),
    db = openDatabase(":memory:"),
    locator = {
      metadata: { available: true, edition: "Test City DB" },
      locate(ip, suppliedCountry) {
        const source = ip.startsWith("192.") || ip.startsWith("203.");
        return {
          key: source ? `city:${suppliedCountry}:source` : "city:ZZ:destination",
          country: source ? suppliedCountry : "ZZ",
          countryName: source ? suppliedCountry : "Test destination",
          region: "Test region",
          city: source ? "Source city" : "Destination city",
          latitude: source ? 20 : -20,
          longitude: source ? 40 : -40,
          source: "test",
        };
      },
    };
  fs.writeFileSync(file, serialize(makeRows(80), "json"));
  await importFile(db, file);
  analyze(db);
  const overview = mapOverview(db, locator),
    summaryData = summary(db),
    lead = page(db, "leads", { limit: 1 }).rows[0],
    focus = mapLead(db, lead.txid, locator);
  assert.equal(overview.totals.observations, summaryData.observations);
  assert.equal(overview.totals.transactions, summaryData.transactions);
  assert.equal(
    overview.routes.reduce((sum, route) => sum + route.observationCount, 0),
    summaryData.observations,
  );
  assert.ok(overview.routes.some((route) => route.clusterId));
  assert.ok(focus.endpoints.length > 0);
  assert.ok(focus.wallets.length > 0);
  assert.equal(focus.transaction.txid, lead.txid);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
test("consolidates oversized route groups without losing observation totals", () => {
  const routes = Array.from({ length: OVERVIEW_ROUTE_LIMIT + 25 }, (_, index) => ({
    id: `route:${index}`,
    source: "city:a",
    target: "city:b",
    clusterId: `cluster:${index}`,
    observationCount: index + 1,
    transactions: new Set([`tx:${index}`]),
    ips: new Set([`ip:${index}`]),
    leads: new Set(index % 2 ? [] : [`tx:${index}`]),
  }));
  const expected = routes.reduce(
      (sum, route) => sum + route.observationCount,
      0,
    ),
    result = combineRoutes(routes);
  assert.equal(result.combined, true);
  assert.equal(result.routes.length, 1);
  assert.equal(result.routes[0].observationCount, expected);
  assert.equal(result.routes[0].transactions.size, routes.length);
});
test("collapses selected-lead wallet overflow into disclosed groups", async () => {
  const dir = temporary(),
    file = path.join(dir, "wallet-overflow.json"),
    db = openDatabase(":memory:"),
    row = makeRows(1)[0],
    count = FOCUS_WALLET_LIMIT + 20;
  row.input_addresses = Array.from(
    { length: count },
    (_, index) => `overflow_input_${String(index).padStart(5, "0")}`,
  );
  row.output_addresses = Array.from(
    { length: count },
    (_, index) => `overflow_output_${String(index).padStart(5, "0")}`,
  );
  row.input_amounts = Array.from({ length: count }, () => "0.01000000");
  row.output_amounts = Array.from({ length: count }, () => "0.00900000");
  fs.writeFileSync(file, JSON.stringify([row]));
  await importFile(db, file);
  const focus = mapLead(db, row.txid, {
    metadata: { available: false },
    locate: () => ({
      key: "unlocated",
      country: "",
      countryName: "Unlocated",
      region: "",
      city: "",
      latitude: null,
      longitude: null,
      source: "unlocated",
    }),
  });
  assert.equal(focus.wallets.length, FOCUS_WALLET_LIMIT);
  assert.equal(focus.totals.wallets, count * 2);
  assert.equal(
    focus.walletOverflow.reduce((sum, group) => sum + group.count, 0),
    count * 2 - FOCUS_WALLET_LIMIT,
  );
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
test("handles City Lite responses and safe country fallbacks", () => {
  const city = responseLocation({
    country: { iso_code: "IN", names: { en: "India" } },
    subdivisions: [{ names: { en: "Delhi" } }],
    city: { names: { en: "New Delhi" } },
    location: { latitude: 28.6327, longitude: 77.2198 },
  });
  assert.equal(city.country, "IN");
  assert.equal(city.city, "New Delhi");
  assert.equal(city.latitude, 28.6327);
  assert.equal(countryFallback("SG").countryName, "Singapore");
  assert.equal(countryFallback("invalid"), null);
  const conflict = annotateLocation(city, "US");
  assert.equal(conflict.countryConflict, true);
  assert.equal(conflict.suppliedCountry, "US");
  const dir = temporary(),
    missing = createGeoLocator(path.join(dir, "missing.mmdb")),
    corruptPath = path.join(dir, "corrupt.mmdb");
  assert.equal(missing.metadata.available, false);
  assert.equal(missing.locate("192.0.2.1", "SG").source, "supplied-country");
  assert.equal(missing.locate("192.0.2.1", null).source, "unlocated");
  fs.writeFileSync(corruptPath, "not a maxmind database");
  const corrupt = createGeoLocator(corruptPath);
  assert.equal(corrupt.metadata.available, false);
  assert.equal(corrupt.locate("10.0.0.1", "IN").source, "supplied-country");
  const bundled = createGeoLocator(
    path.join(
      __dirname,
      "..",
      "assets",
      "geoip",
      "dbip-city-lite-2026-09.mmdb",
    ),
  );
  assert.equal(bundled.metadata.available, true);
  assert.equal(bundled.locate("8.8.8.8", "IN").source, "db-ip-city-lite");
  assert.equal(bundled.locate("8.8.8.8", "IN").countryConflict, true);
  assert.equal(
    bundled.locate("2401:4900:8840:eaf1:dd4e:39f5:5d14:39f", null)
      .country,
    "IN",
  );
  fs.rmSync(dir, { recursive: true, force: true });
});
test("neutralizes CSV formula cells", () => {
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell("-2"), '"\'-2"');
});
