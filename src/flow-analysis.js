"use strict";

const { createHash } = require("node:crypto");
const { train, score: isolationScore, seededRandom } = require("./isolation-forest");

const FLOW_VERSION = "1.0.0";
const MAX_MATCH_ADDRESS_DEGREE = 100;
const FLOW_MODEL_MINIMUM = 32;
const FLOW_MODEL_SAMPLE = 8192;

function idFor(type, members) {
  const digest = createHash("sha256")
    .update(`${type}:${members.join(":")}`)
    .digest("hex")
    .slice(0, 16)
    .toUpperCase();
  return `FLOW-${type === "peeling" ? "PEEL" : "MIX"}-${digest}`;
}

function batches(db, sql, cursorColumn = "txid") {
  const statement = db.prepare(
    `${sql} WHERE ${cursorColumn}>? ORDER BY ${cursorColumn} LIMIT 1000`,
  );
  return {
    *[Symbol.iterator]() {
      let cursor = "";
      while (true) {
        const rows = statement.all(cursor);
        if (!rows.length) return;
        yield* rows;
        cursor = String(rows.at(-1)[cursorColumn]);
      }
    },
  };
}

function equalOutputConcentration(amounts) {
  const counts = new Map();
  for (const amount of amounts)
    if (amount > 0) counts.set(amount, (counts.get(amount) || 0) + 1);
  return amounts.length ? Math.max(0, ...counts.values()) / amounts.length : 0;
}

