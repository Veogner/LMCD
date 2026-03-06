const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bridge", {
  ensureJar: (version, software) => ipcRenderer.invoke("server:ensureJar", version, software),
  listVersions: (software) => ipcRenderer.invoke("server:listVersions", software),
  startServer: (options) => ipcRenderer.invoke("server:start", options),
  stopServer: () => ipcRenderer.invoke("server:stop"),
  sendCommand: (cmd) => ipcRenderer.invoke("server:command", cmd),
  readProps: () => ipcRenderer.invoke("server:readProps"),
  writeProps: (updates) => ipcRenderer.invoke("server:writeProps", updates),
  listPropertySchema: () => ipcRenderer.invoke("properties:listSchema"),
  getStats: () => ipcRenderer.invoke("system:stats"),
  openFolder: () => ipcRenderer.invoke("system:openFolder"),
  getStorageReport: (profileId) => ipcRenderer.invoke("maintenance:storageReport", profileId),
  cleanupStorage: (profileId, options) =>
    ipcRenderer.invoke("maintenance:cleanup", profileId, options),
  listAddons: () => ipcRenderer.invoke("addons:list"),
  pickAddons: () => ipcRenderer.invoke("addons:pick"),
  removeAddon: (fileName) => ipcRenderer.invoke("addons:remove", fileName),
  checkAddonUpdates: () => ipcRenderer.invoke("addons:checkUpdates"),
  openAddonFolder: () => ipcRenderer.invoke("addons:openFolder"),
  searchCatalog: (query, runtime, options) => ipcRenderer.invoke("catalog:search", query, runtime, options),
  getCatalogProject: (projectId) => ipcRenderer.invoke("catalog:project", projectId),
  installCatalogAddon: (projectId) => ipcRenderer.invoke("catalog:install", projectId),
  listBackups: () => ipcRenderer.invoke("backup:list"),
  createBackup: (reason) => ipcRenderer.invoke("backup:create", reason),
  restoreBackup: (backupId) => ipcRenderer.invoke("backup:restore", backupId),
  remoteSetPassword: (profileId, password) => ipcRenderer.invoke("remote:setPassword", profileId, password),
  remoteClearPassword: (profileId) => ipcRenderer.invoke("remote:clearPassword", profileId),
  remoteTestConnection: (profileId) => ipcRenderer.invoke("remote:testConnection", profileId),
  remoteStart: (profileId) => ipcRenderer.invoke("remote:start", profileId),
  remoteStop: (profileId) => ipcRenderer.invoke("remote:stop", profileId),
  remoteCommand: (profileId, command) => ipcRenderer.invoke("remote:command", profileId, command),
  networkDiagnostics: (profileId) => ipcRenderer.invoke("network:diagnostics", profileId),
  networkUpnpMap: (profileId) => ipcRenderer.invoke("network:upnpMap", profileId),
  networkUpnpUnmap: (profileId) => ipcRenderer.invoke("network:upnpUnmap", profileId),
  onLog: (callback) => {
    const listener = (_event, line) => callback(line);
    ipcRenderer.on("server:log", listener);
    return () => ipcRenderer.removeListener("server:log", listener);
  },
  onLogBatch: (callback) => {
    const listener = (_event, lines) => callback(lines);
    ipcRenderer.on("server:logBatch", listener);
    return () => ipcRenderer.removeListener("server:logBatch", listener);
  },
  onStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("server:status", listener);
    return () => ipcRenderer.removeListener("server:status", listener);
  },
  onDownload: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("server:download", listener);
    return () => ipcRenderer.removeListener("server:download", listener);
  },
  setProfile: (profile) => ipcRenderer.invoke("profile:set", profile),
  listProfiles: () => ipcRenderer.invoke("profiles:list"),
  saveProfiles: (list) => ipcRenderer.invoke("profiles:save", list),
  deleteProfile: (profileId) => ipcRenderer.invoke("profiles:delete", profileId),
});
