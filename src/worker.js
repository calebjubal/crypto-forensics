"use strict";
const { parentPort, workerData } = require("node:worker_threads");
require("./offline").denyNetwork();
const {
  openDatabase,
  importFile,
  deleteImport,
  summary,
  page,
  detail,
  clusterDetail,
  flowOverview,
  flowDetail,
  review,
  audit,
  authenticationStatus,
  createInitialUser,
  authenticate,
} = require("./database");
const { analyze } = require("./analytics");
const { exportReport } = require("./export");
const { createGeoLocator } = require("./geolocation");
const { mapOverview, mapLead } = require("./map");
const db = openDatabase(workerData.database);
const geoLocator = createGeoLocator(workerData.geoip);
const cancellation = new Int32Array(workerData.cancellation);
const cancelled = () => Atomics.load(cancellation, 0) === 1;
let busy = false;
let loginFailures = 0,
  lockedUntil = 0;
parentPort.on("message", async ({ id, action, payload = {}, context = {} }) => {
  if (busy) {
    parentPort.postMessage({
      id,
      error: "A background job is running. Please wait for it to finish.",
    });
    return;
  }
  busy = true;
  const progress = (value) => parentPort.postMessage({ id, progress: value });
  try {
    let result;
    switch (action) {
      case "auth.status":
        result = authenticationStatus(db);
        break;
      case "auth.setup":
        result = createInitialUser(db, payload);
        break;
      case "auth.login": {
        if (Date.now() < lockedUntil)
          throw new Error(
            `Too many failed attempts. Try again in ${Math.ceil((lockedUntil - Date.now()) / 1000)} seconds.`,
          );
        try {
          result = authenticate(db, payload);
          loginFailures = 0;
          lockedUntil = 0;
        } catch (error) {
          if (++loginFailures >= 5) lockedUntil = Date.now() + 30000;
          throw error;
        }
        break;
      }
      case "summary":
        result = summary(db);
        break;
      case "page":
        result = page(db, payload.type, payload.options);
        break;
      case "detail":
        result = detail(db, payload.txid);
        break;
      case "cluster":
        result = clusterDetail(db, payload.id);
        break;
      case "flow-overview":
        result = flowOverview(db, payload);
        break;
      case "flow-detail":
        result = flowDetail(db, payload.id);
        break;
      case "map-overview":
        result = mapOverview(db, geoLocator);
        break;
      case "map-lead":
        result = mapLead(db, payload.txid, geoLocator);
        break;
      case "review":
        result = review(db, payload, context);
        break;
      case "import": {
        result = [];
        for (const file of payload.files) {
          if (cancelled()) break;
          result.push(await importFile(db, file, progress, cancelled, context));
        }
        break;
      }
      case "delete-import":
        result = deleteImport(db, payload.id, context);
        break;
      case "analyze":
        result = analyze(db, progress, cancelled, context);
        break;
      case "errors":
        result = db
          .prepare(
            "SELECT * FROM import_errors WHERE import_id=? ORDER BY row_number LIMIT 200",
          )
          .all(payload.id);
        break;
      case "model": {
        const run = db
          .prepare(
            "SELECT id,created,revision,transaction_count,config FROM analysis_runs ORDER BY rowid DESC LIMIT 1",
          )
          .get();
        result = {
          run,
          audit: db
            .prepare("SELECT * FROM audit ORDER BY id DESC LIMIT 100")
            .all(),
        };
        break;
      }
      case "export":
        result = await exportReport(
          db,
          payload.file,
          payload.format,
          cancelled,
          context,
        );
        break;
      case "audit":
        audit(db, payload.action, payload.details, context);
        result = true;
        break;
      case "close":
        db.close();
        result = true;
        break;
      default:
        throw new Error("Unknown worker operation.");
    }
    parentPort.postMessage({ id, result });
  } catch (error) {
    parentPort.postMessage({ id, error: error.message });
  } finally {
    busy = false;
  }
});
