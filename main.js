"use strict";
const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  session,
  Menu,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { Worker } = require("node:worker_threads");
require("./src/offline").denyNetwork();

// Direct local files and OS IPC only: no web server, updater or remote debugger.
for (const flag of [
  "disable-background-networking",
  "disable-component-update",
  "disable-domain-reliability",
  "disable-sync",
  "no-pings",
  "disable-breakpad",
])
  app.commandLine.appendSwitch(flag);
app.commandLine.appendSwitch("host-resolver-rules", "MAP * ~NOTFOUND");
app.commandLine.appendSwitch(
  "force-webrtc-ip-handling-policy",
  "disable_non_proxied_udp",
);
app.commandLine.appendSwitch(
  "disable-features",
  "MediaRouter,OptimizationHints,AutofillServerCommunication,WebRtcHideLocalIpsWithMdns",
);
app.commandLine.appendSwitch("no-proxy-server");
if (process.env.SATOSHI_TEST_DATA && !app.isPackaged)
  app.setPath("userData", path.resolve(process.env.SATOSHI_TEST_DATA));
app.setName("Satoshi Trace");
let win,
  worker,
  nextId = 0,
  activeJob = false,
  authSession = null,
  quitting = false;
const pending = new Map(),
  cancellation = new SharedArrayBuffer(4);
