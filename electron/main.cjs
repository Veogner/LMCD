const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const fs = require("fs");
const path = require("path");
const ServerManager = require("./serverManager.cjs");
const { readProfiles, writeProfiles } = require("./profiles.cjs");

const isDev = !!process.env.VITE_DEV_SERVER_URL;
let mainWindow;
const manager = new ServerManager();
const APP_NAME = "LMCD";
const APP_RELEASE_TAG = "1m26c1ea";
const APP_ID = "com.lmcd.app";

app.setName(APP_NAME);
app.setAppUserModelId(APP_ID);
process.title = `${APP_NAME} ${APP_RELEASE_TAG}`;

function getWindowIcon() {
  const candidates = [
    path.join(process.cwd(), "build", "icon.ico"),
    path.join(process.cwd(), "public", "icon.png"),
    path.join(__dirname, "../dist/icon.png"),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 820,
    minHeight: 620,
    title: APP_NAME,
    backgroundColor: "#0b0f1a",
    icon: getWindowIcon(),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.setTitle(APP_NAME);
  });

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", async () => {
  await manager.stop();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

manager.on("log", (line) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("server:log", line);
  }
});

manager.on("status", (payload) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("server:status", payload);
  }
});

manager.on("download-progress", (payload) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("server:download", payload);
  }
});

ipcMain.handle("server:start", async (_event, options) => {
  try {
    return await manager.start(options);
  } catch (err) {
    dialog.showErrorBox("Server start failed", err.message);
    throw err;
  }
});

ipcMain.handle("server:stop", async () => {
  return manager.stop();
});

ipcMain.handle("server:command", async (_event, command) => {
  return manager.sendCommand(command);
});

ipcMain.handle("server:ensureJar", async (_event, version, software) =>
  manager.ensureJar(version, software),
);
ipcMain.handle("server:listVersions", async (_event, software) => manager.listAvailableVersions(software));
ipcMain.handle("server:readProps", async () => manager.readProperties());
ipcMain.handle("server:writeProps", async (_event, updates) => manager.writeProperties(updates));
ipcMain.handle("system:stats", async () => manager.getStats());
ipcMain.handle("system:openFolder", async () => {
  return shell.openPath(manager.baseDir);
});
ipcMain.handle("addons:list", async () => manager.listAddons());
ipcMain.handle("addons:pick", async () => {
  const current = manager.listAddons();
  if (!current.supported) {
    return current;
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    title: `Add ${current.kind === "mods" ? "mods" : "plugins"}`,
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Jar files", extensions: ["jar"] }],
  });

  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return current;
  }

  return manager.importAddons(result.filePaths);
});
ipcMain.handle("addons:remove", async (_event, fileName) => manager.removeAddon(fileName));
ipcMain.handle("addons:openFolder", async () => {
  const addonDir = manager.getAddonDir();
  if (!addonDir) {
    return "";
  }
  return shell.openPath(addonDir);
});
ipcMain.handle("catalog:search", async (_event, query) => manager.searchAddonCatalog(query));
ipcMain.handle("catalog:install", async (_event, projectId) =>
  manager.installCatalogAddon(projectId),
);
ipcMain.handle("backup:list", async () => manager.listBackups());
ipcMain.handle("backup:create", async (_event, reason) => manager.createBackup(reason));
ipcMain.handle("backup:restore", async (_event, backupId) => manager.restoreBackup(backupId));

ipcMain.handle("profile:set", async (_event, profile) => {
  manager.setProfile(profile);
});

ipcMain.handle("profiles:list", async () => {
  return readProfiles();
});

ipcMain.handle("profiles:save", async (_event, list) => {
  return writeProfiles(list);
});

ipcMain.handle("profiles:delete", async (_event, profileId) => {
  manager.deleteProfile(profileId);
  const nextList = readProfiles().filter((profile) => profile.id !== profileId);
  return writeProfiles(nextList);
});
