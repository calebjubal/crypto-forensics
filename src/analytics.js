"use strict";

const { randomUUID, createHash } = require("node:crypto");
const {
  train,
  score: isolationScore,
  seededRandom,
} = require("./isolation-forest");
const { audit } = require("./database");
const { hash } = require("./validation");
const {
  prepareFlowAnalysis,
  persistFlowAnalysis,
  clearPersistedFlow,
} = require("./flow-analysis");
const FEATURE_NAMES = [
  "log_output_btc",
  "fee_ratio",
  "log_inputs",
  "log_outputs",
  "log_observations",
  "log_sources",
  "log_observation_span_seconds",
  "log_source_minute_transactions",
  "log_upstream_transactions",
  "log_downstream_transactions",
  "log_reused_input_addresses",
  "equal_output_concentration",
  "largest_output_share",
  "continuation_ratio",
];
const RULE_VERSION = "2.0.0";
const GRAPH_EMBEDDING = Object.freeze({
  version: "1.0.0",
  projection: "SHA-256 signed bipartite-neighborhood projection",
  dimensions: 32,
  inputWeight: 0.6,
  outputWeight: 1,
  minimumSharedContexts: 2,
  minimumCosine: 0.82,
  maximumCandidateOutputs: 40,
  maximumClusterSize: 100,
});

function graphProjection(txid, side) {
  const digest = createHash("sha256").update(`${side}:${txid}`).digest(),
    scale = 1 / Math.sqrt(GRAPH_EMBEDDING.dimensions);
  return Float64Array.from(
    { length: GRAPH_EMBEDDING.dimensions },
    (_, index) => (digest[index] >= 128 ? 1 : -1) * scale,
  );
}

function addProjection(embeddings, key, projection, weight) {
  let vector = embeddings.get(key);
  if (!vector) {
    vector = new Float64Array(GRAPH_EMBEDDING.dimensions);
    embeddings.set(key, vector);
  }
  for (let index = 0; index < vector.length; index++)
    vector[index] += projection[index] * weight;
}

function cosineSimilarity(left, right) {
  if (!left || !right) return 0;
  let dot = 0,
    leftNorm = 0,
    rightNorm = 0;
  for (let index = 0; index < left.length; index++) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  return leftNorm && rightNorm
    ? dot / Math.sqrt(leftNorm * rightNorm)
    : 0;
}

function vector(row) {
  return [
    Math.log1p(row.output_sat / 1e8),
    row.input_sat ? row.fee_sat / row.input_sat : 0,
    Math.log1p(row.inputs),
    Math.log1p(row.outputs),
    Math.log1p(row.observations),
    Math.log1p(row.sources),
    Math.log1p(row.span_ms / 1000),
    Math.log1p(row.burst),
    Math.log1p(row.upstream_transactions),
    Math.log1p(row.downstream_transactions),
    Math.log1p(row.reused_inputs),
    row.equal_output_concentration,
    row.largest_output_share,
    row.continuation_ratio,
  ];
}
function median(values) {
  const sorted = values.slice().sort((a, b) => a - b),
    n = sorted.length;
  return n
    ? (sorted[Math.floor(n / 2)] + sorted[Math.floor((n - 1) / 2)]) / 2
    : 0;
}
function* chunks(db, sql, cursorColumn) {
  let cursor = "";
  const statement = db.prepare(
    `${sql} WHERE ${cursorColumn}>? ORDER BY ${cursorColumn} LIMIT 1000`,
  );
  while (true) {
    const rows = statement.all(cursor);
    if (!rows.length) return;
    yield* rows;
    cursor = String(rows[rows.length - 1][cursorColumn]);
  }
}

