if (process.env.ELECTRON_RUN_AS_NODE === "1") {
  const { spawn } = require("child_process");
  const path = require("path");
  const respawnEnv = { ...process.env };
  delete respawnEnv.ELECTRON_RUN_AS_NODE;
  const tempRoot = path.resolve(process.env.TEMP || process.env.TMP || process.cwd());
  const execDir = path.dirname(process.execPath);
  const execInTemp = execDir.toLowerCase().startsWith(tempRoot.toLowerCase());
  const keepLauncherAlive =
    Boolean(process.env.PORTABLE_EXECUTABLE_DIR) ||
    Boolean(process.env.PORTABLE_EXECUTABLE_FILE) ||
    execInTemp;
  const incomingArgs = process.argv.slice(1);
  const firstArg = incomingArgs[0] ? path.resolve(incomingArgs[0]) : "";
  const currentMain = path.resolve(__filename);
  const respawnArgs = firstArg === currentMain ? incomingArgs.slice(1) : incomingArgs;

  // Some shells leak ELECTRON_RUN_AS_NODE into app launches. Re-spawn cleanly.
  const child = spawn(process.execPath, respawnArgs, {
    detached: !keepLauncherAlive,
    stdio: "ignore",
    env: respawnEnv,
    windowsHide: true,
  });
  if (keepLauncherAlive) {
    child.once("error", () => process.exit(1));
    child.once("exit", (code) => process.exit(code ?? 0));
  } else {
    child.unref();
    process.exit(0);
  }
}

const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const fs = require("fs");
const originalFs = require("original-fs");
const path = require("path");
const crypto = require("crypto");
const ServerManager = require("./serverManager.cjs");
const { APP_STORAGE_DIR, readProfiles, writeProfiles } = require("./profiles.cjs");

const isDev = !!process.env.VITE_DEV_SERVER_URL;
let mainWindow;
let manager;
const APP_NAME = "LMCD";
const APP_RELEASE_TAG = "4m26s4ea";
const APP_ID = "com.lmcd.prototype";
const INSTALL_STATE_FILE = "install-state.json";
const INTEGRITY_CHECK_DEFER_MS = 1800;
let integrityCheckScheduled = false;

app.setName(APP_NAME);
app.setAppUserModelId(APP_ID);
process.title = `${APP_NAME} ${APP_RELEASE_TAG}`;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

app.on("second-instance", () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
});

function getInstallStatePath() {
  return path.join(app.getPath("userData"), INSTALL_STATE_FILE);
}

function readInstallState() {
  try {
    const statePath = getInstallStatePath();
    if (!fs.existsSync(statePath)) {
      return {};
    }
    return JSON.parse(fs.readFileSync(statePath, "utf8")) || {};
  } catch {
    return {};
  }
}

function writeInstallState(nextState) {
  const statePath = getInstallStatePath();
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(nextState, null, 2));
  return nextState;
}

async function ensureDataRootConfigured() {
  const existing = readInstallState();
  const savedDataRoot = String(existing.dataRoot || "").trim();
  if (savedDataRoot) {
    process.env.LMCD_DATA_ROOT = path.resolve(savedDataRoot);
    fs.mkdirSync(process.env.LMCD_DATA_ROOT, { recursive: true });
    return process.env.LMCD_DATA_ROOT;
  }

  const defaultDataRoot = path.join(app.getPath("documents"), APP_STORAGE_DIR || APP_NAME);
  const setupChoice = await dialog.showMessageBox({
    type: "question",
    title: `${APP_NAME} Setup`,
    message: "Choose where LMCD stores servers, mods, jars, and backups.",
    detail: `Default location:\n${defaultDataRoot}\n\nThis is asked only once for this install.`,
    buttons: ["Use default", "Choose folder"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });

  let selectedDataRoot = defaultDataRoot;
  if (setupChoice.response === 1) {
    const folderChoice = await dialog.showOpenDialog({
      title: "Choose LMCD data folder",
      properties: ["openDirectory", "createDirectory"],
    });
    if (!folderChoice.canceled && folderChoice.filePaths && folderChoice.filePaths[0]) {
      selectedDataRoot = folderChoice.filePaths[0];
    }
  }

  selectedDataRoot = path.resolve(selectedDataRoot);
  fs.mkdirSync(selectedDataRoot, { recursive: true });
  process.env.LMCD_DATA_ROOT = selectedDataRoot;
  writeInstallState({
    ...existing,
    dataRoot: selectedDataRoot,
    configuredAt: Date.now(),
    releaseTag: APP_RELEASE_TAG,
  });

  return selectedDataRoot;
}

function getWindowIcon() {
  const candidates = [
    path.join(process.resourcesPath || "", "build", "icon.ico"),
    path.join(process.resourcesPath || "", "icon.ico"),
    path.join(__dirname, "../build/icon.ico"),
    path.join(process.cwd(), "build", "icon.ico"),
    path.join(process.cwd(), "public", "icon.png"),
    path.join(__dirname, "../dist/icon.png"),
    path.join(__dirname, "../public/icon.png"),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate));
}

