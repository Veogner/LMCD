const fs = require("fs");
const path = require("path");
const electron = require("electron");

const APP_NAME = "LMCD";
const APP_RELEASE_TAG = "4m26s4ea";
const APP_STORAGE_DIR = "LMCD";
const LEGACY_APP_STORAGE_DIR = "TFSU-MiCr";
const DEFAULT_MC_VERSION = "1.21.11";
const DEFAULT_MODE_PRESET = "hardcore";
const DEFAULT_MOTD = "LMCD Hardcore";
const DEFAULT_SERVER_SOFTWARE = "paper";
const DEFAULT_MIN_RAM_MB = 2048;
const DEFAULT_MAX_RAM_MB = 4096;
const DEFAULT_SERVER_PORT = 25565;
const DEFAULT_IDLE_SHUTDOWN_MINUTES = 0;
const DEFAULT_PROFILE_TYPE = "local";
const DEFAULT_REMOTE_RCON_PORT = 25575;
const DEFAULT_REMOTE_WAKE_TIMEOUT_SEC = 45;
const DEFAULT_REMOTE_CONNECT_TIMEOUT_SEC = 15;
const VALID_MODE_PRESETS = new Set(["hardcore", "survival_locked", "adventure_locked"]);
const VALID_SERVER_SOFTWARE = new Set(["vanilla", "paper", "fabric"]);
const VALID_PROFILE_TYPES = new Set(["local", "remote"]);

function getDocumentsDir() {
  const app = typeof electron === "string" ? null : electron.app;
  return app && typeof app.getPath === "function"
    ? app.getPath("documents")
    : path.join(process.env.USERPROFILE || process.cwd(), "Documents");
}

function getAppRootDir() {
  const configuredRoot = String(process.env.LMCD_DATA_ROOT || "").trim();
  if (configuredRoot) {
    return path.resolve(configuredRoot);
  }

  const docs = getDocumentsDir();
  const nextRoot = path.join(docs, APP_STORAGE_DIR);
  const legacyRoot = path.join(docs, LEGACY_APP_STORAGE_DIR);

  if (!fs.existsSync(nextRoot) && fs.existsSync(legacyRoot)) {
    try {
      fs.renameSync(legacyRoot, nextRoot);
    } catch {
      return legacyRoot;
    }
  }

  return nextRoot;
}

function getProfilesFile() {
  return path.join(getAppRootDir(), "profiles.json");
}

function normalizeModePreset(value) {
  return VALID_MODE_PRESETS.has(value) ? value : DEFAULT_MODE_PRESET;
}

function normalizeServerSoftware(value) {
  return VALID_SERVER_SOFTWARE.has(value) ? value : DEFAULT_SERVER_SOFTWARE;
}

function normalizeInteger(value, fallback, min, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function normalizeProfileType(value) {
  return VALID_PROFILE_TYPES.has(value) ? value : DEFAULT_PROFILE_TYPE;
}

function normalizeProfile(profile = {}, index = 0) {
  const safeName =
    typeof profile.name === "string" && profile.name.trim()
      ? profile.name.trim()
      : `Server ${index + 1}`;
  const profileType = normalizeProfileType(profile.profileType);
  const minMem = normalizeInteger(profile.minMem, DEFAULT_MIN_RAM_MB, 1024);
  const maxMem = normalizeInteger(profile.maxMem, DEFAULT_MAX_RAM_MB, minMem);
  const port = normalizeInteger(profile.port, DEFAULT_SERVER_PORT, 1024, 65535);
  const idleShutdownMinutes = normalizeInteger(
    profile.idleShutdownMinutes,
    DEFAULT_IDLE_SHUTDOWN_MINUTES,
    0,
    1440,
  );
  const rconPort = normalizeInteger(profile.rconPort, DEFAULT_REMOTE_RCON_PORT, 1, 65535);
  const wakeTimeoutSec = normalizeInteger(
    profile.wakeTimeoutSec,
    DEFAULT_REMOTE_WAKE_TIMEOUT_SEC,
    5,
    300,
  );
  const connectTimeoutSec = normalizeInteger(
    profile.connectTimeoutSec,
    DEFAULT_REMOTE_CONNECT_TIMEOUT_SEC,
    3,
    120,
  );
  const host = String(profile.host || "").trim();
  const publicHost = String(profile.publicHost || "").trim();
  const wakeCommand = String(profile.wakeCommand || "").trim();
  const rconPasswordRef = String(profile.rconPasswordRef || "").trim();

  return {
    id:
      typeof profile.id === "string" && profile.id.trim()
        ? profile.id.trim()
        : `server-${index + 1}`,
    name: safeName,
    profileType,
    version:
      typeof profile.version === "string" && profile.version.trim()
        ? profile.version.trim()
        : DEFAULT_MC_VERSION,
    motd:
      typeof profile.motd === "string" && profile.motd.trim()
        ? profile.motd.trim()
        : DEFAULT_MOTD,
    serverSoftware: normalizeServerSoftware(profile.serverSoftware),
    modePreset: normalizeModePreset(profile.modePreset),
    cheatLock: profile.cheatLock !== false,
    rulesLocked: Boolean(profile.rulesLocked),
    minMem,
    maxMem,
    port,
    idleShutdownMinutes,
    host,
    publicHost,
    rconPort,
    rconPasswordRef,
    wakeCommand,
    wakeTimeoutSec,
    connectTimeoutSec,
  };
}

function normalizeProfiles(list) {
  if (!Array.isArray(list)) return [];
  return list.map((profile, index) => normalizeProfile(profile, index));
}

function mergeWithExistingProfiles(list) {
  const existingById = new Map(readProfiles().map((profile) => [profile.id, profile]));
  return normalizeProfiles(list).map((profile) => {
    const existing = existingById.get(profile.id);
    if (existing && existing.cheatLock) {
      return {
        ...profile,
        cheatLock: true,
      };
    }
    return profile;
  });
}

function readProfiles() {
  try {
    const profilesFile = getProfilesFile();
    if (!fs.existsSync(profilesFile)) return [];
    const raw = fs.readFileSync(profilesFile, "utf-8");
    return normalizeProfiles(JSON.parse(raw));
  } catch {
    return [];
  }
}

function writeProfiles(list) {
  const profilesFile = getProfilesFile();
  const dir = path.dirname(profilesFile);
  const normalized = mergeWithExistingProfiles(list);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(profilesFile, JSON.stringify(normalized, null, 2));
  return normalized;
}

module.exports = {
  APP_NAME,
  APP_RELEASE_TAG,
  APP_STORAGE_DIR,
  DEFAULT_MC_VERSION,
  DEFAULT_MODE_PRESET,
  DEFAULT_MOTD,
  DEFAULT_SERVER_SOFTWARE,
  DEFAULT_MIN_RAM_MB,
  DEFAULT_MAX_RAM_MB,
  DEFAULT_SERVER_PORT,
  DEFAULT_IDLE_SHUTDOWN_MINUTES,
  DEFAULT_PROFILE_TYPE,
  DEFAULT_REMOTE_RCON_PORT,
  DEFAULT_REMOTE_WAKE_TIMEOUT_SEC,
  DEFAULT_REMOTE_CONNECT_TIMEOUT_SEC,
  getAppRootDir,
  normalizeProfile,
  normalizeProfiles,
  readProfiles,
  writeProfiles,
};