function reasonsFor(row, anomaly, baseline) {
  const reasons = [];
  const add = (code, category, points, explanation) =>
    reasons.push({ code, category, points, explanation });
  const amount = row.output_sat / 1e8,
    ratio = row.input_sat ? row.fee_sat / row.input_sat : 0;
  if (amount >= 100 && Math.log1p(amount) > baseline.amountCutoff)
    add(
      "VALUE_OUTLIER",
      "Value anomaly",
      25,
      `${amount.toFixed(8)} BTC output exceeds 100 BTC and the robust dataset cutoff of ${Math.expm1(baseline.amountCutoff).toFixed(4)} BTC. Large transfers can be legitimate.`,
    );
  if (ratio > 0.05 && row.fee_sat >= 10000)
    add(
      "HIGH_FEE",
      "Fee anomaly",
      28,
      `Fee is ${(ratio * 100).toFixed(2)}% of input value (${(row.fee_sat / 1e8).toFixed(8)} BTC); threshold is >5% and ≥0.0001 BTC. Incomplete input metadata can produce misleading fees.`,
    );
  if (row.outputs >= 10)
    add(
      "FAN_OUT",
      "Transaction structure",
      20,
      `${row.outputs} outputs meet the ≥10-output fan-out threshold. Exchange payouts and batching are common benign explanations.`,
    );
  if (row.inputs >= 10 && !row.coinjoin)
    add(
      "CONSOLIDATION",
      "Transaction structure",
      18,
      `${row.inputs} inputs meet the ≥10-input consolidation threshold. This does not establish illicit activity.`,
    );
  if (row.burst >= 12)
    add(
      "SOURCE_BURST",
      "Network burst",
      28,
      `A source IP associated with this TXID observed ${row.burst} distinct TXIDs within one UTC minute; threshold is ≥12. Relays, NAT and shared infrastructure can explain this pattern.`,
    );
  if (row.observations >= 30 && row.sources >= 8)
    add(
      "PROPAGATION",
      "Propagation pattern",
      10,
      `${row.observations} observations across ${row.sources} source IPs. Coverage differences and normal propagation can explain this.`,
    );
  if (anomaly !== null && anomaly >= 0.55) {
    const points = anomaly >= 0.62 ? 22 : 12;
    add(
      "ISOLATION_FOREST",
      "Statistical outlier",
      points,
      `Isolation Forest score ${anomaly.toFixed(3)} exceeds 0.55${anomaly >= 0.62 ? " (strong threshold 0.62)" : ""}. This is relative unusualness, not a probability of wrongdoing. Inspect the measured features against the saved baseline.`,
    );
  }
  if (row.coinjoin)
    add(
      "COLLABORATIVE_CAUTION",
      "Clustering caution",
      0,
      "At least 3 inputs and 3 equal-valued outputs suggest a possible collaborative transaction. Common-input clustering was excluded for this transaction; this pattern is not itself suspicious.",
    );
  if (row.peeling)
    add(
      "PEELING_CHAIN",
      "Flow pattern",
      25,
      "This transaction belongs to a conservative peeling-chain hypothesis reconstructed from exact address-and-satoshi continuation links. Pattern membership does not prove laundering or common ownership.",
    );
  else if (row.mixing)
    add(
      "MIXING_CASCADE",
      "Flow pattern",
      20,
      "This transaction belongs to a sequence of at least two directly linked CoinJoin-like structures. The structure is an investigative hypothesis, not proof of laundering.",
    );
  if (row.risk_boost > 0)
    add(
      "PROPAGATED_EXPOSURE",
      "Exposure risk",
      row.risk_boost,
      `Strongest automatic-pattern exposure is ${Number(row.exposure_risk).toFixed(1)}/100 at hop ${row.risk_hops}; the explainable lead boost is capped at 30 points. Exposure is not an illicit-status label.`,
    );
  return reasons;
}