const indexPath = path.join(__dirname, "index.html");
function request(action, payload, context = authSession || {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, action, payload, context });
  });
}
function handle(channel, fn, authenticated = true) {
  ipcMain.handle(channel, async (event, payload) => {
    let localMainFrame = false;
    try {
      const { fileURLToPath } = require("node:url");
      localMainFrame =
        !event.senderFrame.parent &&
        path.resolve(fileURLToPath(event.senderFrame.url)).toLowerCase() ===
          path.resolve(indexPath).toLowerCase();
    } catch {}
    if (event.sender !== win?.webContents || !localMainFrame)
      throw new Error("Untrusted IPC sender.");
    if (authenticated && !authSession) {
      request(
        "audit",
        { action: "security.unauthenticated_ipc", details: { channel } },
        {},
      ).catch(() => {});
      throw new Error("Authentication required.");
    }
    return fn(payload);
  });
}
async function job(action, payload) {
  if (activeJob) throw new Error("Another operation is already running.");
  activeJob = true;
  Atomics.store(new Int32Array(cancellation), 0, 0);
  win.webContents.send("job-progress", { phase: "Starting", percent: 0 });
  try {
    return await request(action, payload);
  } catch (error) {
    await request("audit", {
      action: `${action}.failed`,
      details: { message: error.message },
    }).catch(() => {});
    throw error;
  } finally {
    activeJob = false;
    if (!win.isDestroyed()) win.webContents.send("job-progress", null);
  }
}
app
  .whenReady()
  .then(async () => {
    Menu.setApplicationMenu(null);
    const ses = session.defaultSession;
    ses.setPermissionRequestHandler((contents, permission, callback) =>
      callback(false),
    );
    ses.setPermissionCheckHandler(() => false);
    ses.on("will-download", (event) => event.preventDefault());
    ses.webRequest.onBeforeRequest(
      { urls: ["<all_urls>"] },
      (details, callback) => {
        let allowed = false;
        try {
          const url = new URL(details.url);
          if (url.protocol === "file:") {
            const { fileURLToPath } = require("node:url");
            const relative = path.relative(__dirname, fileURLToPath(url));
            allowed = !relative.startsWith("..") && !path.isAbsolute(relative);
          }
        } catch {}
        callback({ cancel: !allowed });
      },
    );
    worker = new Worker(path.join(__dirname, "src", "worker.js"), {
      workerData: {
        database: path.join(app.getPath("userData"), "evidence", "case.sqlite"),
        geoip: path.join(
          __dirname,
          "assets",
          "geoip",
          "dbip-city-lite-2026-09.mmdb",
        ),
        cancellation,
      },
    });
    worker.on("message", (message) => {
      if ("progress" in message) {
        if (win && !win.isDestroyed())
          win.webContents.send("job-progress", message.progress);
        return;
      }
      const waiting = pending.get(message.id);
      if (!waiting) return;
      pending.delete(message.id);
      message.error
        ? waiting.reject(new Error(message.error))
        : waiting.resolve(message.result);
    });
    worker.on("error", (error) => {
      for (const p of pending.values()) p.reject(error);
      pending.clear();
      if (win && !win.isDestroyed())
        win.webContents.send("fatal-error", error.message);
    });
    worker.on("exit", (code) => {
      if (code !== 0) {
        for (const p of pending.values())
          p.reject(
            new Error(
              `Evidence worker stopped (${code}). Restart the application.`,
            ),
          );
        pending.clear();
      }
    });
    await request(
      "audit",
      {
        action: "app.started",
        details: {
          version: app.getVersion(),
          electron: process.versions.electron,
        },
      },
      {},
    );
    handle(
      "auth-status",
      async () => ({
        ...(await request("auth.status", {}, {})),
        authenticated: !!authSession,
        username: authSession?.username || null,
      }),
      false,
    );
    handle(
      "auth-setup",
      async (payload) => {
        const account = await request("auth.setup", payload, {});
        authSession = { username: account.username, sessionId: randomUUID() };
        await request("audit", {
          action: "auth.session_started",
          details: { method: "initial-setup" },
        });
        return { username: account.username };
      },
      false,
    );
    handle(
      "auth-login",
      async (payload) => {
        const account = await request("auth.login", payload, {});
        authSession = { username: account.username, sessionId: randomUUID() };
        await request("audit", {
          action: "auth.session_started",
          details: { method: "password" },
        });
        return { username: account.username };
      },
      false,
    );
    handle("auth-logout", async () => {
      await request("audit", { action: "auth.logged_out", details: {} });
      authSession = null;
      return true;
    });
    handle("summary", () => request("summary"));
    handle("page", (payload) => request("page", payload));
    handle("detail", (payload) => request("detail", payload));
    handle("cluster", (payload) => request("cluster", payload));
    handle("flow-overview", (payload) => request("flow-overview", payload));
    handle("flow-detail", (payload) => request("flow-detail", payload));
    handle("map-overview", () => request("map-overview"));
    handle("map-lead", (payload) => request("map-lead", payload));
    handle("review", (payload) => request("review", payload));
    handle("errors", (payload) => request("errors", payload));
    handle("model", () => request("model"));
    handle("analyze", () => job("analyze"));
    handle("cancel", () => {
      Atomics.store(new Int32Array(cancellation), 0, 1);
      request("audit", {
        action: "operation.cancel_requested",
        details: {},
      }).catch(() => {});
      return true;
    });
    handle("import", async () => {
      const selection = await dialog.showOpenDialog(win, {
        title: "Import offline evidence",
        properties: ["openFile", "multiSelections"],
        filters: [
          { name: "Bitcoin metadata", extensions: ["csv", "json", "xml"] },
        ],
      });
      if (selection.canceled) {
        await request("audit", {
          action: "import.selection_cancelled",
          details: {},
        });
        return null;
      }
      for (const file of selection.filePaths)
        if (file.startsWith("\\\\"))
          throw new Error(
            "Network-share paths are not allowed. Copy evidence to a local drive first.",
          );
      await request("audit", {
        action: "import.files_selected",
        details: {
          count: selection.filePaths.length,
          names: selection.filePaths.map((file) => path.basename(file)),
        },
      });
      return job("import", { files: selection.filePaths });
    });
    handle("delete-import", async (payload) => {
      const data = await request("summary");
      const source = data.imports.find((item) => item.id === payload?.id);
      if (!source) throw new Error("Evidence source not found.");
      const choice = await dialog.showMessageBox(win, {
        type: "warning",
        title: "Remove ingested evidence",
        message: `Remove ${source.name} from this case?`,
        detail:
          "Rows unique to this source will be removed. Shared observations from other sources remain. Derived leads, clusters, flow patterns, and exposure paths will be cleared until analysis is run again. The original file on disk will not be deleted.",
        buttons: ["Remove source", "Cancel"],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      if (choice.response !== 0) {
        await request("audit", {
          action: "import.delete_cancelled",
          details: { id: source.id, name: source.name },
        });
        return null;
      }
      return job("delete-import", { id: source.id });
    });
    handle("export", async (payload) => {
      const format = payload?.format === "csv" ? "csv" : "json";
      const selected = await dialog.showSaveDialog(win, {
        title: "Export investigative leads",
        defaultPath: `satoshi-leads-${Date.now()}.${format}`,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      });
      if (selected.canceled) {
        await request("audit", {
          action: "report.export_cancelled",
          details: { format },
        });
        return null;
      }
      if (selected.filePath.startsWith("\\\\"))
        throw new Error("Use a local path.");
      const temp = selected.filePath + `.${Date.now()}.partial`;
      try {
        const result = await job("export", { file: temp, format });
        fs.renameSync(temp, selected.filePath);
        return { ...result, file: selected.filePath };
      } catch (error) {
        try {
          fs.unlinkSync(temp);
        } catch {}
        throw error;
      }
    });
    handle("environment", () => ({
      application: app.getVersion(),
      electron: process.versions.electron,
      node: process.versions.node,
      database: path.join(app.getPath("userData"), "evidence", "case.sqlite"),
      transport: "Electron IPC / worker MessagePort",
      network: "Blocked",
      ports: 0,
      geoip: "DB-IP City Lite · September 2026 · bundled offline",
    }));
    handle("audit-event", (payload) =>
      request("audit", {
        action: String(payload?.action || "ui.event").slice(0, 100),
        details:
          payload?.details && typeof payload.details === "object"
            ? payload.details
            : {},
      }),
    );
    win = new BrowserWindow({
      width: 1480,
      height: 960,
      minWidth: 1060,
      minHeight: 720,
      backgroundColor: "#f4f6f9",
      title: "Satoshi Trace · Offline Bitcoin Forensics",
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        webviewTag: false,
        devTools: !app.isPackaged,
        spellcheck: false,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event) => event.preventDefault());
    win.webContents.on("will-attach-webview", (event) =>
      event.preventDefault(),
    );
    await win.loadFile(indexPath);
  })
  .catch((error) => {
    dialog.showErrorBox("Satoshi Trace could not start", error.message);
    app.quit();
  });
app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  Atomics.store(new Int32Array(cancellation), 0, 1);
  (async () => {
    if (worker) {
      await request(
        "audit",
        { action: "app.exited", details: {} },
        authSession || {},
      ).catch(() => {});
      await request("close", {}, authSession || {}).catch(() => {});
      await worker.terminate().catch(() => {});
    }
  })().finally(() => app.quit());
});