function prepareFlowTables(db, check) {
  db.exec(`DROP TABLE IF EXISTS temp.flow_first_seen;
    DROP TABLE IF EXISTS temp.flow_inputs;
    DROP TABLE IF EXISTS temp.flow_outputs;
    DROP TABLE IF EXISTS temp.flow_address_degree;
    DROP TABLE IF EXISTS temp.flow_candidates;
    DROP TABLE IF EXISTS temp.flow_output_matches;
    DROP TABLE IF EXISTS temp.flow_input_matches;
    DROP TABLE IF EXISTS temp.flow_links;
    DROP TABLE IF EXISTS temp.flow_metrics;
    DROP TABLE IF EXISTS temp.tx_flow_context;
    CREATE TEMP TABLE flow_first_seen AS
      SELECT txid,min(ts_ms) AS first_ms FROM observations GROUP BY txid;
    CREATE UNIQUE INDEX temp.flow_first_seen_tx ON flow_first_seen(txid);
    CREATE TEMP TABLE flow_inputs(txid TEXT NOT NULL,position INTEGER NOT NULL,address TEXT NOT NULL,amount_sat INTEGER NOT NULL,first_ms INTEGER NOT NULL,PRIMARY KEY(txid,position));
    CREATE TEMP TABLE flow_outputs(txid TEXT NOT NULL,position INTEGER NOT NULL,address TEXT NOT NULL,amount_sat INTEGER NOT NULL,first_ms INTEGER NOT NULL,PRIMARY KEY(txid,position));
    CREATE INDEX temp.flow_inputs_match ON flow_inputs(address,amount_sat,first_ms,txid);
    CREATE INDEX temp.flow_outputs_match ON flow_outputs(address,amount_sat,first_ms,txid);`);
  const input = db.prepare("INSERT INTO flow_inputs VALUES(?,?,?,?,?)"),
    output = db.prepare("INSERT INTO flow_outputs VALUES(?,?,?,?,?)");
  for (const row of batches(
    db,
    `SELECT * FROM (SELECT t.txid,t.input_addresses,t.input_amounts,t.output_addresses,t.output_amounts,f.first_ms
      FROM transactions t JOIN flow_first_seen f ON f.txid=t.txid)`,
  )) {
    check();
    const inputs = JSON.parse(row.input_addresses),
      inputAmounts = JSON.parse(row.input_amounts),
      outputs = JSON.parse(row.output_addresses),
      outputAmounts = JSON.parse(row.output_amounts);
    for (let index = 0; index < inputs.length; index++)
      input.run(row.txid, index, inputs[index], inputAmounts[index], row.first_ms);
    for (let index = 0; index < outputs.length; index++)
      output.run(
        row.txid,
        index,
        outputs[index],
        outputAmounts[index],
        row.first_ms,
      );
  }
  check();
  db.exec(`CREATE TEMP TABLE flow_address_degree AS
      SELECT address,sum(n) AS degree FROM (
        SELECT address,count(*) AS n FROM flow_inputs GROUP BY address
        UNION ALL SELECT address,count(*) AS n FROM flow_outputs GROUP BY address
      ) GROUP BY address;
    CREATE UNIQUE INDEX temp.flow_address_degree_address ON flow_address_degree(address);
    CREATE TEMP TABLE flow_candidates AS
      SELECT o.txid AS source_txid,i.txid AS destination_txid,o.position AS output_position,
        i.position AS input_position,o.address,o.amount_sat,o.first_ms AS source_ms,i.first_ms AS destination_ms
      FROM flow_outputs o JOIN flow_inputs i ON i.address=o.address AND i.amount_sat=o.amount_sat
      JOIN flow_address_degree d ON d.address=o.address
      WHERE o.txid<>i.txid AND o.first_ms<i.first_ms AND d.degree<=${MAX_MATCH_ADDRESS_DEGREE};
    CREATE INDEX temp.flow_candidates_output ON flow_candidates(source_txid,output_position);
    CREATE INDEX temp.flow_candidates_input ON flow_candidates(destination_txid,input_position);
    CREATE TEMP TABLE flow_output_matches AS
      SELECT source_txid,output_position,count(*) AS matches FROM flow_candidates GROUP BY source_txid,output_position;
    CREATE UNIQUE INDEX temp.flow_output_matches_key ON flow_output_matches(source_txid,output_position);
    CREATE TEMP TABLE flow_input_matches AS
      SELECT destination_txid,input_position,count(*) AS matches FROM flow_candidates GROUP BY destination_txid,input_position;
    CREATE UNIQUE INDEX temp.flow_input_matches_key ON flow_input_matches(destination_txid,input_position);
    CREATE TEMP TABLE flow_links AS
      SELECT c.* FROM flow_candidates c
      JOIN flow_output_matches o ON o.source_txid=c.source_txid AND o.output_position=c.output_position AND o.matches=1
      JOIN flow_input_matches i ON i.destination_txid=c.destination_txid AND i.input_position=c.input_position AND i.matches=1;
    CREATE UNIQUE INDEX temp.flow_links_key ON flow_links(source_txid,output_position,destination_txid,input_position);
    CREATE INDEX temp.flow_links_source ON flow_links(source_txid,destination_txid);
    CREATE INDEX temp.flow_links_destination ON flow_links(destination_txid,source_txid);
    CREATE TEMP TABLE flow_metrics AS
      SELECT t.txid,
        (SELECT count(DISTINCT source_txid) FROM flow_links WHERE destination_txid=t.txid) AS upstream_transactions,
        (SELECT count(DISTINCT destination_txid) FROM flow_links WHERE source_txid=t.txid) AS downstream_transactions,
        (SELECT count(*) FROM (SELECT i.address FROM flow_inputs i WHERE i.txid=t.txid AND
          (SELECT count(DISTINCT ii.txid) FROM flow_inputs ii WHERE ii.address=i.address)>1 GROUP BY i.address)) AS reused_inputs,
        0.0 AS equal_output_concentration,0.0 AS largest_output_share,
        coalesce((SELECT max(1.0*l.amount_sat/t.output_sat) FROM flow_links l WHERE l.source_txid=t.txid),0.0) AS continuation_ratio
      FROM transactions t;
    CREATE UNIQUE INDEX temp.flow_metrics_tx ON flow_metrics(txid);
    CREATE TEMP TABLE tx_flow_context(txid TEXT PRIMARY KEY,exposure_risk REAL NOT NULL DEFAULT 0,risk_boost INTEGER NOT NULL DEFAULT 0,
      risk_hops INTEGER,seed_pattern_id TEXT,peeling INTEGER NOT NULL DEFAULT 0,mixing INTEGER NOT NULL DEFAULT 0);`);
  const update = db.prepare(
    "UPDATE flow_metrics SET equal_output_concentration=?,largest_output_share=? WHERE txid=?",
  );
  for (const row of batches(
    db,
    "SELECT txid,output_amounts,output_sat FROM transactions",
  )) {
    check();
    const amounts = JSON.parse(row.output_amounts);
    update.run(
      equalOutputConcentration(amounts),
      row.output_sat ? Math.max(...amounts) / row.output_sat : 0,
      row.txid,
    );
  }
}