function analyze(
  db,
  onProgress = () => {},
  cancelled = () => false,
  context = {},
) {
  const check = () => {
    if (cancelled())
      throw new Error("Analysis cancelled; previous results preserved.");
  };
  const total = db.prepare("SELECT count(*) AS n FROM transactions").get().n;
  if (!total) throw new Error("Import evidence before running analysis.");
  const id = randomUUID(),
    created = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    onProgress({
      phase: "Reconstructing exact address and amount flows",
      percent: 5,
    });
    check();
    const flowAnalysis = prepareFlowAnalysis(db, check);
    onProgress({
      phase: "Detecting conservative flow patterns and exposure paths",
      percent: 18,
    });
    check();
    db.exec(`DROP TABLE IF EXISTS temp.source_minutes; DROP TABLE IF EXISTS temp.tx_bursts; DROP TABLE IF EXISTS temp.features;
      CREATE TEMP TABLE source_minutes AS SELECT src_ip,CAST(ts_ms/60000 AS INTEGER) AS minute,count(DISTINCT txid) AS n FROM observations GROUP BY src_ip,minute;
      CREATE INDEX temp.source_minutes_idx ON source_minutes(src_ip,minute);
      CREATE TEMP TABLE tx_bursts AS SELECT o.txid,max(s.n) AS burst FROM observations o JOIN source_minutes s ON s.src_ip=o.src_ip AND s.minute=CAST(o.ts_ms/60000 AS INTEGER) GROUP BY o.txid;
      CREATE UNIQUE INDEX temp.tx_bursts_idx ON tx_bursts(txid);
      CREATE TEMP TABLE features AS SELECT t.txid,t.output_sat,t.input_sat,t.fee_sat,t.coinjoin,
        json_array_length(t.input_addresses) AS inputs,json_array_length(t.output_addresses) AS outputs,
        count(o.id) AS observations,count(DISTINCT o.src_ip) AS sources,
        max(o.ts_ms)-min(o.ts_ms) AS span_ms,b.burst,
        fm.upstream_transactions,fm.downstream_transactions,fm.reused_inputs,
        fm.equal_output_concentration,fm.largest_output_share,fm.continuation_ratio,
        fc.exposure_risk,fc.risk_boost,fc.risk_hops,fc.seed_pattern_id,fc.peeling,fc.mixing
        FROM transactions t JOIN observations o ON o.txid=t.txid JOIN tx_bursts b ON b.txid=t.txid
        JOIN flow_metrics fm ON fm.txid=t.txid JOIN tx_flow_context fc ON fc.txid=t.txid GROUP BY t.txid;
      CREATE UNIQUE INDEX temp.features_idx ON features(txid);`);
    check();
    const random = seededRandom(73129),
      reservoir = [],
      digest = createHash("sha256");
    let seen = 0;
    for (const row of chunks(db, "SELECT * FROM features", "txid")) {
      check();
      const values = vector(row);
      digest.update(JSON.stringify(row));
      seen++;
      if (reservoir.length < 8192) reservoir.push(values);
      else {
        const position = Math.floor(random() * seen);
        if (position < 8192) reservoir[position] = values;
      }
    }
    const centers = FEATURE_NAMES.map((_, index) =>
      median(reservoir.map((row) => row[index])),
    );
    const deviations = FEATURE_NAMES.map((_, index) =>
      median(reservoir.map((row) => Math.abs(row[index] - centers[index]))),
    );
    const baseline = {
      medians: centers,
      mad: deviations,
      amountCutoff: centers[0] + 6 * Math.max(0.1, deviations[0]),
    };
    onProgress({ phase: "Training local transaction Isolation Forest", percent: 30 });
    const model = train(reservoir);
    check();
    const revision = Number(
      db.prepare("SELECT value FROM metadata WHERE key='revision'").get().value,
    );
    const config = {
      ruleVersion: RULE_VERSION,
      featureNames: FEATURE_NAMES,
      seed: 73129,
      trees: 64,
      maxTrainingRows: 8192,
      trainingRows: reservoir.length,
      subsample: 256,
      modelAvailable: !!model,
      minimumModelRows: 32,
      priorityThresholds: { Critical: 75, High: 50, Medium: 25, Low: 0 },
      baseline,
      featureSha256: digest.digest("hex"),
      clustering:
        "Common-input ownership plus deterministic 32-dimensional transaction-graph embeddings; excludes collaborative patterns and never uses IP or change-address ownership heuristics.",
      graphEmbedding: {
        ...GRAPH_EMBEDDING,
        candidatePairs: 0,
        acceptedLinks: 0,
      },
      flowAnalysis: {
        version: flowAnalysis.version,
        modelAvailable: !!flowAnalysis.model,
        minimumModelRows: 32,
        thresholds: { caution: 0.55, strong: 0.62 },
        patternCounts: flowAnalysis.counts,
        diagnostics: flowAnalysis.diagnostics,
        risk: {
          maximumHops: 4,
          hopDecay: 0.65,
          cutoff: 10,
          formula:
            "current risk × 0.65 × sqrt(output amount / transaction output total)",
        },
      },
    };
    db.prepare("INSERT INTO analysis_runs VALUES(?,?,?,?,?,?)").run(
      id,
      created,
      revision,
      total,
      JSON.stringify(config),
      JSON.stringify({ transaction: model, flow: flowAnalysis.model }),
    );
    db.exec("DELETE FROM lead_scores;");
    clearPersistedFlow(db);
    persistFlowAnalysis(db, flowAnalysis, id);
    db.exec(
      "DELETE FROM cluster_embedding_links; DELETE FROM cluster_members; DELETE FROM clusters;",
    );
    const insert = db.prepare(
      "INSERT INTO lead_scores VALUES(?,?,?,?,?,?,?,?)",
    );
    seen = 0;
    for (const row of chunks(db, "SELECT * FROM features", "txid")) {
      check();
      const anomaly = isolationScore(model, vector(row)),
        reasons = reasonsFor(row, anomaly, baseline);
      const score = Math.min(
        100,
        reasons.reduce((sum, reason) => sum + reason.points, 0),
      );
      const priority =
        score >= 75
          ? "Critical"
          : score >= 50
            ? "High"
            : score >= 25
              ? "Medium"
              : "Low";
      const primary = reasons
        .slice()
        .sort((a, b) => b.points - a.points)
        .find((reason) => reason.points > 0);
      insert.run(
        row.txid,
        score,
        priority,
        primary?.category || "Baseline",
        JSON.stringify(reasons),
        anomaly,
        JSON.stringify(row),
        id,
      );
      if (++seen % 1000 === 0)
        onProgress({
          phase: "Scoring transactions",
          percent: 35 + Math.round((seen / total) * 30),
        });
    }
    onProgress({
      phase: "Building common-input and graph-embedding hypotheses",
      percent: 70,
    });
    // Memory is O(unique addresses); transaction features, scores, and graph-context pairs remain in SQLite.
    const parents = new Map();
    function find(value) {
      if (!parents.has(value)) parents.set(value, value);
      let root = value;
      while (parents.get(root) !== root) root = parents.get(root);
      while (parents.get(value) !== value) {
        const next = parents.get(value);
        parents.set(value, root);
        value = next;
      }
      return root;
    }
    function union(a, b) {
      a = find(a);
      b = find(b);
      if (a !== b) parents.set(a < b ? b : a, a < b ? a : b);
    }
    for (const row of chunks(
      db,
      "SELECT DISTINCT address FROM addresses",
      "address",
    )) {
      check();
      find(row.address);
    }
    for (const row of chunks(
      db,
      "SELECT txid,input_addresses,coinjoin FROM transactions",
      "txid",
    )) {
      if (row.coinjoin) continue;
      check();
      const inputs = JSON.parse(row.input_addresses);
      for (let i = 1; i < inputs.length; i++) union(inputs[0], inputs[i]);
    }
    onProgress({
      phase: "Comparing repeated graph neighborhoods",
      percent: 80,
    });
    db.exec(`DROP TABLE IF EXISTS temp.embedding_contexts;
      CREATE TEMP TABLE embedding_contexts(left_root TEXT NOT NULL,right_root TEXT NOT NULL,contexts INTEGER NOT NULL,
        PRIMARY KEY(left_root,right_root));`);
    const embeddings = new Map(),
      inputRoots = new Set(),
      addSharedContext = db.prepare(
        `INSERT INTO embedding_contexts VALUES(?,?,1)
          ON CONFLICT(left_root,right_root) DO UPDATE SET contexts=contexts+1`,
      );
    for (const row of chunks(
      db,
      "SELECT txid,input_addresses,output_addresses,coinjoin FROM transactions",
      "txid",
    )) {
      check();
      const inputs = JSON.parse(row.input_addresses),
        outputs = JSON.parse(row.output_addresses),
        inputProjection = graphProjection(row.txid, "input"),
        outputProjection = graphProjection(row.txid, "output");
      for (const address of inputs) {
        const root = find(address);
        inputRoots.add(root);
        addProjection(
          embeddings,
          root,
          inputProjection,
          GRAPH_EMBEDDING.inputWeight,
        );
      }
      for (const address of outputs)
        addProjection(
          embeddings,
          find(address),
          outputProjection,
          GRAPH_EMBEDDING.outputWeight,
        );
      if (
        row.coinjoin ||
        outputs.length < 2 ||
        outputs.length > GRAPH_EMBEDDING.maximumCandidateOutputs
      )
        continue;
      const roots = [...new Set(outputs.map((address) => find(address)))].sort();
      for (let left = 0; left < roots.length; left++)
        for (let right = left + 1; right < roots.length; right++)
          addSharedContext.run(roots[left], roots[right]);
    }
    const commonInputSizes = new Map();
    for (const address of parents.keys()) {
      const root = find(address);
      commonInputSizes.set(root, (commonInputSizes.get(root) || 0) + 1);
    }
    const candidates = [];
    const candidateStatement = db.prepare(
      "SELECT rowid,left_root AS left,right_root AS right,contexts FROM embedding_contexts WHERE rowid>? AND contexts>=? ORDER BY rowid LIMIT 1000",
    );
    let candidateCursor = 0;
    while (true) {
      const rows = candidateStatement.all(
        candidateCursor,
        GRAPH_EMBEDDING.minimumSharedContexts,
      );
      if (!rows.length) break;
      for (const { left, right, contexts } of rows) {
        if (!inputRoots.has(left) || !inputRoots.has(right)) continue;
        const similarity = cosineSimilarity(
          embeddings.get(left),
          embeddings.get(right),
        );
        if (similarity < GRAPH_EMBEDDING.minimumCosine) continue;
        candidates.push({ left, right, contexts, similarity });
      }
      candidateCursor = rows[rows.length - 1].rowid;
    }
    candidates.sort(
      (a, b) =>
        b.contexts - a.contexts ||
        b.similarity - a.similarity ||
        a.left.localeCompare(b.left) ||
        a.right.localeCompare(b.right),
    );
    const acceptedEmbeddingLinks = [];
    for (const candidate of candidates) {
      check();
      const left = find(candidate.left),
        right = find(candidate.right);
      if (left === right) continue;
      const combined =
        (commonInputSizes.get(left) || 0) + (commonInputSizes.get(right) || 0);
      if (combined > GRAPH_EMBEDDING.maximumClusterSize) continue;
      union(left, right);
      const merged = find(left);
      commonInputSizes.delete(left);
      commonInputSizes.delete(right);
      commonInputSizes.set(merged, combined);
      acceptedEmbeddingLinks.push(candidate);
    }
    config.graphEmbedding.candidatePairs = candidates.length;
    config.graphEmbedding.acceptedLinks = acceptedEmbeddingLinks.length;
    db.prepare("UPDATE analysis_runs SET config=? WHERE id=?").run(
      JSON.stringify(config),
      id,
    );
    const sizes = new Map();
    for (const addr of parents.keys()) {
      const root = find(addr);
      sizes.set(root, (sizes.get(root) || 0) + 1);
    }
    const insertCluster = db.prepare("INSERT INTO clusters VALUES(?,?,0)"),
      insertMember = db.prepare("INSERT INTO cluster_members VALUES(?,?)");
    const ids = new Map();
    for (const [root, size] of sizes) {
      check();
      const clusterId = `ENT-${hash(root).slice(0, 16).toUpperCase()}`;
      ids.set(root, clusterId);
      insertCluster.run(clusterId, size);
    }
    for (const addr of parents.keys()) {
      check();
      insertMember.run(addr, ids.get(find(addr)));
    }
    const insertEmbeddingLink = db.prepare(
      "INSERT INTO cluster_embedding_links VALUES(?,?,?,?,?)",
    );
    for (const link of acceptedEmbeddingLinks) {
      check();
      insertEmbeddingLink.run(
        ids.get(find(link.left)),
        link.left,
        link.right,
        link.similarity,
        link.contexts,
      );
    }
    db.exec(
      `UPDATE clusters SET tx_count=(SELECT count(DISTINCT a.txid) FROM addresses a JOIN cluster_members m ON m.address=a.address WHERE m.cluster_id=clusters.id)`,
    );
    check();
    audit(
      db,
      "analysis.completed",
      {
        id,
        transactions: total,
        model: model
          ? "Isolation Forest"
          : "Rules only: fewer than 32 transactions",
        ruleVersion: RULE_VERSION,
        flowPatterns: flowAnalysis.patterns.length,
        automaticSeeds: flowAnalysis.counts.automaticSeeds,
        exposedWallets: flowAnalysis.counts.exposedWallets,
        graphEmbeddingLinks: acceptedEmbeddingLinks.length,
      },
      context,
    );
    db.exec("COMMIT");
    onProgress({ phase: "Analysis complete", percent: 100 });
    return { id, created, transactions: total, modelAvailable: !!model };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.exec(
      `DROP TABLE IF EXISTS temp.embedding_contexts; DROP TABLE IF EXISTS temp.features; DROP TABLE IF EXISTS temp.tx_bursts; DROP TABLE IF EXISTS temp.source_minutes;
       DROP TABLE IF EXISTS temp.tx_flow_context; DROP TABLE IF EXISTS temp.flow_metrics; DROP TABLE IF EXISTS temp.flow_links;
       DROP TABLE IF EXISTS temp.flow_input_matches; DROP TABLE IF EXISTS temp.flow_output_matches; DROP TABLE IF EXISTS temp.flow_candidates;
       DROP TABLE IF EXISTS temp.flow_address_degree; DROP TABLE IF EXISTS temp.flow_outputs; DROP TABLE IF EXISTS temp.flow_inputs;
       DROP TABLE IF EXISTS temp.flow_first_seen;`,
    );
  }
}

module.exports = {
  analyze,
  vector,
  reasonsFor,
  cosineSimilarity,
  GRAPH_EMBEDDING,
  RULE_VERSION,
  FEATURE_NAMES,
};
