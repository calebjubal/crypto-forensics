"use strict";

const fs = require("node:fs");
const { once } = require("node:events");
const { audit } = require("./database");

// Prevent spreadsheet formula execution in exported text cells.
function csvCell(value) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

async function exportReport(
  db,
  file,
  format = "json",
  cancelled = () => false,
  context = {},
) {
  if (!["csv", "json"].includes(format))
    throw new Error("Unsupported report format.");
  const stream = fs.createWriteStream(file, { flags: "wx" });
  let failure;
  stream.on("error", (error) => {
    failure = error;
  });
  async function write(value) {
    if (failure) throw failure;
    if (!stream.write(value)) await once(stream, "drain");
  }
  try {
    const run = db
      .prepare("SELECT * FROM analysis_runs ORDER BY rowid DESC LIMIT 1")
      .get();
    const imports = db.prepare("SELECT * FROM imports ORDER BY created").all();
    const revision = Number(
      db.prepare("SELECT value FROM metadata WHERE key='revision'").get().value,
    ),
      schemaVersion = Number(
        db.prepare("SELECT value FROM metadata WHERE key='schema_version'").get()
          .value,
      );
    const metadata = {
      application: "Satoshi Trace",
      exportedAt: new Date().toISOString(),
      schemaVersion,
      warning:
        "Investigative hypotheses only. Scores and propagated exposure are not probabilities or declarations of wrongdoing. Address reuse, CoinJoin-like structure, anomaly, IP observations, and inferred links do not prove laundering, identity, or wallet ownership.",
      stale: !run || run.revision !== revision,
      analysis: run
        ? {
            ...run,
            config: JSON.parse(run.config),
            model: JSON.parse(run.model),
          }
        : null,
      imports,
    };
    if (format === "json")
      await write(JSON.stringify(metadata).slice(0, -1) + ',"leads":[\n');
    else
      await write(
        [
          "txid",
          "score",
          "priority",
          "category",
          "status",
          "explanation",
          "notes",
          "exposure_risk",
          "risk_boost",
          "pattern_types",
          "risk_hops",
          "seed_pattern_id",
          "strongest_risk_path",
          "run_id",
          "results_stale",
        ]
          .map(csvCell)
          .join(",") + "\r\n",
      );
    let count = 0,
      offset = 0;
    const leadPage = db.prepare(
      `SELECT l.*,coalesce(r.status,'New') AS status,coalesce(r.notes,'') AS notes,
       coalesce(tr.risk,0) AS exposure_risk,coalesce(tr.boost,0) AS risk_boost,tr.hops AS risk_hops,
       tr.seed_pattern_id,tr.path AS strongest_risk_path,
       (SELECT group_concat(type,',') FROM (SELECT DISTINCT p.type FROM flow_patterns p JOIN flow_pattern_members pm ON pm.pattern_id=p.id WHERE pm.txid=l.txid ORDER BY p.type)) AS pattern_types
       FROM lead_scores l LEFT JOIN lead_reviews r ON r.txid=l.txid LEFT JOIN transaction_risk tr ON tr.txid=l.txid
       WHERE l.score>=25 ORDER BY l.score DESC,l.txid LIMIT 500 OFFSET ?`,
    );
    while (true) {
      const rows = leadPage.all(offset);
      if (!rows.length) break;
      for (const row of rows) {
        if (cancelled()) throw new Error("Export cancelled.");
        row.reasons = JSON.parse(row.reasons);
        row.features = JSON.parse(row.features);
        if (row.strongest_risk_path)
          row.strongest_risk_path = JSON.parse(row.strongest_risk_path);
        if (format === "json") {
          row.observations = db
            .prepare("SELECT * FROM observations WHERE txid=? ORDER BY ts_ms,id")
            .all(row.txid);
          row.blockchain = db
            .prepare("SELECT * FROM transactions WHERE txid=?")
            .get(row.txid);
          row.provenance = db
            .prepare(
              "SELECT p.* FROM provenance p JOIN observations o ON o.id=p.observation_id WHERE o.txid=?",
            )
            .all(row.txid);
          await write((count ? ",\n" : "") + JSON.stringify(row));
        } else
          await write(
            [
              row.txid,
              row.score,
              row.priority,
              row.category,
              row.status,
              row.reasons
                .map((r) => `${r.code} (+${r.points}): ${r.explanation}`)
                .join(" | "),
              row.notes,
              Number(row.exposure_risk).toFixed(3),
              row.risk_boost,
              row.pattern_types || "",
              row.risk_hops ?? "",
              row.seed_pattern_id || "",
              row.strongest_risk_path
                ? JSON.stringify(row.strongest_risk_path)
                : "",
              row.run_id,
              metadata.stale,
            ]
              .map(csvCell)
              .join(",") + "\r\n",
          );
        count++;
      }
      offset += rows.length;
    }
    if (format === "json") {
      const writeJsonRows = async (sql, parse = []) => {
        const statement = db.prepare(`${sql} LIMIT 500 OFFSET ?`);
        let pageOffset = 0,
          written = 0;
        await write("[");
        while (true) {
          const rows = statement.all(pageOffset);
          if (!rows.length) break;
          for (const row of rows) {
            if (cancelled()) throw new Error("Export cancelled.");
            for (const field of parse)
              if (row[field]) row[field] = JSON.parse(row[field]);
            await write((written++ ? "," : "") + JSON.stringify(row));
          }
          pageOffset += rows.length;
        }
        await write("]");
      };
      await write('],"flowAnalysis":{"patterns":');
      await writeJsonRows("SELECT * FROM flow_patterns ORDER BY type,id", [
        "details",
      ]);
      await write(',"members":');
      await writeJsonRows(
        "SELECT * FROM flow_pattern_members ORDER BY pattern_id,position",
      );
      await write(',"automaticSeeds":');
      await writeJsonRows(
        "SELECT * FROM automatic_pattern_seeds ORDER BY pattern_id,address",
      );
      await write(',"walletRisk":');
      await writeJsonRows(
        "SELECT * FROM wallet_risk ORDER BY risk DESC,address",
        ["path"],
      );
      await write(',"transactionRisk":');
      await writeJsonRows(
        "SELECT * FROM transaction_risk ORDER BY risk DESC,txid",
        ["path"],
      );
      await write(',"exactLinks":');
      await writeJsonRows(
        "SELECT * FROM exact_flow_links ORDER BY source_txid,output_position,destination_txid,input_position",
      );
      await write('},"audit":');
      await writeJsonRows("SELECT * FROM audit ORDER BY id");
      await write("}");
    }
    stream.end();
    await once(stream, "finish");
    audit(db, "report.exported", { format, leads: count }, context);
    return { file, count };
  } catch (error) {
    stream.destroy();
    throw error;
  }
}
module.exports = { exportReport, csvCell };