function peelingPatterns(transactions, linksBySource, incomingQualifying) {
  const patterns = [];
  const qualifying = new Map();
  for (const [txid, tx] of transactions) {
    if (tx.coinjoin || tx.outputs < 2 || tx.outputs > 5 || !tx.outputSat)
      continue;
    const links = (linksBySource.get(txid) || [])
      .filter((link) => {
        const ratio = link.amountSat / tx.outputSat,
          peel = 1 - ratio;
        return ratio >= 0.7 && ratio <= 0.995 && peel >= 0.005 && peel <= 0.3;
      })
      .sort(
        (a, b) =>
          b.amountSat - a.amountSat ||
          a.destinationTxid.localeCompare(b.destinationTxid),
      );
    if (links.length === 1) {
      qualifying.set(txid, links[0]);
      incomingQualifying.set(
        links[0].destinationTxid,
        (incomingQualifying.get(links[0].destinationTxid) || 0) + 1,
      );
    }
  }
  const starts = [...qualifying.keys()]
    .filter((txid) => !incomingQualifying.get(txid))
    .sort((a, b) =>
      transactions.get(a).firstMs - transactions.get(b).firstMs ||
      a.localeCompare(b),
    );
  for (const start of starts) {
    const members = [start],
      ratios = [];
    let current = start;
    while (members.length < 20 && qualifying.has(current)) {
      const link = qualifying.get(current),
        next = transactions.get(link.destinationTxid);
      if (!next || next.coinjoin || members.includes(link.destinationTxid)) break;
      ratios.push(link.amountSat / transactions.get(current).outputSat);
      members.push(link.destinationTxid);
      current = link.destinationTxid;
    }
    if (members.length < 3) continue;
    const average = ratios.reduce((sum, value) => sum + value, 0) / ratios.length,
      deviation = Math.sqrt(
        ratios.reduce((sum, value) => sum + (value - average) ** 2, 0) /
          ratios.length,
      ),
      consistency = Math.max(0, Math.min(1, 1 - deviation / 0.08)),
      confidence = Math.round(
        70 +
          Math.min(15, ((members.length - 3) / 17) * 15) +
          consistency * 15,
      );
    patterns.push({
      id: idFor("peeling", members),
      type: "peeling",
      members,
      confidence,
      continuationConsistency: consistency,
      equalOutputConcentration: 0,
      branching: 1,
      finalTxid: members.at(-1),
      ratios,
    });
  }
  return patterns;
}

function mixingPatterns(transactions, links) {
  const adjacency = new Map();
  for (const link of links) {
    if (
      !transactions.get(link.sourceTxid)?.coinjoin ||
      !transactions.get(link.destinationTxid)?.coinjoin
    )
      continue;
    if (!adjacency.has(link.sourceTxid)) adjacency.set(link.sourceTxid, new Set());
    if (!adjacency.has(link.destinationTxid))
      adjacency.set(link.destinationTxid, new Set());
    adjacency.get(link.sourceTxid).add(link.destinationTxid);
    adjacency.get(link.destinationTxid).add(link.sourceTxid);
  }
  const patterns = [],
    visited = new Set();
  for (const root of [...adjacency.keys()].sort()) {
    if (visited.has(root)) continue;
    const queue = [root],
      members = [];
    visited.add(root);
    while (queue.length) {
      const txid = queue.shift();
      members.push(txid);
      for (const next of [...adjacency.get(txid)].sort())
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
    }
    members.sort(
      (a, b) =>
        transactions.get(a).firstMs - transactions.get(b).firstMs ||
        a.localeCompare(b),
    );
    if (members.length < 2) continue;
    const concentration =
        members.reduce(
          (sum, txid) => sum + transactions.get(txid).equalConcentration,
          0,
        ) / members.length,
      internalEdges = links.filter(
        (link) => members.includes(link.sourceTxid) && members.includes(link.destinationTxid),
      ).length,
      branching = internalEdges / Math.max(1, members.length - 1),
      confidence = Math.round(
        70 +
          Math.min(15, ((members.length - 2) / 18) * 15) +
          Math.min(15, concentration * 15),
      );
    patterns.push({
      id: idFor("mixing", members),
      type: "mixing",
      members,
      confidence,
      continuationConsistency: 0,
      equalOutputConcentration: concentration,
      branching,
      finalTxid: members.at(-1),
      ratios: [],
    });
  }
  return patterns;
}

function flowVector(pattern) {
  return [
    Math.log1p(pattern.members.length),
    Math.log1p(pattern.walletCount),
    Math.log1p(pattern.totalSat / 1e8),
    Math.log1p(pattern.durationMs / 1000),
    pattern.continuationConsistency,
    pattern.equalOutputConcentration,
    pattern.branching,
  ];
}