function hashFile(filePath) {
  const hash = crypto.createHash("sha256");
  const readFile = originalFs && typeof originalFs.readFileSync === "function"
    ? originalFs.readFileSync.bind(originalFs)
    : fs.readFileSync.bind(fs);
  hash.update(readFile(filePath));
  return hash.digest("hex");
}

function getCriticalArtifactPaths() {
  const candidates = isDev
    ? [
        path.join(__dirname, "main.cjs"),
        path.join(__dirname, "preload.cjs"),
        path.join(process.cwd(), "package.json"),
      ]
    : [
        process.execPath,
        path.join(process.resourcesPath || "", "app.asar"),
        path.join(process.resourcesPath || "", "build", "icon.ico"),
      ];

  return candidates.filter((candidate) => candidate && fs.existsSync(candidate));
}

function computeIntegrityFingerprint() {
  const artifacts = getCriticalArtifactPaths();
  if (artifacts.length === 0) {
    return { digest: "", artifacts: [] };
  }

  const combined = crypto.createHash("sha256");
  for (const artifact of artifacts) {
    combined.update(path.basename(artifact));
    combined.update(":");
    combined.update(hashFile(artifact));
    combined.update(";");
  }
  return {
    digest: combined.digest("hex"),
    artifacts,
  };
}

function computeIntegrityQuickSignature() {
  const artifacts = getCriticalArtifactPaths();
  if (artifacts.length === 0) {
    return "";
  }
  const combined = crypto.createHash("sha256");
  for (const artifact of artifacts) {
    const stats = fs.statSync(artifact);
    combined.update(path.basename(artifact));
    combined.update(":");
    combined.update(String(stats.size));
    combined.update(":");
    combined.update(String(Math.round(stats.mtimeMs)));
    combined.update(";");
  }
  return combined.digest("hex");
}

async function runStartupIntegrityCheck() {
  const existing = readInstallState();
  const integrityState =
    existing && typeof existing.integrity === "object" && existing.integrity ? existing.integrity : {};
  const integrityQuickState =
    existing && typeof existing.integrityQuick === "object" && existing.integrityQuick
      ? existing.integrityQuick
      : {};
  const releaseKey = APP_RELEASE_TAG;
  const previousDigest = String(integrityState[releaseKey] || "").trim();
  const previousQuick = String(integrityQuickState[releaseKey] || "").trim();
  const quickSignature = computeIntegrityQuickSignature();

  if (quickSignature && previousQuick && quickSignature === previousQuick) {
    writeInstallState({
      ...existing,
      integrityQuick: {
        ...integrityQuickState,
        [releaseKey]: quickSignature,
      },
      integrityCheckedAt: Date.now(),
    });
    return;
  }

  const fingerprint = computeIntegrityFingerprint();

  if (!fingerprint.digest) {
    return;
  }

  const nextState = {
    ...existing,
    integrity: {
      ...integrityState,
      [releaseKey]: fingerprint.digest,
    },
    integrityQuick: {
      ...integrityQuickState,
      [releaseKey]: quickSignature,
    },
    integrityCheckedAt: Date.now(),
  };
  writeInstallState(nextState);

  if (previousDigest && previousDigest !== fingerprint.digest) {
    console.warn("[integrity-check] app files changed since the previous run for this release.");
  }
}

function scheduleStartupIntegrityCheck() {
  if (integrityCheckScheduled) {
    return;
  }
  integrityCheckScheduled = true;
  setTimeout(() => {
    runStartupIntegrityCheck().catch((integrityError) => {
      console.error("[integrity-check]", integrityError);
    });
  }, INTEGRITY_CHECK_DEFER_MS);
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
    show: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.setTitle(APP_NAME);
    scheduleStartupIntegrityCheck();
  });

  // If renderer never reaches ready-to-show, still reveal the window for diagnostics.
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  }, 2500);

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.webContents.on("did-fail-load", (_event, code, description, validatedURL) => {
    dialog.showErrorBox(
      "Renderer load failed",
      `Code: ${code}\n${description}\nURL: ${validatedURL || "unknown"}`,
    );
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    dialog.showErrorBox(
      "Renderer crashed",
      `Reason: ${details.reason}\nExit code: ${details.exitCode}`,
    );
  });
}

function getManager() {
  if (!manager) {
    throw new Error("Server manager is not ready yet.");
  }
  return manager;
}

function bindManagerEvents(activeManager) {
  activeManager.on("log", (line) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("server:log", line);
    }
  });

  activeManager.on("log-batch", (lines) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("server:logBatch", lines);
    }
  });

  activeManager.on("status", (payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("server:status", payload);
    }
  });

  activeManager.on("download-progress", (payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("server:download", payload);
    }
  });
}

