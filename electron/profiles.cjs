const fs = require("fs");
const path = require("path");
const electron = require("electron");

const APP_NAME = "LMCD";
const APP_RELEASE_TAG = "1m26c1ea";
const APP_STORAGE_DIR = "LMCD";
const LEGACY_APP_STORAGE_DIR = "TFSU-MiCr";
const DEFAULT_MC_VERSION = "1.21.11";
const DEFAULT_MODE_PRESET = "hardcore";
const DEFAULT_MOTD = "LMCD Hardcore";
const DEFAULT_SERVER_SOFTWARE = "vanilla";
const VALID_MODE_PRESETS = new Set(["hardcore", "survival_locked", "adventure_locked"]);
const VALID_SERVER_SOFTWARE = new Set(["vanilla", "paper", "fabric"]);

function getDocumentsDir() {
  const app = typeof electron === "string" ? null : electron.app;
  return app && typeof app.getPath === "function"
    ? app.getPath("documents")
    : path.join(process.env.USERPROFILE || process.cwd(), "Documents");
}

function getAppRootDir() {
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

function normalizeProfile(profile = {}, index = 0) {
  const safeName =
    typeof profile.name === "string" && profile.name.trim()
      ? profile.name.trim()
      : `Server ${index + 1}`;

  return {
    id:
      typeof profile.id === "string" && profile.id.trim()
        ? profile.id.trim()
        : `server-${index + 1}`,
    name: safeName,
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
  getAppRootDir,
  normalizeProfile,
  normalizeProfiles,
  readProfiles,
  writeProfiles,
};