function scoreFlowAnomalies(patterns) {
  if (patterns.length < FLOW_MODEL_MINIMUM) return null;
  const random = seededRandom(73129),
    sample = [];
  let seen = 0;
  for (const pattern of patterns) {
    const values = flowVector(pattern);
    seen++;
    if (sample.length < FLOW_MODEL_SAMPLE) sample.push(values);
    else {
      const position = Math.floor(random() * seen);
      if (position < FLOW_MODEL_SAMPLE) sample[position] = values;
    }
  }
  const model = train(sample);
  for (const pattern of patterns)
    pattern.anomaly = isolationScore(model, flowVector(pattern));
  return model;
}

function propagateRisk(db, patterns, check) {
  const walletRisk = new Map(),
    transactionRisk = new Map(),
    queue = [],
    outputStatement = db.prepare(
      `SELECT t.txid,t.output_sat,t.output_addresses,t.output_amounts,f.first_ms
       FROM transactions t JOIN flow_first_seen f ON f.txid=t.txid
       JOIN flow_inputs i ON i.txid=t.txid WHERE i.address=? AND f.first_ms>? GROUP BY t.txid ORDER BY f.first_ms,t.txid`,
    );
  function offer(
    address,
    risk,
    hops,
    seedAddress,
    seedPatternId,
    path,
    visited,
    afterMs,
  ) {
    const previous = walletRisk.get(address);
    if (
      previous &&
      (previous.risk > risk ||
        (previous.risk === risk && previous.seedPatternId <= seedPatternId))
    )
      return;
    const entry = { address, risk, hops, seedAddress, seedPatternId, path };
    walletRisk.set(address, entry);
    queue.push({ ...entry, visited, afterMs });
  }
  const seeds = [];
  for (const pattern of patterns
    .filter((item) => item.confidence >= 70)
    .sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id))) {
    const row = db
      .prepare(
        "SELECT t.output_addresses,f.first_ms FROM transactions t JOIN flow_first_seen f ON f.txid=t.txid WHERE t.txid=?",
      )
      .get(pattern.finalTxid);
    for (const address of [...new Set(JSON.parse(row.output_addresses))].sort()) {
      seeds.push({
        patternId: pattern.id,
        address,
        risk: pattern.confidence,
        finalTxid: pattern.finalTxid,
      });
      offer(
        address,
        pattern.confidence,
        0,
        address,
        pattern.id,
        [{ kind: "seed", patternId: pattern.id, txid: pattern.finalTxid, address, risk: pattern.confidence }],
        new Set([address, pattern.finalTxid]),
        row.first_ms,
      );
    }
  }
  while (queue.length) {
    queue.sort(
      (a, b) => b.risk - a.risk || a.address.localeCompare(b.address),
    );
    const current = queue.shift();
    if (walletRisk.get(current.address)?.risk !== current.risk || current.hops >= 4)
      continue;
    check();
    for (const tx of outputStatement.all(current.address, current.afterMs)) {
      if (current.visited.has(tx.txid)) continue;
      const existingTx = transactionRisk.get(tx.txid),
        txPath = [
          ...current.path,
          { kind: "spend", txid: tx.txid, inputAddress: current.address, risk: current.risk },
        ];
      if (
        !existingTx ||
        existingTx.risk < current.risk ||
        (existingTx.risk === current.risk && existingTx.seedPatternId > current.seedPatternId)
      )
        transactionRisk.set(tx.txid, {
          txid: tx.txid,
          risk: current.risk,
          boost: Math.min(30, Math.round(current.risk * 0.3)),
          hops: current.hops + 1,
          seedPatternId: current.seedPatternId,
          path: txPath,
        });
      if (!tx.output_sat) continue;
      const addresses = JSON.parse(tx.output_addresses),
        amounts = JSON.parse(tx.output_amounts);
      for (let index = 0; index < addresses.length; index++) {
        const nextRisk =
          current.risk * 0.65 * Math.sqrt(amounts[index] / tx.output_sat);
        if (nextRisk < 10 || current.visited.has(addresses[index])) continue;
        offer(
          addresses[index],
          nextRisk,
          current.hops + 1,
          current.seedAddress,
          current.seedPatternId,
          [
            ...txPath,
            { kind: "output", txid: tx.txid, address: addresses[index], amountSat: amounts[index], risk: nextRisk },
          ],
          new Set([...current.visited, tx.txid, addresses[index]]),
          tx.first_ms,
        );
      }
    }
  }
  return { seeds, walletRisk, transactionRisk };
}