app.whenReady().then(async () => {
  try {
    await ensureDataRootConfigured();
    manager = new ServerManager();
    bindManagerEvents(manager);
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  } catch (startupError) {
    const message =
      startupError && startupError.message
        ? startupError.message
        : String(startupError || "Unknown startup error.");
    dialog.showErrorBox("LMCD startup failed", message);
    app.exit(1);
  }
});

app.on("window-all-closed", async () => {
  if (manager) {
    await manager.stop();
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("server:start", async (_event, options) => {
  try {
    return await getManager().start(options);
  } catch (err) {
    dialog.showErrorBox("Server start failed", err.message);
    throw err;
  }
});

ipcMain.handle("server:stop", async () => {
  return getManager().stop();
});

ipcMain.handle("server:command", async (_event, command) => {
  return getManager().sendCommand(command);
});

ipcMain.handle("server:ensureJar", async (_event, version, software) =>
  getManager().ensureJar(version, software),
);
ipcMain.handle("server:listVersions", async (_event, software) => getManager().listAvailableVersions(software));
ipcMain.handle("server:readProps", async () => getManager().readProperties());
ipcMain.handle("server:writeProps", async (_event, updates) => getManager().writeProperties(updates));
ipcMain.handle("properties:listSchema", async () => getManager().listPropertySchema());
ipcMain.handle("system:stats", async () => getManager().getStats());
ipcMain.handle("system:openFolder", async () => {
  return shell.openPath(getManager().baseDir);
});
ipcMain.handle("maintenance:storageReport", async (_event, profileId) =>
  getManager().getStorageReport(profileId),
);
ipcMain.handle("maintenance:cleanup", async (_event, profileId, options) =>
  getManager().cleanupStorage(profileId, options),
);
ipcMain.handle("addons:list", async () => getManager().listAddons());
ipcMain.handle("addons:pick", async () => {
  const current = getManager().listAddons();
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

  return getManager().importAddons(result.filePaths);
});
ipcMain.handle("addons:remove", async (_event, fileName) => getManager().removeAddon(fileName));
ipcMain.handle("addons:checkUpdates", async () => getManager().checkAddonUpdates());
ipcMain.handle("addons:openFolder", async () => {
  const addonDir = getManager().getAddonDir();
  if (!addonDir) {
    return "";
  }
  return shell.openPath(addonDir);
});
ipcMain.handle("catalog:search", async (_event, query, runtime, options) =>
  getManager().searchAddonCatalog(query, runtime, options),
);
ipcMain.handle("catalog:project", async (_event, projectId) => getManager().getCatalogProject(projectId));
ipcMain.handle("catalog:install", async (_event, projectId) =>
  getManager().installCatalogAddon(projectId),
);
ipcMain.handle("backup:list", async () => {
  const manager = getManager();
  try {
    manager.pruneBackups(manager.profileName, manager.getBackupPolicy().maxBackups, null);
  } catch (error) {
    console.error("Backup prune failed before list:", error);
  }
  return manager.listBackups();
});
ipcMain.handle("backup:create", async (_event, reason) => getManager().createBackup(reason));
ipcMain.handle("backup:restore", async (_event, backupId) => getManager().restoreBackup(backupId));

ipcMain.handle("profile:set", async (_event, profile) => {
  getManager().setProfile(profile);
  return getManager().getActiveProfile();
});

ipcMain.handle("remote:setPassword", async (_event, profileId, password) =>
  getManager().setRemoteCredentials(profileId, password),
);
ipcMain.handle("remote:clearPassword", async (_event, profileId) =>
  getManager().clearRemoteCredentials(profileId),
);
ipcMain.handle("remote:testConnection", async (_event, profileId) =>
  getManager().remoteTestConnection(profileId),
);
ipcMain.handle("remote:start", async (_event, profileId) => getManager().remoteStart(profileId));
ipcMain.handle("remote:stop", async (_event, profileId) => getManager().remoteStop(profileId));
ipcMain.handle("remote:command", async (_event, profileId, command) =>
  getManager().remoteCommand(command, profileId),
);
ipcMain.handle("network:diagnostics", async (_event, profileId) =>
  getManager().networkDiagnostics(profileId),
);
ipcMain.handle("network:upnpMap", async (_event, profileId) => getManager().upnpMap(profileId));
ipcMain.handle("network:upnpUnmap", async (_event, profileId) => getManager().upnpUnmap(profileId));

ipcMain.handle("profiles:list", async () => {
  return readProfiles();
});

ipcMain.handle("profiles:save", async (_event, list) => {
  return writeProfiles(list);
});

ipcMain.handle("profiles:delete", async (_event, profileId) => {
  await getManager().deleteProfile(profileId);
  const nextList = readProfiles().filter((profile) => profile.id !== profileId);
  return writeProfiles(nextList);
});
