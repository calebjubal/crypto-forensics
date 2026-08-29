"use strict";
const { contextBridge, ipcRenderer } = require("electron");
const invoke = (channel) => (payload) => ipcRenderer.invoke(channel, payload);
contextBridge.exposeInMainWorld("forensics", {
  authStatus: invoke("auth-status"),
  setupAccount: invoke("auth-setup"),
  login: invoke("auth-login"),
  logout: invoke("auth-logout"),
  summary: invoke("summary"),
  page: invoke("page"),
  detail: invoke("detail"),
  cluster: invoke("cluster"),
  review: invoke("review"),
  errors: invoke("errors"),
  model: invoke("model"),
  analyze: invoke("analyze"),
  cancel: invoke("cancel"),
  importFiles: invoke("import"),
  deleteImport: invoke("delete-import"),
  exportReport: invoke("export"),
  environment: invoke("environment"),
  auditEvent: invoke("audit-event"),
  onProgress: (callback) => {
    const listener = (_, value) => callback(value);
    ipcRenderer.on("job-progress", listener);
    return () => ipcRenderer.removeListener("job-progress", listener);
  },
  onFatal: (callback) =>
    ipcRenderer.on("fatal-error", (_, message) => callback(message)),
});
