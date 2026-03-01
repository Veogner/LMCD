const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bridge", {
  ensureJar: (version, software) => ipcRenderer.invoke("server:ensureJar", version, software),
  listVersions: (software) => ipcRenderer.invoke("server:listVersions", software),
  startServer: (options) => ipcRenderer.invoke("server:start", options),
  stopServer: () => ipcRenderer.invoke("server:stop"),
  sendCommand: (cmd) => ipcRenderer.invoke("server:command", cmd),
  readProps: () => ipcRenderer.invoke("server:readProps"),
  writeProps: (updates) => ipcRenderer.invoke("server:writeProps", updates),
  getStats: () => ipcRenderer.invoke("system:stats"),
  openFolder: () => ipcRenderer.invoke("system:openFolder"),
  listAddons: () => ipcRenderer.invoke("addons:list"),
  pickAddons: () => ipcRenderer.invoke("addons:pick"),
  removeAddon: (fileName) => ipcRenderer.invoke("addons:remove", fileName),
  openAddonFolder: () => ipcRenderer.invoke("addons:openFolder"),
  searchCatalog: (query) => ipcRenderer.invoke("catalog:search", query),
  installCatalogAddon: (projectId) => ipcRenderer.invoke("catalog:install", projectId),
  listBackups: () => ipcRenderer.invoke("backup:list"),
  createBackup: (reason) => ipcRenderer.invoke("backup:create", reason),
  restoreBackup: (backupId) => ipcRenderer.invoke("backup:restore", backupId),
  onLog: (callback) => {
    const listener = (_event, line) => callback(line);
    ipcRenderer.on("server:log", listener);
    return () => ipcRenderer.removeListener("server:log", listener);
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