function prepareFlowAnalysis(db, check = () => {}) {
  prepareFlowTables(db, check);
  const transactions = new Map();
  for (const row of batches(
    db,
    `SELECT * FROM (SELECT t.txid,t.coinjoin,t.output_sat,json_array_length(t.output_addresses) AS outputs,
      f.first_ms,m.equal_output_concentration FROM transactions t
      JOIN flow_first_seen f ON f.txid=t.txid JOIN flow_metrics m ON m.txid=t.txid)`,
  )) {
    transactions.set(row.txid, {
      txid: row.txid,
      coinjoin: !!row.coinjoin,
      outputSat: row.output_sat,
      outputs: row.outputs,
      firstMs: row.first_ms,
      equalConcentration: row.equal_output_concentration,
    });
  }
  const links = [],
    linksBySource = new Map();
  const linkPage = db.prepare(
    `SELECT l.rowid,l.source_txid AS sourceTxid,l.destination_txid AS destinationTxid,
     l.output_position AS outputPosition,l.input_position AS inputPosition,l.address,l.amount_sat AS amountSat,
     l.source_ms AS sourceMs,l.destination_ms AS destinationMs
     FROM flow_links l WHERE l.rowid>? ORDER BY l.rowid LIMIT 1000`,
  );
  let linkCursor = 0;
  while (true) {
    const rows = linkPage.all(linkCursor);
    if (!rows.length) break;
    for (const link of rows) {
      const source = transactions.get(link.sourceTxid),
        destination = transactions.get(link.destinationTxid);
      if (!source.coinjoin && source.outputs >= 2 && source.outputs <= 5) {
        if (!linksBySource.has(link.sourceTxid))
          linksBySource.set(link.sourceTxid, []);
        linksBySource.get(link.sourceTxid).push(link);
      }
      if (source.coinjoin && destination.coinjoin) links.push(link);
    }
    linkCursor = rows.at(-1).rowid;
  }
  const patterns = [
    ...peelingPatterns(transactions, linksBySource, new Map()),
    ...mixingPatterns(transactions, links),
  ].sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id));
  for (const pattern of patterns) {
    const walletSet = new Set();
    const walletStatement = db.prepare(
      "SELECT input_addresses,output_addresses FROM transactions WHERE txid=?",
    );
    for (const txid of pattern.members) {
      const tx = walletStatement.get(txid);
      JSON.parse(tx.input_addresses).forEach((address) => walletSet.add(address));
      JSON.parse(tx.output_addresses).forEach((address) => walletSet.add(address));
    }
    pattern.walletCount = walletSet.size;
    pattern.wallets = [...walletSet].sort();
    pattern.totalSat = transactions.get(pattern.members[0]).outputSat;
    pattern.firstMs = transactions.get(pattern.members[0]).firstMs;
    pattern.lastMs = transactions.get(pattern.members.at(-1)).firstMs;
    pattern.durationMs = Math.max(0, pattern.lastMs - pattern.firstMs);
    pattern.anomaly = null;
  }
  const model = scoreFlowAnomalies(patterns),
    risk = propagateRisk(db, patterns, check),
    patternTypesByTx = new Map();
  for (const pattern of patterns)
    for (const txid of pattern.members) {
      if (!patternTypesByTx.has(txid)) patternTypesByTx.set(txid, new Set());
      patternTypesByTx.get(txid).add(pattern.type);
    }
  const insertContext = db.prepare(
    "INSERT INTO tx_flow_context VALUES(?,?,?,?,?,?,?)",
  );
  for (const txid of transactions.keys()) {
    const txRisk = risk.transactionRisk.get(txid),
      types = patternTypesByTx.get(txid) || new Set();
    insertContext.run(
      txid,
      txRisk?.risk || 0,
      txRisk?.boost || 0,
      txRisk?.hops ?? null,
      txRisk?.seedPatternId || null,
      types.has("peeling") ? 1 : 0,
      types.has("mixing") ? 1 : 0,
    );
  }
  const scalar = (sql) => db.prepare(sql).get().n;
  return {
    version: FLOW_VERSION,
    patterns,
    model,
    risk,
    diagnostics: {
      exactLinks: scalar("SELECT count(*) AS n FROM flow_links"),
      ambiguousOutputs: scalar(
        "SELECT count(*) AS n FROM flow_output_matches WHERE matches>1",
      ),
      ambiguousInputs: scalar(
        "SELECT count(*) AS n FROM flow_input_matches WHERE matches>1",
      ),
      highDegreeAddresses: scalar(
        `SELECT count(*) AS n FROM flow_address_degree WHERE degree>${MAX_MATCH_ADDRESS_DEGREE}`,
      ),
      timestampConflicts: scalar(
        `SELECT count(*) AS n FROM flow_outputs o JOIN flow_address_degree d ON d.address=o.address AND d.degree<=${MAX_MATCH_ADDRESS_DEGREE}
         JOIN flow_inputs i ON i.address=o.address AND i.amount_sat=o.amount_sat
         WHERE o.txid<>i.txid AND o.first_ms>=i.first_ms`,
      ),
      maximumMatchAddressDegree: MAX_MATCH_ADDRESS_DEGREE,
    },
    counts: {
      peeling: patterns.filter((item) => item.type === "peeling").length,
      mixing: patterns.filter((item) => item.type === "mixing").length,
      coinjoinCautions: [...transactions.values()].filter((item) => item.coinjoin)
        .length,
      automaticSeeds: risk.seeds.length,
      exposedWallets: risk.walletRisk.size,
      exposedTransactions: risk.transactionRisk.size,
    },
  };
}

function clearPersistedFlow(db) {
  db.exec(`DELETE FROM transaction_risk;
    DELETE FROM wallet_risk;
    DELETE FROM automatic_pattern_seeds;
    DELETE FROM flow_pattern_members;
    DELETE FROM exact_flow_links;
    DELETE FROM flow_patterns;`);
}

function persistFlowAnalysis(db, analysis, runId) {
  const insertPattern = db.prepare(
      `INSERT INTO flow_patterns(id,type,confidence,anomaly,tx_count,wallet_count,total_sat,first_ms,last_ms,duration_ms,
       continuation_consistency,equal_output_concentration,branching,details,run_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ),
    insertMember = db.prepare(
      "INSERT INTO flow_pattern_members(pattern_id,txid,position,role) VALUES(?,?,?,?)",
    ),
    insertSeed = db.prepare(
      "INSERT INTO automatic_pattern_seeds(pattern_id,address,risk,final_txid,run_id) VALUES(?,?,?,?,?)",
    ),
    insertWalletRisk = db.prepare(
      "INSERT INTO wallet_risk(address,risk,hops,seed_address,seed_pattern_id,path,run_id) VALUES(?,?,?,?,?,?,?)",
    ),
    insertTxRisk = db.prepare(
      "INSERT INTO transaction_risk(txid,risk,boost,hops,seed_pattern_id,path,run_id) VALUES(?,?,?,?,?,?,?)",
    );
  for (const pattern of analysis.patterns) {
    insertPattern.run(
      pattern.id,
      pattern.type,
      pattern.confidence,
      pattern.anomaly,
      pattern.members.length,
      pattern.walletCount,
      pattern.totalSat,
      pattern.firstMs,
      pattern.lastMs,
      pattern.durationMs,
      pattern.continuationConsistency,
      pattern.equalOutputConcentration,
      pattern.branching,
      JSON.stringify({ ratios: pattern.ratios, finalTxid: pattern.finalTxid }),
      runId,
    );
    pattern.members.forEach((txid, position) =>
      insertMember.run(
        pattern.id,
        txid,
        position,
        position === 0 ? "entry" : position === pattern.members.length - 1 ? "exit" : "member",
      ),
    );
  }
  db.prepare(
    `INSERT INTO exact_flow_links(source_txid,destination_txid,address,amount_sat,output_position,input_position,run_id)
     SELECT source_txid,destination_txid,address,amount_sat,output_position,input_position,? FROM flow_links`,
  ).run(runId);
  for (const seed of analysis.risk.seeds)
    insertSeed.run(
      seed.patternId,
      seed.address,
      seed.risk,
      seed.finalTxid,
      runId,
    );
  for (const value of analysis.risk.walletRisk.values())
    insertWalletRisk.run(
      value.address,
      value.risk,
      value.hops,
      value.seedAddress,
      value.seedPatternId,
      JSON.stringify(value.path),
      runId,
    );
  for (const value of analysis.risk.transactionRisk.values())
    insertTxRisk.run(
      value.txid,
      value.risk,
      value.boost,
      value.hops,
      value.seedPatternId,
      JSON.stringify(value.path),
      runId,
    );
}

module.exports = {
  FLOW_VERSION,
  MAX_MATCH_ADDRESS_DEGREE,
  prepareFlowAnalysis,
  persistFlowAnalysis,
  clearPersistedFlow,
  equalOutputConcentration,
  flowVector,
  scoreFlowAnomalies,
};
