const fs = require("fs");
const path = require("path");
const https = require("https");
const { spawn, spawnSync } = require("child_process");
const EventEmitter = require("events");
const os = require("os");
const net = require("net");
const pidusage = require("pidusage");
const AdmZip = require("adm-zip");
const yaml = require("js-yaml");
const natUpnp = require("nat-upnp");
const { Rcon } = require("rcon-client");
const {
  APP_NAME,
  APP_RELEASE_TAG,
  DEFAULT_MC_VERSION,
  DEFAULT_MODE_PRESET,
  DEFAULT_MOTD,
  DEFAULT_SERVER_SOFTWARE,
  getAppRootDir,
  normalizeProfile,
  readProfiles,
  writeProfiles,
} = require("./profiles.cjs");
const { setSecret, getSecret, deleteSecret } = require("./credentials.cjs");

const SAFE_CONSOLE_COMMANDS = new Set([
  "ban",
  "ban-ip",
  "help",
  "kick",
  "list",
  "pardon",
  "pardon-ip",
  "save-all",
  "save-off",
  "save-on",
  "say",
  "stop",
  "whitelist",
]);

const PRESET_POLICIES = {
  hardcore: {
    label: "Hardcore Ironman",
    properties: {
      difficulty: "hard",
      hardcore: "true",
      gamemode: "survival",
      "force-gamemode": "true",
    },
  },
  survival_locked: {
    label: "Survival Locked",
    properties: {
      difficulty: "normal",
      hardcore: "false",
      gamemode: "survival",
      "force-gamemode": "true",
    },
  },
  adventure_locked: {
    label: "Adventure Locked",
    properties: {
      difficulty: "normal",
      hardcore: "false",
      gamemode: "adventure",
      "force-gamemode": "true",
    },
  },
};

const BASE_PROPERTIES = {
  pvp: "true",
  motd: DEFAULT_MOTD,
  "server-port": "25565",
  "max-players": "8",
  "view-distance": "20",
  "simulation-distance": "10",
  "white-list": "false",
  "enforce-whitelist": "false",
  "enable-command-block": "false",
  "allow-flight": "false",
  "online-mode": "true",
  "spawn-protection": "0",
};

const RELEASE_VERSION_PATTERN = /^\d+\.\d+(\.\d+)?$/;
const HTTP_REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const HTTP_HEADERS = {
  "User-Agent": `${APP_NAME}/${APP_RELEASE_TAG}`,
  Accept: "application/json, text/plain, */*",
};

const ADDON_CONTEXT = {
  vanilla: {
    supported: false,
    kind: "none",
    label: "Runtime add-ons unavailable",
    helperText: "Vanilla does not load mods or plugins. Use Fabric for mods or Paper for plugins.",
    folderName: null,
  },
  paper: {
    supported: true,
    kind: "plugins",
    label: "Paper plugins",
    helperText: "Add Paper, Bukkit, or Spigot plugin jars for this server.",
    folderName: "plugins",
  },
  fabric: {
    supported: true,
    kind: "mods",
    label: "Fabric mods",
    helperText: "Add Fabric mod jars for this server. Server-side only right now.",
    folderName: "mods",
  },
};

const BUILTIN_FABRIC_DEPENDENCIES = new Set(["fabricloader", "java", "minecraft"]);
const PAPER_LOADERS = ["paper", "purpur", "folia", "spigot", "bukkit"];
const MODRINTH_API_BASE = "https://api.modrinth.com/v2";
const PROFILE_STATE_FILE = ".lmcd-state.json";
const ADDON_MANIFEST_FILE = ".lmcd-addons.json";
const BACKUP_SKIP_NAMES = new Set([
  "cache",
  "libraries",
  "logs",
  "versions",
  PROFILE_STATE_FILE,
  ADDON_MANIFEST_FILE,
]);
const AUTO_BACKUP_INTERVAL_MS = 5 * 60 * 1000;
const IDLE_CHECK_INTERVAL_MS = 60 * 1000;
const LOG_BATCH_FLUSH_MS = 25;
const LOG_BATCH_MAX_LINES = 50;
const JAR_CLEANUP_MAX_AGE_DAYS = 30;
const BACKUP_CLEANUP_MAX_AGE_DAYS = 30;
const LOG_CLEANUP_MAX_AGE_DAYS = 14;
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;
const PLAYER_COUNT_LOG_PATTERN = /There are (\d+) of a max of \d+ players online/i;
const LOCALHOST_CANDIDATES = new Set(["", "0.0.0.0", "127.0.0.1", "localhost", "::"]);
const REMOTE_CONNECT_RETRY_MS = 1500;
const CATALOG_SORT_INDEX = new Set(["relevance", "downloads", "follows", "updated"]);
const HARDCORE_DEATH_MARKERS = [
  " was slain by ",
  " was shot by ",
  " was fireballed by ",
  " was blown up by ",
  " was killed by ",
  " was struck by lightning",
  " fell from ",
  " fell off ",
  " hit the ground too hard",
  " fell out of the world",
  " tried to swim in lava",
  " discovered the floor was lava",
  " walked into fire",
  " went up in flames",
  " burned to death",
  " drowned",
  " suffocated in a wall",
  " starved to death",
  " withered away",
  " froze to death",
  " was squashed by ",
  " was pricked to death",
  " was impaled by ",
  " was impaled on ",
  " was pummeled by ",
  " was roasted in dragon breath",
  " experienced kinetic energy",
  " was doomed to fall",
  " was skewered by a falling stalactite",
  " was poked to death by a sweet berry bush",
  " was stung to death",
  " was obliterated by a sonically-charged shriek",
  " blew up",
  " died",
];
const HARDCORE_LOG_IGNORE_PREFIXES = ["<", "[Not Secure] <", "[@]", "[Rcon]", "[Server]"];

const SERVER_PROPERTY_SCHEMA = [
  {
    category: "Network",
    key: "server-ip",
    label: "Bind IP",
    type: "text",
    defaultValue: "",
    helper: "Leave blank or 0.0.0.0 for all interfaces. Set a specific LAN IP only when required.",
  },
  {
    category: "Network",
    key: "server-port",
    label: "Port",
    type: "number",
    defaultValue: "25565",
    min: 1,
    max: 65535,
    helper: "Public join port. Requires router port forward for internet access.",
  },
  {
    category: "Security",
    key: "online-mode",
    label: "Online Mode",
    type: "boolean",
    defaultValue: "true",
    helper: "Keep enabled to verify player accounts with Mojang services.",
  },
  {
    category: "Security",
    key: "white-list",
    label: "Whitelist",
    type: "boolean",
    defaultValue: "false",
    helper: "Only allow listed players.",
  },
  {
    category: "Security",
    key: "enforce-whitelist",
    label: "Enforce Whitelist",
    type: "boolean",
    defaultValue: "false",
    helper: "Kick non-whitelisted players immediately when enabled.",
  },
  {
    category: "Security",
    key: "enable-command-block",
    label: "Command Blocks",
    type: "boolean",
    defaultValue: "false",
    helper: "Required for command block automation.",
  },
  {
    category: "Gameplay",
    key: "motd",
    label: "MOTD",
    type: "text",
    defaultValue: DEFAULT_MOTD,
    helper: "Shown in the multiplayer server list.",
  },
  {
    category: "Gameplay",
    key: "max-players",
    label: "Max Players",
    type: "number",
    defaultValue: "8",
    min: 1,
    max: 500,
    helper: "Maximum concurrent players allowed.",
  },
  {
    category: "Gameplay",
    key: "gamemode",
    label: "Default Gamemode",
    type: "enum",
    defaultValue: "survival",
    enumValues: ["survival", "creative", "adventure", "spectator"],
    helper: "Default gamemode for new players.",
  },
  {
    category: "Gameplay",
    key: "difficulty",
    label: "Difficulty",
    type: "enum",
    defaultValue: "normal",
    enumValues: ["peaceful", "easy", "normal", "hard"],
    helper: "Base difficulty level.",
  },
  {
    category: "Gameplay",
    key: "pvp",
    label: "PVP",
    type: "boolean",
    defaultValue: "true",
    helper: "Allow player-versus-player combat.",
  },
  {
    category: "Performance",
    key: "view-distance",
    label: "View Distance",
    type: "number",
    defaultValue: "20",
    min: 2,
    max: 32,
    helper: "Higher values increase CPU and bandwidth use.",
  },
  {
    category: "Performance",
    key: "simulation-distance",
    label: "Simulation Distance",
    type: "number",
    defaultValue: "10",
    min: 2,
    max: 32,
    helper: "Controls chunk ticking range around players.",
  },
  {
    category: "Performance",
    key: "spawn-protection",
    label: "Spawn Protection",
    type: "number",
    defaultValue: "0",
    min: 0,
    max: 64,
    helper: "Radius around world spawn protected from edits.",
  },
  {
    category: "Advanced",
    key: "allow-flight",
    label: "Allow Flight",
    type: "boolean",
    defaultValue: "false",
    helper: "Required for mods/plugins that use flight mechanics.",
  },
];

function parseProperties(raw) {
  return raw
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"))
    .reduce((acc, line) => {
      const [key, ...rest] = line.split("=");
      acc[key.trim()] = rest.join("=").trim();
      return acc;
    }, {});
}

function stringifyProperties(obj) {
  return Object.entries(obj)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function propertiesDiffer(left, right) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (String(left[key] ?? "") !== String(right[key] ?? "")) {
      return true;
    }
  }
  return false;
}

function compareVersionsDesc(left, right) {
  const leftParts = String(left)
    .split(".")
    .map((part) => Number(part));
  const rightParts = String(right)
    .split(".")
    .map((part) => Number(part));
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] || 0;
    const rightValue = rightParts[index] || 0;
    if (leftValue !== rightValue) {
      return rightValue - leftValue;
    }
  }
  return 0;
}

function compareReleaseVersions(left, right) {
  return -compareVersionsDesc(left, right);
}

function extractReleaseVersion(value) {
  const match = String(value || "").match(/\d+\.\d+(?:\.\d+)?/);
  return match ? match[0] : null;
}

function matchesVersionRequirement(version, requirement) {
  const target = extractReleaseVersion(version);
  if (!target || requirement == null) return true;

  if (Array.isArray(requirement)) {
    return requirement.some((item) => matchesVersionRequirement(target, item));
  }

  const raw = String(requirement).trim();
  if (!raw || raw === "*") {
    return true;
  }

  if (raw.includes("||")) {
    return raw.split("||").some((part) => matchesVersionRequirement(target, part.trim()));
  }

  const directMatch = extractReleaseVersion(raw);
  if (directMatch && !/[<>~^=]/.test(raw)) {
    return directMatch === target || directMatch.startsWith(`${target}.`) || target.startsWith(`${directMatch}.`);
  }

  const tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return true;
  }

  return tokens.every((token) => {
    if (token === "*") return true;
    if (token.startsWith(">=")) {
      const min = extractReleaseVersion(token.slice(2));
      return !min || compareReleaseVersions(target, min) >= 0;
    }
    if (token.startsWith("<=")) {
      const max = extractReleaseVersion(token.slice(2));
      return !max || compareReleaseVersions(target, max) <= 0;
    }
    if (token.startsWith(">")) {
      const min = extractReleaseVersion(token.slice(1));
      return !min || compareReleaseVersions(target, min) > 0;
    }
    if (token.startsWith("<")) {
      const max = extractReleaseVersion(token.slice(1));
      return !max || compareReleaseVersions(target, max) < 0;
    }
    if (token.startsWith("=")) {
      const exact = extractReleaseVersion(token.slice(1));
      return !exact || exact === target;
    }
    if (token.startsWith("^") || token.startsWith("~")) {
      const prefix = extractReleaseVersion(token.slice(1));
      return !prefix || target === prefix || target.startsWith(`${prefix}.`);
    }

    const exact = extractReleaseVersion(token);
    return !exact || exact === target || target.startsWith(`${exact}.`) || exact.startsWith(`${target}.`);
  });
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

class ServerManager extends EventEmitter {
  constructor() {
    super();
    this.baseRoot = getAppRootDir();
    this.jarCache = path.join(this.baseRoot, "jars");
    this.currentProfile = normalizeProfile({
      id: "default",
      name: "Default server",
      version: DEFAULT_MC_VERSION,
      motd: DEFAULT_MOTD,
      serverSoftware: DEFAULT_SERVER_SOFTWARE,
      modePreset: DEFAULT_MODE_PRESET,
      cheatLock: true,
      rulesLocked: false,
    });
    this.profileName = this.currentProfile.id;
    this.currentVersion = this.currentProfile.version;
    this.currentSoftware = this.currentProfile.serverSoftware;
    this.profileDir = path.join(this.baseRoot, "profiles", this.profileName);
    this.baseDir = this.profileDir;
    this.jarPath = this.getJarPath(this.currentVersion, this.currentSoftware);
    this.serverProcess = null;
    this.startedAt = null;
    this.logBuffer = "";
    this.pendingHardcoreReset = null;
    this.autoBackupTimer = null;
    this.autoBackupInProgress = false;
    this.idleCheckTimer = null;
    this.idleShutdownMinutes = 0;
    this.lastKnownOnlinePlayers = 0;
    this.idleSince = null;
    this.idleShutdownPending = false;
    this.remoteRcon = null;
    this.remoteConnected = false;
    this.remotePollTimer = null;
    this.upnpClient = null;
    this.logBatchQueue = [];
    this.logBatchTimer = null;
    this.addonMetadataCache = new Map();
    this.ensureBaseDir();
  }

  emit(eventName, ...args) {
    if (eventName === "log" && typeof args[0] === "string") {
      this.queueLogLine(args[0]);
    }
    return super.emit(eventName, ...args);
  }

  clearLogBatchTimer() {
    if (this.logBatchTimer) {
      clearTimeout(this.logBatchTimer);
      this.logBatchTimer = null;
    }
  }

  shouldFlushLogImmediately(line) {
    const lowered = String(line || "").toLowerCase();
    return (
      lowered.includes(" error") ||
      lowered.includes("exception") ||
      lowered.includes("fatal") ||
      lowered.includes("failed") ||
      lowered.includes("crash")
    );
  }

  queueLogLine(line) {
    const normalized = String(line || "").replace(/\r?\n$/, "");
    if (!normalized) {
      return;
    }

    this.logBatchQueue.push(normalized);
    if (
      this.logBatchQueue.length >= LOG_BATCH_MAX_LINES ||
      this.shouldFlushLogImmediately(normalized)
    ) {
      this.flushLogBatch();
      return;
    }

    if (!this.logBatchTimer) {
      this.logBatchTimer = setTimeout(() => {
        this.flushLogBatch();
      }, LOG_BATCH_FLUSH_MS);
      if (typeof this.logBatchTimer.unref === "function") {
        this.logBatchTimer.unref();
      }
    }
  }

  flushLogBatch() {
    this.clearLogBatchTimer();
    if (this.logBatchQueue.length === 0) {
      return;
    }
    const batch = this.logBatchQueue.splice(0, this.logBatchQueue.length);
    super.emit("log-batch", batch);
  }

  clearAddonMetadataCache() {
    this.addonMetadataCache.clear();
  }

  getJarPath(
    version = this.currentVersion,
    software = this.currentSoftware || DEFAULT_SERVER_SOFTWARE,
  ) {
    return path.join(this.jarCache, software, `server-${software}-${version}.jar`);
  }

  ensureBaseDir() {
    if (!fs.existsSync(this.baseRoot)) fs.mkdirSync(this.baseRoot, { recursive: true });
    if (!fs.existsSync(this.jarCache)) fs.mkdirSync(this.jarCache, { recursive: true });
    if (!fs.existsSync(path.join(this.baseRoot, "profiles"))) {
      fs.mkdirSync(path.join(this.baseRoot, "profiles"), { recursive: true });
    }
    if (!fs.existsSync(this.profileDir)) fs.mkdirSync(this.profileDir, { recursive: true });
    const jarDir = path.dirname(this.jarPath);
    if (!fs.existsSync(jarDir)) fs.mkdirSync(jarDir, { recursive: true });
  }

  get paths() {
    return {
      base: this.profileDir,
      jar: this.jarPath,
      properties: path.join(this.profileDir, "server.properties"),
      eula: path.join(this.profileDir, "eula.txt"),
      logs: path.join(this.profileDir, "logs"),
      addonsManifest: path.join(this.profileDir, ADDON_MANIFEST_FILE),
    };
  }

  getActiveProfile() {
    return normalizeProfile(this.currentProfile);
  }

  getAddonContext(software = this.currentSoftware || DEFAULT_SERVER_SOFTWARE) {
    const baseContext = ADDON_CONTEXT[software] || ADDON_CONTEXT.vanilla;
    return {
      supported: baseContext.supported,
      kind: baseContext.kind,
      label: baseContext.label,
      helperText: baseContext.helperText,
      folderName: baseContext.folderName,
      runtime: software,
    };
  }

  getAddonDir(software = this.currentSoftware || DEFAULT_SERVER_SOFTWARE) {
    const context = this.getAddonContext(software);
    if (!context.supported || !context.folderName) {
      return null;
    }
    return path.join(this.profileDir, context.folderName);
  }

  listPropertySchema() {
    return SERVER_PROPERTY_SCHEMA.map((entry) => ({ ...entry }));
  }

  getAddonManifestPath(profileDir = this.profileDir) {
    return path.join(profileDir, ADDON_MANIFEST_FILE);
  }

  readAddonManifest(profileDir = this.profileDir) {
    const manifestPath = this.getAddonManifestPath(profileDir);
    const parsed = safeJsonParse(fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath, "utf8") : "{}");
    if (!parsed || typeof parsed !== "object") {
      return { entries: {} };
    }
    return {
      entries: typeof parsed.entries === "object" && parsed.entries ? parsed.entries : {},
    };
  }

  writeAddonManifest(nextManifest, profileDir = this.profileDir) {
    const manifestPath = this.getAddonManifestPath(profileDir);
    const normalized = {
      entries:
        nextManifest && typeof nextManifest.entries === "object" && nextManifest.entries
          ? nextManifest.entries
          : {},
    };
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(normalized, null, 2));
    return normalized;
  }

  setAddonCatalogMetadata(fileName, metadata = {}, profileDir = this.profileDir) {
    if (!fileName) {
      return this.readAddonManifest(profileDir);
    }
    const manifest = this.readAddonManifest(profileDir);
    manifest.entries[fileName] = {
      projectId: String(metadata.projectId || "").trim(),
      installedVersionId: String(metadata.installedVersionId || "").trim(),
      installedVersionNumber: String(metadata.installedVersionNumber || "").trim(),
      updatedAt: Date.now(),
    };
    return this.writeAddonManifest(manifest, profileDir);
  }

  clearAddonCatalogMetadata(fileName, profileDir = this.profileDir) {
    const safeName = String(fileName || "").trim();
    if (!safeName) {
      return this.readAddonManifest(profileDir);
    }
    const manifest = this.readAddonManifest(profileDir);
    delete manifest.entries[safeName];
    return this.writeAddonManifest(manifest, profileDir);
  }

  isRemoteProfile(profile = this.getActiveProfile()) {
    return profile.profileType === "remote";
  }

  async setRemotePassword(profileId, password) {
    const safeProfileId = String(profileId || "").trim();
    if (!safeProfileId) {
      throw new Error("Profile id is required for remote credentials.");
    }
    const credentialRef = `remote:${safeProfileId}`;
    await setSecret(credentialRef, password || "");
    return credentialRef;
  }

  async getRemotePassword(profile = this.getActiveProfile()) {
    const ref = String(profile.rconPasswordRef || "").trim();
    if (!ref) {
      return "";
    }
    return getSecret(ref);
  }

  async clearRemotePassword(profile) {
    const ref = String((profile && profile.rconPasswordRef) || "").trim();
    if (!ref) {
      return;
    }
    await deleteSecret(ref);
  }

  async setRemoteCredentials(profileId, password) {
    const profile = await this.resolveRemoteProfile(profileId);
    if (!this.isRemoteProfile(profile)) {
      throw new Error("Selected profile is not a remote server.");
    }

    const safePassword = String(password || "");
    if (!safePassword.trim()) {
      throw new Error("Remote RCON password cannot be empty.");
    }

    const credentialRef = await this.setRemotePassword(profile.id, safePassword);
    const profiles = readProfiles();
    const nextProfiles = profiles.map((item) =>
      item.id === profile.id ? { ...item, rconPasswordRef: credentialRef } : item,
    );
    const saved = writeProfiles(nextProfiles);
    const current = saved.find((item) => item.id === profile.id);
    if (current && current.id === this.currentProfile.id) {
      this.currentProfile = current;
    }
    return {
      ok: true,
      profileId: profile.id,
      rconPasswordRef: credentialRef,
    };
  }

  async clearRemoteCredentials(profileId) {
    const profile = await this.resolveRemoteProfile(profileId);
    await this.clearRemotePassword(profile);
    const profiles = readProfiles();
    const nextProfiles = profiles.map((item) =>
      item.id === profile.id ? { ...item, rconPasswordRef: "" } : item,
    );
    const saved = writeProfiles(nextProfiles);
    const current = saved.find((item) => item.id === profile.id);
    if (current && current.id === this.currentProfile.id) {
      this.currentProfile = current;
    }
    return {
      ok: true,
      profileId: profile.id,
    };
  }

  async resolveRemoteProfile(profileId = this.profileName) {
    const profiles = readProfiles();
    const found = profiles.find((item) => item.id === profileId);
    if (!found) {
      throw new Error("Remote profile was not found.");
    }
    return normalizeProfile(found);
  }

  async wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  clearRemotePoll() {
    if (this.remotePollTimer) {
      clearInterval(this.remotePollTimer);
      this.remotePollTimer = null;
    }
  }

  async disconnectRemote() {
    this.clearRemotePoll();
    if (!this.remoteRcon) {
      this.remoteConnected = false;
      return;
    }
    const client = this.remoteRcon;
    this.remoteRcon = null;
    this.remoteConnected = false;
    try {
      await client.end();
    } catch {
      // Ignore disconnect failures.
    }
  }

  async connectRemote(profile, timeoutMs) {
    const password = await this.getRemotePassword(profile);
    if (!password) {
      throw new Error("Remote RCON password is missing. Save credentials first.");
    }

    const connectPromise = Rcon.connect({
      host: profile.host,
      port: profile.rconPort,
      password,
    });

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Remote connection timed out.")), timeoutMs);
    });

    const rcon = await Promise.race([connectPromise, timeoutPromise]);
    rcon.on("error", (error) => {
      this.emit("log", `[RCON error] ${error.message || String(error)}`);
    });
    rcon.on("end", () => {
      this.remoteConnected = false;
      this.remoteRcon = null;
      this.clearRemotePoll();
      this.emit("status", {
        running: false,
        profile: this.currentProfile.id,
      });
    });
    return rcon;
  }

  startRemotePoll() {
    this.clearRemotePoll();
    this.remotePollTimer = setInterval(() => {
      if (!this.remoteRcon || !this.remoteConnected) {
        return;
      }
      this.remoteRcon
        .send("list")
        .then((response) => {
          this.emit("log", `[RCON] ${response}`);
        })
        .catch((error) => {
          this.emit("log", `[RCON poll] ${error.message || String(error)}`);
        });
    }, 30 * 1000);
  }

  async runWakeCommand(profile) {
    const command = String(profile.wakeCommand || "").trim();
    if (!command) {
      return;
    }
    this.emit("log", `Running wake command for ${profile.name}...`);
    const child = spawn(command, [], {
      cwd: this.baseRoot,
      shell: true,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  }

  async remoteTestConnection(profileId = this.profileName) {
    const profile = await this.resolveRemoteProfile(profileId);
    if (!this.isRemoteProfile(profile)) {
      throw new Error("Selected profile is not a remote server.");
    }
    const temp = await this.connectRemote(profile, profile.connectTimeoutSec * 1000);
    try {
      const response = await temp.send("list");
      return {
        ok: true,
        response: String(response || "").trim(),
      };
    } finally {
      try {
        await temp.end();
      } catch {
        // Ignore disconnect failures.
      }
    }
  }

  async remoteStart(profileId = this.profileName) {
    const profile = await this.resolveRemoteProfile(profileId);
    if (!this.isRemoteProfile(profile)) {
      throw new Error("Selected profile is not a remote server.");
    }
    if (this.remoteRcon && this.remoteConnected) {
      return {
        running: true,
        profile: profile.id,
        remote: true,
        host: profile.host,
        rconPort: profile.rconPort,
      };
    }

    await this.runWakeCommand(profile);
    const deadline = Date.now() + profile.wakeTimeoutSec * 1000;
    let lastError = null;

    while (Date.now() < deadline) {
      try {
        const client = await this.connectRemote(profile, profile.connectTimeoutSec * 1000);
        await this.disconnectRemote();
        this.remoteRcon = client;
        this.remoteConnected = true;
        this.startedAt = Date.now();
        this.startRemotePoll();

        this.emit("status", {
          running: true,
          profile: profile.id,
          version: profile.version,
          serverSoftware: profile.serverSoftware,
          modePreset: profile.modePreset,
          cheatLock: profile.cheatLock,
          rulesLocked: profile.rulesLocked,
          minMem: profile.minMem,
          maxMem: profile.maxMem,
          port: profile.port,
          idleShutdownMinutes: profile.idleShutdownMinutes,
          remote: true,
          host: profile.host,
          rconPort: profile.rconPort,
        });

        return {
          running: true,
          profile: profile.id,
          remote: true,
          host: profile.host,
          rconPort: profile.rconPort,
        };
      } catch (error) {
        lastError = error;
        await this.wait(REMOTE_CONNECT_RETRY_MS);
      }
    }

    throw new Error(
      `Could not connect to remote RCON before timeout. ${lastError ? lastError.message : ""}`.trim(),
    );
  }

  async remoteStop(profileId = this.profileName) {
    const profile = await this.resolveRemoteProfile(profileId);
    if (!this.isRemoteProfile(profile)) {
      throw new Error("Selected profile is not a remote server.");
    }
    if (!this.remoteRcon || !this.remoteConnected) {
      return { running: false };
    }
    try {
      await this.remoteRcon.send("stop");
    } catch (error) {
      this.emit("log", `[RCON stop] ${error.message || String(error)}`);
    }
    await this.disconnectRemote();
    this.emit("status", {
      running: false,
      profile: profile.id,
      remote: true,
      host: profile.host,
      rconPort: profile.rconPort,
    });
    return { running: false };
  }

  async remoteCommand(cmd, profileId = this.profileName) {
    const profile = await this.resolveRemoteProfile(profileId);
    if (!this.isRemoteProfile(profile)) {
      throw new Error("Selected profile is not a remote server.");
    }
    if (!this.remoteRcon || !this.remoteConnected) {
      throw new Error("Remote server is not connected. Start or test connection first.");
    }
    const response = await this.remoteRcon.send(cmd);
    const line = String(response || "").trim();
    if (line) {
      this.emit("log", `[RCON] ${line}`);
    }
    return line;
  }

  ensureUpnpClient() {
    if (!this.upnpClient) {
      this.upnpClient = natUpnp.createClient();
    }
    return this.upnpClient;
  }

  async getPublicIpAddress() {
    try {
      const payload = await this.fetchJson("https://api.ipify.org?format=json");
      return String(payload.ip || "").trim();
    } catch {
      return "";
    }
  }

  getLocalIpv4Candidates() {
    const interfaces = os.networkInterfaces();
    const addresses = [];
    for (const entries of Object.values(interfaces)) {
      for (const entry of entries || []) {
        if (!entry || entry.family !== "IPv4" || entry.internal) {
          continue;
        }
        addresses.push(entry.address);
      }
    }
    return addresses;
  }

  async checkTcpReachable(host, port, timeoutMs = 1500) {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      const clean = (ok) => {
        socket.destroy();
        resolve(ok);
      };
      socket.setTimeout(timeoutMs);
      socket.once("error", () => clean(false));
      socket.once("timeout", () => clean(false));
      socket.connect(port, host, () => clean(true));
    });
  }

  async networkDiagnostics(profileId = this.profileName) {
    const profile = await this.resolveRemoteProfile(profileId);
    if (this.isRemoteProfile(profile)) {
      const reachable = await this.checkTcpReachable(
        profile.host,
        profile.rconPort,
        profile.connectTimeoutSec * 1000,
      );
      return {
        mode: "remote",
        host: profile.host,
        rconPort: profile.rconPort,
        reachable,
        summary: reachable
          ? "Remote RCON endpoint is reachable."
          : "Remote RCON endpoint is not reachable from this machine.",
      };
    }

    const profileDir = path.join(this.baseRoot, "profiles", profile.id);
    const propertiesPath = path.join(profileDir, "server.properties");
    const props = fs.existsSync(propertiesPath)
      ? parseProperties(fs.readFileSync(propertiesPath, "utf8"))
      : this.getDefaultProperties(profile);
    const bindIp = String(props["server-ip"] || "").trim();
    const port = Number.parseInt(String(props["server-port"] || profile.port || 25565), 10) || 25565;
    const effectiveBind = bindIp || "0.0.0.0";
    const localhostReachable = await this.checkTcpReachable("127.0.0.1", port);
    const publicIp = await this.getPublicIpAddress();
    const publicHost = String(profile.publicHost || "").trim();
    const displayHost = publicHost || publicIp || "<public-ip>";
    const needsPortForward = LOCALHOST_CANDIDATES.has(bindIp.toLowerCase());

    return {
      mode: "local",
      bindIp: effectiveBind,
      port,
      localhostReachable,
      publicIp,
      publicHost,
      publicEndpoint: `${displayHost}:${port}`,
      needsPortForward,
      localIps: this.getLocalIpv4Candidates(),
      summary: localhostReachable
        ? "Server port responds on localhost. Configure router/NAT for public access."
        : "Server process is not listening on localhost yet. Start server and check bind/port.",
    };
  }

  async upnpMap(profileId = this.profileName) {
    const diagnostics = await this.networkDiagnostics(profileId);
    if (diagnostics.mode !== "local") {
      throw new Error("UPnP mapping is only available for local profiles.");
    }
    const client = this.ensureUpnpClient();
    await new Promise((resolve, reject) => {
      client.portMapping(
        {
          public: diagnostics.port,
          private: diagnostics.port,
          protocol: "TCP",
          ttl: 60 * 60,
          description: `${APP_NAME} ${profileId}`,
        },
        (error) => {
          if (error) {
            reject(new Error(`UPnP map failed: ${error.message || String(error)}`));
            return;
          }
          resolve();
        },
      );
    });
    return {
      mapped: true,
      port: diagnostics.port,
      endpoint: diagnostics.publicEndpoint,
    };
  }

  async upnpUnmap(profileId = this.profileName) {
    const diagnostics = await this.networkDiagnostics(profileId);
    if (diagnostics.mode !== "local") {
      throw new Error("UPnP mapping is only available for local profiles.");
    }
    const client = this.ensureUpnpClient();
    await new Promise((resolve, reject) => {
      client.portUnmapping(
        { public: diagnostics.port, protocol: "TCP" },
        (error) => {
          if (error) {
            reject(new Error(`UPnP unmap failed: ${error.message || String(error)}`));
            return;
          }
          resolve();
        },
      );
    });
    return {
      mapped: false,
      port: diagnostics.port,
    };
  }

  getBackupsDir(profileId = this.profileName) {
    return path.join(this.baseRoot, "backups", profileId);
  }

  getProfileStatePath(profileDir = this.profileDir) {
    return path.join(profileDir, PROFILE_STATE_FILE);
  }

  readProfileState(profileDir = this.profileDir) {
    const statePath = this.getProfileStatePath(profileDir);
    const parsed = safeJsonParse(fs.existsSync(statePath) ? fs.readFileSync(statePath, "utf8") : "{}") || {};
    return {
      startsSinceAutoBackup: Math.max(0, Number(parsed.startsSinceAutoBackup) || 0),
    };
  }

  writeProfileState(nextState = {}, profileDir = this.profileDir) {
    const statePath = this.getProfileStatePath(profileDir);
    const normalized = {
      startsSinceAutoBackup: Math.max(0, Number(nextState.startsSinceAutoBackup) || 0),
    };
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(normalized, null, 2));
    return normalized;
  }

  resetProfileState(profileDir = this.profileDir) {
    return this.writeProfileState({ startsSinceAutoBackup: 0 }, profileDir);
  }

  getBackupPolicy(profile = this.getActiveProfile()) {
    return {
      maxBackups: 4,
      maxAutoBackups: 2,
      maxManualBackups: 2,
      autoIntervalMs: AUTO_BACKUP_INTERVAL_MS,
      // World deletion on death caused irreversible data loss and false positives.
      // Hardcore now keeps the gameplay rules without destructive cleanup.
      wipeOnDeath: false,
    };
  }

  isAutoBackupReason(reason = "") {
    return String(reason || "").trim().toLowerCase().startsWith("auto-");
  }

  getProtectedBackupIds(backups = [], policy = this.getBackupPolicy()) {
    const normalizedBackups = Array.isArray(backups) ? backups : [];
    const maxBackups = Math.max(0, Number(policy.maxBackups) || 0);
    const maxAutoBackups = Math.max(0, Number(policy.maxAutoBackups) || 0);
    const maxManualBackups = Math.max(0, Number(policy.maxManualBackups) || 0);
    const autoBackups = [];
    const manualBackups = [];

    for (const backup of normalizedBackups) {
      if (this.isAutoBackupReason(backup.reason)) {
        autoBackups.push(backup);
        continue;
      }
      manualBackups.push(backup);
    }

    const protectedIds = new Set();
    for (const backup of autoBackups.slice(0, maxAutoBackups)) {
      protectedIds.add(backup.id);
    }
    for (const backup of manualBackups.slice(0, maxManualBackups)) {
      protectedIds.add(backup.id);
    }

    if (protectedIds.size <= maxBackups) {
      return protectedIds;
    }

    const trimmedProtectedIds = new Set();
    for (const backup of normalizedBackups) {
      if (!protectedIds.has(backup.id)) {
        continue;
      }
      trimmedProtectedIds.add(backup.id);
      if (trimmedProtectedIds.size >= maxBackups) {
        break;
      }
    }
    return trimmedProtectedIds;
  }

  getCurrentWorldName(profileDir = this.profileDir) {
    return this.getConfiguredLevelName(profileDir);
  }

  hasMeaningfulProfileContent(profileDir = this.profileDir) {
    if (!fs.existsSync(profileDir)) {
      return false;
    }
    return fs.readdirSync(profileDir).some((entry) => !BACKUP_SKIP_NAMES.has(entry));
  }

  copyRecursive(source, destination) {
    const stats = fs.statSync(source);
    if (stats.isDirectory()) {
      fs.mkdirSync(destination, { recursive: true });
      for (const entry of fs.readdirSync(source)) {
        this.copyRecursive(path.join(source, entry), path.join(destination, entry));
      }
      return;
    }

    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }

  getDirectorySize(targetPath) {
    if (!fs.existsSync(targetPath)) {
      return 0;
    }
    const stats = fs.statSync(targetPath);
    if (!stats.isDirectory()) {
      return stats.size;
    }

    return fs.readdirSync(targetPath).reduce((total, entry) => {
      return total + this.getDirectorySize(path.join(targetPath, entry));
    }, 0);
  }

  listBackups(profileId = this.profileName, worldName = this.getCurrentWorldName()) {
    const backupRoot = this.getBackupsDir(profileId);
    if (!fs.existsSync(backupRoot)) {
      return [];
    }

    return fs
      .readdirSync(backupRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const id = entry.name;
        const metadataPath = path.join(backupRoot, entry.name, "metadata.json");
        const metadata = safeJsonParse(
          fs.existsSync(metadataPath) ? fs.readFileSync(metadataPath, "utf8") : "{}",
        );
        const parsedIdPrefix = Number.parseInt(String(id).split("-")[0], 10);
        const idReason = String(id || "").replace(/^\d+-/, "").trim();
        const metadataCreatedAt = Number(metadata && metadata.createdAt);
        const metadataReason =
          metadata && typeof metadata.reason === "string" ? metadata.reason.trim() : "";
        const metadataSize = Number(metadata && metadata.sizeBytes);
        return {
          id,
          createdAt:
            Number.isFinite(metadataCreatedAt) && metadataCreatedAt > 0
              ? metadataCreatedAt
              : Number.isFinite(parsedIdPrefix)
                ? parsedIdPrefix
                : 0,
          reason: metadataReason || idReason || "manual",
          worldName:
            (metadata && metadata.worldName) ||
            this.getConfiguredLevelName(path.join(backupRoot, entry.name, "data")),
          sizeBytes: Number.isFinite(metadataSize) && metadataSize > 0 ? metadataSize : 0,
        };
      })
      .filter((entry) => !worldName || entry.worldName === worldName)
      .sort((left, right) => right.createdAt - left.createdAt);
  }

  pruneBackups(
    profileId = this.profileName,
    maxBackups = this.getBackupPolicy().maxBackups,
    worldName = null,
    options = {},
  ) {
    const backupRoot = this.getBackupsDir(profileId);
    const explicitProtectedIds = new Set(
      Array.isArray(options.protectBackupIds)
        ? options.protectBackupIds.map((backupId) => String(backupId || "").trim()).filter(Boolean)
        : [],
    );
    const policy = this.getBackupPolicy();
    const safeMaxBackups = Math.max(0, Number(maxBackups) || 0);

    if (safeMaxBackups < 1 && explicitProtectedIds.size === 0) {
      this.deleteBackups(profileId, worldName);
      return [];
    }

    const backups = this.listBackups(profileId, worldName);
    const retentionPolicy = {
      ...policy,
      maxBackups: safeMaxBackups,
      maxAutoBackups: Math.min(Math.max(0, Number(policy.maxAutoBackups) || 0), safeMaxBackups),
      maxManualBackups: Math.min(Math.max(0, Number(policy.maxManualBackups) || 0), safeMaxBackups),
    };
    const protectedIds = this.getProtectedBackupIds(backups, retentionPolicy);
    for (const backupId of explicitProtectedIds) {
      protectedIds.add(backupId);
    }

    for (const backup of backups) {
      if (protectedIds.has(backup.id)) {
        continue;
      }
      fs.rmSync(path.join(backupRoot, backup.id), { recursive: true, force: true });
    }
    return this.listBackups(profileId, worldName);
  }

  deleteBackups(profileId = this.profileName, worldName = null) {
    const backupRoot = this.getBackupsDir(profileId);
    if (!fs.existsSync(backupRoot)) {
      return;
    }

    if (!worldName) {
      fs.rmSync(backupRoot, { recursive: true, force: true });
      return;
    }

    for (const backup of this.listBackups(profileId, worldName)) {
      fs.rmSync(path.join(backupRoot, backup.id), { recursive: true, force: true });
    }
  }

  walkFiles(rootDir, visitor) {
    if (!rootDir || !fs.existsSync(rootDir)) {
      return;
    }
    const stack = [rootDir];
    while (stack.length > 0) {
      const current = stack.pop();
      const entries = fs.readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
          continue;
        }
        visitor(fullPath, entry);
      }
    }
  }

  getReferencedJarPaths() {
    const referenced = new Set([path.resolve(this.jarPath)]);
    for (const profile of readProfiles()) {
      const software = profile.serverSoftware || DEFAULT_SERVER_SOFTWARE;
      const version = profile.version || DEFAULT_MC_VERSION;
      referenced.add(path.resolve(this.getJarPath(version, software)));
    }
    return referenced;
  }

  getStorageReport(profileId = this.profileName) {
    const safeProfileId = String(profileId || this.profileName || "").trim() || this.profileName;
    const profileDir = path.join(this.baseRoot, "profiles", safeProfileId);
    const backupDir = this.getBackupsDir(safeProfileId);
    const logsDir = path.join(profileDir, "logs");
    const addonDirs = ["mods", "plugins"]
      .map((folder) => path.join(profileDir, folder))
      .filter((folderPath) => fs.existsSync(folderPath));
    const addonBytes = addonDirs.reduce((total, folderPath) => total + this.getDirectorySize(folderPath), 0);
    const backups = this.listBackups(safeProfileId, null);
    const jarFiles = [];
    this.walkFiles(this.jarCache, (filePath) => {
      if (filePath.toLowerCase().endsWith(".jar")) {
        jarFiles.push(filePath);
      }
    });

    const jarsBytes = this.getDirectorySize(this.jarCache);
    const backupsBytes = this.getDirectorySize(backupDir);
    const logsBytes = this.getDirectorySize(logsDir);
    const totalBytes = jarsBytes + backupsBytes + logsBytes + addonBytes;

    return {
      profileId: safeProfileId,
      jarsBytes,
      backupsBytes,
      logsBytes,
      addonsBytes: addonBytes,
      totalBytes,
      jarCount: jarFiles.length,
      backupCount: backups.length,
      addonCount: addonDirs.reduce((count, folderPath) => {
        let nextCount = count;
        this.walkFiles(folderPath, (filePath) => {
          if (filePath.toLowerCase().endsWith(".jar")) {
            nextCount += 1;
          }
        });
        return nextCount;
      }, 0),
    };
  }

  cleanupStorage(profileId = this.profileName, options = {}) {
    const safeProfileId = String(profileId || this.profileName || "").trim() || this.profileName;
    const profileDir = path.join(this.baseRoot, "profiles", safeProfileId);
    const logsDir = path.join(profileDir, "logs");
    const backupDir = this.getBackupsDir(safeProfileId);
    const now = Date.now();
    const jarMaxAgeDays = Math.max(1, Number(options.jarMaxAgeDays) || JAR_CLEANUP_MAX_AGE_DAYS);
    const backupMaxAgeDays = Math.max(1, Number(options.backupMaxAgeDays) || BACKUP_CLEANUP_MAX_AGE_DAYS);
    const logMaxAgeDays = Math.max(1, Number(options.logMaxAgeDays) || LOG_CLEANUP_MAX_AGE_DAYS);
    const jarAgeMs = jarMaxAgeDays * MILLIS_PER_DAY;
    const backupAgeMs = backupMaxAgeDays * MILLIS_PER_DAY;
    const logAgeMs = logMaxAgeDays * MILLIS_PER_DAY;
    const backupPolicy = this.getBackupPolicy();

    const removed = {
      jars: 0,
      backups: 0,
      logs: 0,
      bytes: 0,
    };

    const referencedJars = this.getReferencedJarPaths();
    this.walkFiles(this.jarCache, (filePath) => {
      if (!filePath.toLowerCase().endsWith(".jar")) {
        return;
      }
      const resolvedPath = path.resolve(filePath);
      if (referencedJars.has(resolvedPath)) {
        return;
      }
      const stats = fs.statSync(filePath);
      if (now - stats.mtimeMs < jarAgeMs) {
        return;
      }
      fs.rmSync(filePath, { force: true });
      removed.jars += 1;
      removed.bytes += stats.size;
    });

    if (fs.existsSync(backupDir)) {
      const allBackups = this.listBackups(safeProfileId, null);
      const protectedBackups = this.getProtectedBackupIds(allBackups, backupPolicy);
      for (const backup of allBackups) {
        if (protectedBackups.has(backup.id)) {
          continue;
        }
        if (now - Number(backup.createdAt || 0) < backupAgeMs) {
          continue;
        }
        const backupPath = path.join(backupDir, backup.id);
        const sizeBytes = this.getDirectorySize(backupPath);
        fs.rmSync(backupPath, { recursive: true, force: true });
        removed.backups += 1;
        removed.bytes += sizeBytes;
      }
    }

    this.walkFiles(logsDir, (filePath) => {
      const stats = fs.statSync(filePath);
      if (now - stats.mtimeMs < logAgeMs) {
        return;
      }
      fs.rmSync(filePath, { force: true });
      removed.logs += 1;
      removed.bytes += stats.size;
    });

    this.clearAddonMetadataCache();
    return {
      profileId: safeProfileId,
      removed,
      policy: {
        jarMaxAgeDays,
        backupMaxAgeDays,
        logMaxAgeDays,
        maxBackups: backupPolicy.maxBackups,
        maxAutoBackups: backupPolicy.maxAutoBackups,
        maxManualBackups: backupPolicy.maxManualBackups,
      },
      report: this.getStorageReport(safeProfileId),
    };
  }

  createBackup(reason = "manual", options = {}) {
    if (!this.hasMeaningfulProfileContent()) {
      return {
        id: "",
        createdAt: Date.now(),
        reason,
        sizeBytes: 0,
      };
    }

    const backupRoot = this.getBackupsDir();
    const createdAt = Date.now();
    const backupIdBase = `${createdAt}-${String(reason || "manual")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "backup"}`;
    let backupId = backupIdBase;
    let backupDir = path.join(backupRoot, backupId);
    let suffix = 1;
    while (fs.existsSync(backupDir)) {
      backupId = `${backupIdBase}-${suffix}`;
      backupDir = path.join(backupRoot, backupId);
      suffix += 1;
    }
    const backupDataDir = path.join(backupDir, "data");
    const worldName = this.getCurrentWorldName();

    fs.mkdirSync(backupDataDir, { recursive: true });
    for (const entry of fs.readdirSync(this.profileDir, { withFileTypes: true })) {
      if (BACKUP_SKIP_NAMES.has(entry.name)) {
        continue;
      }
      this.copyRecursive(path.join(this.profileDir, entry.name), path.join(backupDataDir, entry.name));
    }

    const backupEntry = {
      id: backupId,
      createdAt,
      reason,
      worldName,
      sizeBytes: this.getDirectorySize(backupDataDir),
    };
    fs.writeFileSync(path.join(backupDir, "metadata.json"), JSON.stringify(backupEntry, null, 2));
    if (options.skipPrune !== true) {
      this.pruneBackups(this.profileName, this.getBackupPolicy().maxBackups, null, {
        protectBackupIds: Array.isArray(options.protectBackupIds) ? options.protectBackupIds : [],
      });
    }
    return backupEntry;
  }

  async flushWorldToDisk() {
    if (!this.serverProcess || !this.serverProcess.stdin || this.serverProcess.killed) {
      return;
    }

    try {
      this.serverProcess.stdin.write("save-all flush\n");
    } catch {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  startAutoBackupLoop() {
    this.stopAutoBackupLoop();
    this.autoBackupTimer = setInterval(() => {
      this.runAutoBackup().catch((error) => {
        this.emit("log", `Auto backup failed: ${error.message || String(error)}`);
      });
    }, this.getBackupPolicy().autoIntervalMs);
  }

  stopAutoBackupLoop() {
    if (this.autoBackupTimer) {
      clearInterval(this.autoBackupTimer);
      this.autoBackupTimer = null;
    }
  }

  normalizeIdleShutdownMinutes(value = this.currentProfile.idleShutdownMinutes) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return 0;
    }
    return Math.min(parsed, 1440);
  }

  updateIdlePresenceState(nextPlayerCount) {
    const safeCount = Math.max(0, Number(nextPlayerCount) || 0);
    this.lastKnownOnlinePlayers = safeCount;
    if (safeCount > 0) {
      this.idleSince = null;
      return;
    }
    if (!this.idleSince) {
      this.idleSince = Date.now();
    }
  }

  requestPlayerSnapshot() {
    if (!this.serverProcess || !this.serverProcess.stdin || this.serverProcess.killed) {
      return;
    }
    try {
      this.serverProcess.stdin.write("list\n");
    } catch {
      // Ignore write failures while server is shutting down.
    }
  }

  evaluateIdleShutdown() {
    if (
      !this.serverProcess ||
      this.idleShutdownMinutes < 1 ||
      this.idleShutdownPending
    ) {
      return;
    }

    this.requestPlayerSnapshot();

    if (this.lastKnownOnlinePlayers > 0) {
      return;
    }

    if (!this.idleSince) {
      this.idleSince = Date.now();
    }

    const idleLimitMs = this.idleShutdownMinutes * 60 * 1000;
    const idleElapsedMs = Date.now() - this.idleSince;
    if (idleElapsedMs < idleLimitMs) {
      return;
    }

    this.idleShutdownPending = true;
    this.emit(
      "log",
      `Idle shutdown triggered after ${this.idleShutdownMinutes} minute${this.idleShutdownMinutes === 1 ? "" : "s"} with no players online.`,
    );
    this.stop().catch((error) => {
      this.idleShutdownPending = false;
      this.emit("log", `Idle shutdown failed: ${error.message || String(error)}`);
    });
  }

  startIdleShutdownLoop(minutes = this.currentProfile.idleShutdownMinutes) {
    this.stopIdleShutdownLoop();
    this.idleShutdownMinutes = this.normalizeIdleShutdownMinutes(minutes);
    this.lastKnownOnlinePlayers = 0;
    this.idleSince = this.idleShutdownMinutes > 0 ? Date.now() : null;

    if (this.idleShutdownMinutes < 1) {
      return;
    }

    this.emit(
      "log",
      `Idle shutdown enabled: stop server after ${this.idleShutdownMinutes} minute${this.idleShutdownMinutes === 1 ? "" : "s"} with no players online.`,
    );

    this.idleCheckTimer = setInterval(() => {
      this.evaluateIdleShutdown();
    }, IDLE_CHECK_INTERVAL_MS);

    this.evaluateIdleShutdown();
  }

  stopIdleShutdownLoop() {
    if (this.idleCheckTimer) {
      clearInterval(this.idleCheckTimer);
      this.idleCheckTimer = null;
    }
    this.idleShutdownPending = false;
  }

  async runAutoBackup() {
    if (!this.serverProcess || this.autoBackupInProgress) {
      return null;
    }

    this.autoBackupInProgress = true;
    try {
      await this.flushWorldToDisk();
      const backup = this.createBackup("auto-5m");
      this.emit("log", `Auto backup created: ${backup.id}`);
      return backup;
    } finally {
      this.autoBackupInProgress = false;
    }
  }

  async restoreBackup(backupId) {
    if (!backupId) {
      throw new Error("Backup id is required.");
    }
    const sourceDir = path.join(this.getBackupsDir(), backupId, "data");
    if (!fs.existsSync(sourceDir)) {
      throw new Error("Backup not found.");
    }

    if (this.serverProcess) {
      await this.stop();
    }

    if (this.hasMeaningfulProfileContent()) {
      this.createBackup("pre-restore", { protectBackupIds: [backupId] });
    }

    fs.mkdirSync(this.profileDir, { recursive: true });
    for (const entry of fs.readdirSync(this.profileDir)) {
      fs.rmSync(path.join(this.profileDir, entry), { recursive: true, force: true });
    }
    for (const entry of fs.readdirSync(sourceDir)) {
      this.copyRecursive(path.join(sourceDir, entry), path.join(this.profileDir, entry));
    }
    this.clearAddonMetadataCache();

    this.emit("status", {
      profile: this.currentProfile.id,
      version: this.currentProfile.version,
      serverSoftware: this.currentProfile.serverSoftware,
      rulesLocked: this.currentProfile.rulesLocked,
      minMem: this.currentProfile.minMem,
      maxMem: this.currentProfile.maxMem,
      port: this.currentProfile.port,
      idleShutdownMinutes: this.currentProfile.idleShutdownMinutes,
    });

    return this.listBackups();
  }

  readZipEntryText(zip, entryName) {
    const entry = zip.getEntry(entryName);
    if (!entry) {
      return null;
    }
    return zip.readAsText(entry);
  }

  getAddonMetadataCacheKey(filePath, runtime, stats) {
    if (!stats) {
      return `${runtime}|${filePath}|missing`;
    }
    return `${runtime}|${filePath}|${stats.size}|${stats.mtimeMs}`;
  }

  getAddonMetadataCached(filePath, runtime, stats) {
    const cacheKey = this.getAddonMetadataCacheKey(filePath, runtime, stats);
    const cached = this.addonMetadataCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const metadata = this.getAddonMetadata(filePath, runtime);
    this.addonMetadataCache.set(cacheKey, metadata);
    return metadata;
  }

  getAddonMetadata(filePath, runtime) {
    try {
      const zip = new AdmZip(filePath);
      if (runtime === "fabric") {
        const raw = this.readZipEntryText(zip, "fabric.mod.json");
        if (!raw) {
          return {
            valid: false,
            displayName: path.basename(filePath),
            errors: ["Missing fabric.mod.json. This jar is not a valid Fabric mod."],
          };
        }
        const metadata = safeJsonParse(raw);
        if (!metadata) {
          return {
            valid: false,
            displayName: path.basename(filePath),
            errors: ["fabric.mod.json could not be parsed."],
          };
        }
        return {
          valid: true,
          runtime: "fabric",
          fileName: path.basename(filePath),
          id: metadata.id || path.basename(filePath, ".jar"),
          name: metadata.name || metadata.id || path.basename(filePath, ".jar"),
          version: metadata.version || "unknown",
          description: metadata.description || "",
          environment: metadata.environment || "*",
          depends: metadata.depends || {},
        };
      }

      const rawPaper = this.readZipEntryText(zip, "paper-plugin.yml");
      const rawPlugin = rawPaper || this.readZipEntryText(zip, "plugin.yml");
      if (!rawPlugin) {
        return {
          valid: false,
          displayName: path.basename(filePath),
          errors: ["Missing plugin.yml or paper-plugin.yml. This jar is not a valid Paper plugin."],
        };
      }

      const metadata = yaml.load(rawPlugin) || {};
      const dependencyBlock =
        metadata.dependencies && metadata.dependencies.server
          ? Object.entries(metadata.dependencies.server)
              .filter(([, config]) => !config || config.required !== false)
              .map(([name]) => name)
          : [];

      return {
        valid: true,
        runtime: "paper",
        fileName: path.basename(filePath),
        id: metadata.name || path.basename(filePath, ".jar"),
        name: metadata.name || path.basename(filePath, ".jar"),
        version: metadata.version || "unknown",
        description: metadata.description || "",
        apiVersion: metadata["api-version"] || metadata.apiVersion || null,
        depends: Array.isArray(metadata.depend) ? metadata.depend : dependencyBlock,
      };
    } catch (error) {
      return {
        valid: false,
        displayName: path.basename(filePath),
        errors: [error.message || "Could not read jar metadata."],
      };
    }
  }

  buildCompatibilityReport(
    items,
    runtime = this.currentSoftware || DEFAULT_SERVER_SOFTWARE,
    metadataByName = null,
  ) {
    const findings = [];
    if (runtime === "vanilla") {
      return {
        ready: true,
        summary: "Vanilla has no add-on compatibility checks because it does not load mods or plugins.",
        findings,
      };
    }

    const addonDir = this.getAddonDir(runtime);
    const metadataList = items
      .map((item) => {
        if (metadataByName && metadataByName.has(item.name)) {
          return metadataByName.get(item.name);
        }
        if (!addonDir) {
          return null;
        }
        const filePath = path.join(addonDir, item.name);
        if (!fs.existsSync(filePath)) {
          return null;
        }
        const stats = fs.statSync(filePath);
        return this.getAddonMetadataCached(filePath, runtime, stats);
      })
      .filter(Boolean);

    if (runtime === "fabric") {
      const installedIds = new Set(
        metadataList.filter((meta) => meta.valid).map((meta) => meta.id),
      );
      for (const meta of metadataList) {
        if (!meta.valid) {
          for (const message of meta.errors || []) {
            findings.push({ level: "error", addon: meta.displayName, message });
          }
          continue;
        }
        if (meta.environment === "client") {
          findings.push({
            level: "error",
            addon: meta.name,
            message: "Client-only mod detected. It will not run on a server.",
          });
        }
        if (
          meta.depends.minecraft &&
          !matchesVersionRequirement(this.currentVersion, meta.depends.minecraft)
        ) {
          findings.push({
            level: "error",
            addon: meta.name,
            message: `Minecraft ${this.currentVersion} does not satisfy ${meta.depends.minecraft}.`,
          });
        }
        for (const [dependency, requirement] of Object.entries(meta.depends || {})) {
          if (BUILTIN_FABRIC_DEPENDENCIES.has(dependency)) {
            continue;
          }
          if (!installedIds.has(dependency)) {
            findings.push({
              level: "error",
              addon: meta.name,
              message: `Missing required dependency ${dependency}${requirement ? ` (${requirement})` : ""}.`,
            });
          }
        }
      }
    } else if (runtime === "paper") {
      const installedNames = new Set(
        metadataList.filter((meta) => meta.valid).map((meta) => String(meta.name).toLowerCase()),
      );
      for (const meta of metadataList) {
        if (!meta.valid) {
          for (const message of meta.errors || []) {
            findings.push({ level: "error", addon: meta.displayName, message });
          }
          continue;
        }
        const apiVersion = extractReleaseVersion(meta.apiVersion);
        if (apiVersion && compareReleaseVersions(apiVersion, this.currentVersion) > 0) {
          findings.push({
            level: "warning",
            addon: meta.name,
            message: `Plugin API ${apiVersion} is newer than server ${this.currentVersion}.`,
          });
        }
        for (const dependency of meta.depends || []) {
          if (!installedNames.has(String(dependency).toLowerCase())) {
            findings.push({
              level: "error",
              addon: meta.name,
              message: `Missing required plugin dependency ${dependency}.`,
            });
          }
        }
      }
    }

    const errorCount = findings.filter((finding) => finding.level === "error").length;
    const warningCount = findings.filter((finding) => finding.level === "warning").length;
    return {
      ready: errorCount === 0,
      summary:
        errorCount > 0
          ? `${errorCount} error${errorCount === 1 ? "" : "s"} and ${warningCount} warning${warningCount === 1 ? "" : "s"} found.`
          : warningCount > 0
            ? `${warningCount} warning${warningCount === 1 ? "" : "s"} found.`
            : "No compatibility problems found in the current add-ons.",
      findings,
    };
  }

  resolveProfileInput(profileInput) {
    const requested =
      typeof profileInput === "string" ? { id: profileInput } : profileInput || {};
    const profiles = readProfiles();
    const saved = profiles.find((profile) => profile.id === requested.id);
    return normalizeProfile({ ...(saved || {}), ...requested });
  }

  persistCurrentProfile(updates = {}) {
    this.currentProfile = normalizeProfile({ ...this.currentProfile, ...updates });
    this.currentVersion = this.currentProfile.version;
    this.currentSoftware = this.currentProfile.serverSoftware || DEFAULT_SERVER_SOFTWARE;
    this.jarPath = this.getJarPath(this.currentVersion, this.currentSoftware);
    this.ensureBaseDir();

    if (!this.currentProfile.id || this.currentProfile.id === "default") {
      return this.currentProfile;
    }

    const profiles = readProfiles();
    const index = profiles.findIndex((profile) => profile.id === this.currentProfile.id);
    if (index >= 0) {
      profiles[index] = normalizeProfile({ ...profiles[index], ...updates });
      const saved = writeProfiles(profiles);
      this.currentProfile = saved[index];
      this.currentVersion = this.currentProfile.version;
      this.currentSoftware = this.currentProfile.serverSoftware || DEFAULT_SERVER_SOFTWARE;
      this.jarPath = this.getJarPath(this.currentVersion, this.currentSoftware);
      this.ensureBaseDir();
    }

    return this.currentProfile;
  }

  sanitizeWorldName(value) {
    const safeName = path.basename(String(value || "").trim());
    if (!safeName || safeName === "." || safeName === "..") {
      return "world";
    }
    return safeName;
  }

  getConfiguredLevelName(profileDir = this.profileDir) {
    const propertiesPath = path.join(profileDir, "server.properties");
    if (!fs.existsSync(propertiesPath)) {
      return "world";
    }

    try {
      const raw = fs.readFileSync(propertiesPath, "utf8");
      const parsed = parseProperties(raw);
      return this.sanitizeWorldName(parsed["level-name"] || "world");
    } catch {
      return "world";
    }
  }

  getKnownWorldNames(profileDir = this.profileDir) {
    const configured = this.getConfiguredLevelName(profileDir);
    return [...new Set(["world", "world_nether", "world_the_end", configured, `${configured}_nether`, `${configured}_the_end`])];
  }

  deleteWorldData(profileDir = this.profileDir) {
    for (const worldName of this.getKnownWorldNames(profileDir)) {
      const worldPath = path.join(profileDir, worldName);
      if (fs.existsSync(worldPath)) {
        fs.rmSync(worldPath, { recursive: true, force: true });
      }
    }
  }

  getPresetPolicy(profile = this.getActiveProfile()) {
    return PRESET_POLICIES[profile.modePreset] || PRESET_POLICIES[DEFAULT_MODE_PRESET];
  }

  getPolicyProperties(profile = this.getActiveProfile()) {
    const policy = { ...this.getPresetPolicy(profile).properties };
    if (profile.cheatLock) {
      policy["enable-command-block"] = "false";
      policy["allow-flight"] = "false";
      policy["force-gamemode"] = "true";
    }
    return policy;
  }

  normalizePropertyMap(input = {}) {
    return Object.entries(input).reduce((acc, [key, value]) => {
      acc[key] = String(value);
      return acc;
    }, {});
  }

  getRestrictedPropertyKeys(profile = this.getActiveProfile()) {
    const keys = new Set(Object.keys(this.getPresetPolicy(profile).properties));
    if (profile.cheatLock) {
      keys.add("enable-command-block");
      keys.add("allow-flight");
      keys.add("force-gamemode");
    }
    return keys;
  }

  enforcePolicyProperties(props, updates = null) {
    const profile = this.getActiveProfile();
    const normalizedProps = this.normalizePropertyMap(props);
    const normalizedUpdates = updates ? this.normalizePropertyMap(updates) : null;
    const enforcedPolicy = this.getPolicyProperties(profile);
    const restrictedKeys = this.getRestrictedPropertyKeys(profile);

    if (normalizedUpdates) {
      const reason = profile.rulesLocked
        ? "World rules are locked after the first launch."
        : "This server preset controls those values.";
      for (const key of restrictedKeys) {
        if (
          Object.prototype.hasOwnProperty.call(normalizedUpdates, key) &&
          normalizedUpdates[key] !== enforcedPolicy[key]
        ) {
          throw new Error(`${reason} ${key} must stay ${enforcedPolicy[key]}.`);
        }
      }
    }

    return {
      ...normalizedProps,
      ...enforcedPolicy,
      motd: normalizedProps.motd || profile.motd || DEFAULT_MOTD,
    };
  }

  getDefaultProperties(profile = this.getActiveProfile()) {
    return {
      ...BASE_PROPERTIES,
      motd: profile.motd || DEFAULT_MOTD,
      ...this.getPolicyProperties(profile),
    };
  }

  hasWorldData(profileDir = this.profileDir) {
    return this.getKnownWorldNames(profileDir).some((entry) => fs.existsSync(path.join(profileDir, entry)));
  }

  registerServerStart(profile = this.getActiveProfile()) {
    const policy = this.getBackupPolicy(profile);
    const state = this.readProfileState();
    this.writeProfileState(state);
    return {
      createdBackup: null,
      policy,
      state,
    };
  }

  shouldWipeHardcoreWorldFromLog(line) {
    if (!this.getBackupPolicy().wipeOnDeath) {
      return false;
    }

    const rawLine = String(line || "").trim();
    if (!rawLine) {
      return false;
    }

    const payload = rawLine.includes("]: ") ? rawLine.split("]: ").pop() || rawLine : rawLine;
    if (!payload) {
      return false;
    }

    if (HARDCORE_LOG_IGNORE_PREFIXES.some((prefix) => payload.startsWith(prefix))) {
      return false;
    }
    if (payload.includes(" issued server command:")) {
      return false;
    }
    if (
      payload.includes("lost connection: You have died") ||
      payload.includes("Game over, man, it's game over")
    ) {
      return true;
    }

    // Ignore generic entity death log wrappers such as:
    // "Villager ... died, message: 'Nitwit was slain by Player'"
    if (payload.includes(" died, message: '")) {
      return false;
    }

    return HARDCORE_DEATH_MARKERS.some((marker) => payload.includes(marker));
  }

  queueHardcoreReset(triggerLine) {
    if (this.pendingHardcoreReset || !this.getBackupPolicy().wipeOnDeath) {
      return;
    }

    this.pendingHardcoreReset = {
      profileId: this.currentProfile.id,
      profileDir: this.profileDir,
      triggerLine: String(triggerLine || "").trim(),
    };
    this.emit(
      "log",
      "Hardcore death detected. LMCD will delete this world and all backups after shutdown.",
    );

    this.stop().catch((error) => {
      this.emit(
        "log",
        `Hardcore cleanup could not stop the server cleanly: ${error.message || String(error)}`,
      );
    });
  }

  applyPendingHardcoreReset() {
    if (!this.pendingHardcoreReset) {
      return false;
    }

    const pending = this.pendingHardcoreReset;
    this.pendingHardcoreReset = null;
    this.deleteWorldData(pending.profileDir || this.profileDir);
    this.deleteBackups(pending.profileId || this.profileName);
    this.resetProfileState(pending.profileDir || this.profileDir);
    this.emit("log", "Hardcore cleanup finished. The world and all backups were deleted.");
    return true;
  }

  updatePresenceFromLogLine(line) {
    const rawLine = String(line || "").trim();
    if (!rawLine) {
      return;
    }

    const payload = rawLine.includes("]: ") ? rawLine.split("]: ").pop() || rawLine : rawLine;
    const playerCountMatch = payload.match(PLAYER_COUNT_LOG_PATTERN);
    if (playerCountMatch) {
      this.updateIdlePresenceState(Number(playerCountMatch[1] || 0));
      return;
    }

    if (payload.includes(" joined the game")) {
      this.updateIdlePresenceState(Math.max(1, this.lastKnownOnlinePlayers));
      return;
    }

    if (payload.includes(" left the game")) {
      this.updateIdlePresenceState(Math.max(0, this.lastKnownOnlinePlayers - 1));
    }
  }

  handleServerOutput(chunk) {
    this.logBuffer += String(chunk || "");
    const lines = this.logBuffer.split(/\r?\n/);
    this.logBuffer = lines.pop() || "";

    for (const line of lines) {
      const normalized = line.replace(/\r$/, "");
      if (!normalized) {
        continue;
      }
      this.emit("log", normalized);
      this.updatePresenceFromLogLine(normalized);
      if (this.shouldWipeHardcoreWorldFromLog(normalized)) {
        this.queueHardcoreReset(normalized);
      }
    }
  }

  flushLogBuffer() {
    const pending = this.logBuffer.replace(/\r$/, "").trim();
    this.logBuffer = "";
    if (!pending) {
      this.flushLogBatch();
      return;
    }
    this.emit("log", pending);
    this.updatePresenceFromLogLine(pending);
    if (this.shouldWipeHardcoreWorldFromLog(pending)) {
      this.queueHardcoreReset(pending);
    }
    this.flushLogBatch();
  }

  syncWorldLockState() {
    if (this.isRemoteProfile(this.currentProfile)) {
      return;
    }
    if (this.currentProfile && this.hasWorldData() && !this.currentProfile.rulesLocked) {
      const next = this.persistCurrentProfile({ rulesLocked: true });
      this.emit("status", {
        profile: next.id,
        version: next.version,
        serverSoftware: next.serverSoftware,
        modePreset: next.modePreset,
        cheatLock: next.cheatLock,
        rulesLocked: next.rulesLocked,
        minMem: next.minMem,
        maxMem: next.maxMem,
        port: next.port,
        idleShutdownMinutes: next.idleShutdownMinutes,
      });
    }
  }

  setProfile(profile) {
    const resolved = this.resolveProfileInput(profile);
    if (this.currentProfile.id !== resolved.id) {
      this.disconnectRemote().catch(() => {
        // Ignore remote disconnect failures while switching profile context.
      });
    }
    this.currentProfile = resolved;
    this.profileName = resolved.id || "default";
    this.currentVersion = resolved.version || DEFAULT_MC_VERSION;
    this.currentSoftware = resolved.serverSoftware || DEFAULT_SERVER_SOFTWARE;
    this.profileDir = path.join(this.baseRoot, "profiles", this.profileName);
    this.baseDir = this.profileDir;
    this.jarPath = this.getJarPath(this.currentVersion, this.currentSoftware);
    this.ensureBaseDir();
    this.clearAddonMetadataCache();
    this.syncWorldLockState();

    const active = this.getActiveProfile();
    this.emit("status", {
      profile: active.id,
      version: active.version,
      serverSoftware: active.serverSoftware,
      modePreset: active.modePreset,
      cheatLock: active.cheatLock,
      rulesLocked: active.rulesLocked,
      minMem: active.minMem,
      maxMem: active.maxMem,
      port: active.port,
      idleShutdownMinutes: active.idleShutdownMinutes,
      profileType: active.profileType,
      host: active.host,
      rconPort: active.rconPort,
      publicHost: active.publicHost,
    });
  }

  async deleteProfile(profileId) {
    if (!profileId) {
      throw new Error("Profile id is required");
    }
    if (this.serverProcess && this.profileName === profileId) {
      throw new Error("Stop the server before deleting it.");
    }
    if (this.currentProfile.id === profileId) {
      await this.disconnectRemote();
    }
    const targetProfile = readProfiles().find((profile) => profile.id === profileId);
    if (targetProfile && targetProfile.rconPasswordRef) {
      await this.clearRemotePassword(targetProfile);
    }
    const profileDir = path.join(this.baseRoot, "profiles", profileId);
    if (fs.existsSync(profileDir)) {
      fs.rmSync(profileDir, { recursive: true, force: true });
    }
    this.deleteBackups(profileId);
    this.clearAddonMetadataCache();
    return { deleted: true, id: profileId };
  }

  listAddons(software = this.currentSoftware || DEFAULT_SERVER_SOFTWARE) {
    if (this.isRemoteProfile()) {
      return {
        supported: false,
        kind: "none",
        label: "Remote runtime add-ons unavailable",
        helperText: "Remote profiles use RCON-only mode in this release. Use local profiles for add-on management.",
        folderPath: null,
        runtime: software,
        items: [],
        compatibility: {
          ready: true,
          summary: "Remote profiles do not manage local mod/plugin files.",
          findings: [],
        },
      };
    }

    const context = this.getAddonContext(software);
    const folderPath = this.getAddonDir(software);
    if (!context.supported || !folderPath) {
      const detectedItems = [];
      const legacyFolders = [
        { folderName: "mods", label: "mods" },
        { folderName: "plugins", label: "plugins" },
      ];

      for (const folder of legacyFolders) {
        const scanDir = path.join(this.profileDir, folder.folderName);
        if (!fs.existsSync(scanDir)) {
          continue;
        }
        const entries = fs
          .readdirSync(scanDir, { withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".jar"));
        for (const entry of entries) {
          const filePath = path.join(scanDir, entry.name);
          const stats = fs.statSync(filePath);
          detectedItems.push({
            name: entry.name,
            displayName: entry.name,
            version: "unknown",
            description: `Detected in ${folder.label} folder. Switch runtime to Fabric/Paper to load this jar.`,
            valid: true,
            sizeBytes: stats.size,
            updatedAt: stats.mtimeMs,
            projectId: "",
            installedVersionId: "",
            installedVersionNumber: "",
            updateAvailable: false,
          });
        }
      }

      detectedItems.sort((left, right) => right.updatedAt - left.updatedAt);
      const detectedKind = detectedItems.length > 0 ? "mods" : context.kind;
      const detectedSummary =
        detectedItems.length > 0
          ? `${context.helperText} Detected ${detectedItems.length} add-on jar(s) in this profile.`
          : context.helperText;
      return {
        supported: false,
        kind: detectedKind,
        label: context.label,
        helperText: detectedSummary,
        folderPath: null,
        runtime: context.runtime,
        items: detectedItems,
        compatibility: {
          ready: detectedItems.length === 0,
          summary: detectedSummary,
          findings: [],
        },
      };
    }

    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }
    const manifest = this.readAddonManifest();
    const entries = manifest.entries || {};
    const metadataByName = new Map();

    const items = fs
      .readdirSync(folderPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".jar"))
      .map((entry) => {
        const filePath = path.join(folderPath, entry.name);
        const stats = fs.statSync(filePath);
        const metadata = this.getAddonMetadataCached(filePath, software, stats);
        metadataByName.set(entry.name, metadata);
        const metadataSummary =
          metadata && metadata.valid
            ? String(metadata.description || "").trim()
            : String((metadata && metadata.errors && metadata.errors[0]) || "").trim();
        const catalog = entries[entry.name] || {};

        return {
          name: entry.name,
          displayName:
            metadata && metadata.valid
              ? String(metadata.name || entry.name)
              : entry.name,
          version:
            metadata && metadata.valid
              ? String(metadata.version || "unknown")
              : "unknown",
          description: metadataSummary || "No metadata description available.",
          valid: Boolean(metadata && metadata.valid),
          sizeBytes: stats.size,
          updatedAt: stats.mtimeMs,
          projectId: catalog.projectId || "",
          installedVersionId: catalog.installedVersionId || "",
          installedVersionNumber: catalog.installedVersionNumber || "",
          updateAvailable: false,
        };
      })
      .sort((left, right) => right.updatedAt - left.updatedAt);

    const alternateFolderName = context.kind === "mods" ? "plugins" : "mods";
    const alternateFolderPath = path.join(this.profileDir, alternateFolderName);
    const alternateItems = [];
    if (fs.existsSync(alternateFolderPath)) {
      const altEntries = fs
        .readdirSync(alternateFolderPath, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".jar"));
      for (const entry of altEntries) {
        const filePath = path.join(alternateFolderPath, entry.name);
        const stats = fs.statSync(filePath);
        alternateItems.push({
          name: entry.name,
          displayName: entry.name,
          version: "unknown",
          description: `Detected in ${alternateFolderName}/ while current runtime expects ${context.kind}/.`,
          valid: true,
          sizeBytes: stats.size,
          updatedAt: stats.mtimeMs,
          projectId: "",
          installedVersionId: "",
          installedVersionNumber: "",
          updateAvailable: false,
        });
      }
    }

    const combinedItems = [...items, ...alternateItems].sort((left, right) => right.updatedAt - left.updatedAt);
    const helperText =
      alternateItems.length > 0
        ? `${context.helperText} Also detected ${alternateItems.length} jar(s) in ${alternateFolderName}/.`
        : context.helperText;

    return {
      supported: true,
      kind: context.kind,
      label: context.label,
      helperText,
      folderPath,
      runtime: context.runtime,
      items: combinedItems,
      compatibility: this.buildCompatibilityReport(items, software, metadataByName),
    };
  }

  importAddons(filePaths, software = this.currentSoftware || DEFAULT_SERVER_SOFTWARE) {
    const context = this.getAddonContext(software);
    const folderPath = this.getAddonDir(software);
    if (!context.supported || !folderPath) {
      throw new Error(context.helperText);
    }
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      return this.listAddons(software);
    }

    if (this.hasMeaningfulProfileContent()) {
      this.createBackup(`before-${context.kind}-change`);
    }
    fs.mkdirSync(folderPath, { recursive: true });
    for (const sourcePath of filePaths) {
      if (!sourcePath || !fs.existsSync(sourcePath)) {
        continue;
      }
      const fileName = path.basename(sourcePath);
      if (!fileName.toLowerCase().endsWith(".jar")) {
        continue;
      }
      fs.copyFileSync(sourcePath, path.join(folderPath, fileName));
      this.clearAddonCatalogMetadata(fileName);
    }
    this.clearAddonMetadataCache();

    return this.listAddons(software);
  }

  removeAddon(fileName, software = this.currentSoftware || DEFAULT_SERVER_SOFTWARE) {
    const context = this.getAddonContext(software);
    const folderPath = this.getAddonDir(software);
    if (!context.supported || !folderPath) {
      throw new Error(context.helperText);
    }

    const safeName = path.basename(String(fileName || "").trim());
    if (!safeName || safeName !== fileName) {
      throw new Error("Addon file name is invalid.");
    }

    const filePath = path.join(folderPath, safeName);
    if (fs.existsSync(filePath)) {
      if (this.hasMeaningfulProfileContent()) {
        this.createBackup(`before-${context.kind}-change`);
      }
      fs.rmSync(filePath, { force: true });
      this.clearAddonCatalogMetadata(safeName);
    }
    this.clearAddonMetadataCache();
    return this.listAddons(software);
  }

  verifyJava() {
    const check = spawnSync("java", ["-version"], { stdio: "ignore" });
    return check.status === 0;
  }

  normalizeVersionList(list) {
    return [...new Set(list.filter((version) => RELEASE_VERSION_PATTERN.test(String(version))))]
      .sort(compareVersionsDesc);
  }

  async ensureJar(
    version = this.currentVersion,
    software = this.currentSoftware || DEFAULT_SERVER_SOFTWARE,
  ) {
    this.currentVersion = version || this.currentVersion || DEFAULT_MC_VERSION;
    this.currentSoftware = software || this.currentSoftware || DEFAULT_SERVER_SOFTWARE;
    this.jarPath = this.getJarPath(this.currentVersion, this.currentSoftware);
    this.ensureBaseDir();
    if (fs.existsSync(this.jarPath)) {
      return {
        downloaded: false,
        path: this.jarPath,
        version: this.currentVersion,
        serverSoftware: this.currentSoftware,
      };
    }
    await this.downloadServerJar(this.currentVersion, this.currentSoftware, this.jarPath);
    return {
      downloaded: true,
      path: this.jarPath,
      version: this.currentVersion,
      serverSoftware: this.currentSoftware,
    };
  }

  async listVanillaVersions() {
    const manifestUrl = "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";
    const manifest = await this.fetchJson(manifestUrl);
    return this.normalizeVersionList(
      (manifest.versions || [])
        .filter((item) => item.type === "release" && item.id)
        .map((item) => item.id),
    );
  }

  async listPaperVersions() {
    const manifest = await this.fetchJson("https://fill.papermc.io/v3/projects/paper");
    return this.normalizeVersionList(Object.values(manifest.versions || {}).flat());
  }

  async listFabricVersions() {
    const versions = await this.fetchJson("https://meta.fabricmc.net/v2/versions/game");
    return this.normalizeVersionList(
      (versions || [])
        .filter((item) => item && item.stable && item.version)
        .map((item) => item.version),
    );
  }

  async listAvailableVersions(software = this.currentSoftware || DEFAULT_SERVER_SOFTWARE) {
    if (software === "paper") {
      return this.listPaperVersions();
    }
    if (software === "fabric") {
      return this.listFabricVersions();
    }
    return this.listVanillaVersions();
  }

  async downloadServerJar(version, software, jarPath) {
    this.emit("status", { downloading: true, version, serverSoftware: software });
    try {
      if (software === "paper") {
        await this.downloadPaperJar(version, jarPath);
        return;
      }
      if (software === "fabric") {
        await this.downloadFabricJar(version, jarPath);
        return;
      }
      await this.downloadVanillaJar(version, jarPath);
    } finally {
      this.emit("status", { downloading: false, version, serverSoftware: software });
    }
  }

  async downloadVanillaJar(version, jarPath = this.getJarPath(version, "vanilla")) {
    const manifestUrl = "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";
    const manifest = await this.fetchJson(manifestUrl);
    const versionMeta = (manifest.versions || []).find((item) => item.id === version);
    if (!versionMeta) {
      throw new Error(`Vanilla does not support version ${version}.`);
    }
    const versionDetail = await this.fetchJson(versionMeta.url);
    const serverDownload = versionDetail.downloads && versionDetail.downloads.server;
    if (!serverDownload || !serverDownload.url) {
      throw new Error("Server jar url missing from the Mojang version manifest.");
    }
    await this.downloadFile(serverDownload.url, jarPath);
  }

  async downloadPaperJar(version, jarPath = this.getJarPath(version, "paper")) {
    const builds = await this.fetchJson(
      `https://fill.papermc.io/v3/projects/paper/versions/${encodeURIComponent(version)}/builds`,
    );
    const selectedBuild =
      (builds || []).find(
        (item) => item.channel === "STABLE" && item.downloads && item.downloads["server:default"],
      ) ||
      (builds || []).find((item) => item.downloads && item.downloads["server:default"]);
    const download = selectedBuild && selectedBuild.downloads["server:default"];
    if (!download || !download.url) {
      throw new Error(`Paper does not have a stable server build for version ${version}.`);
    }
    await this.downloadFile(download.url, jarPath);
  }

  async downloadFabricJar(version, jarPath = this.getJarPath(version, "fabric")) {
    const loaders = await this.fetchJson(
      `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(version)}`,
    );
    const installerVersions = await this.fetchJson("https://meta.fabricmc.net/v2/versions/installer");

    const selectedLoader =
      (loaders || []).find(
        (item) =>
          item.loader &&
          item.loader.stable &&
          item.launcherMeta &&
          item.launcherMeta.mainClass &&
          item.launcherMeta.mainClass.server,
      ) ||
      (loaders || []).find(
        (item) =>
          item.loader &&
          item.launcherMeta &&
          item.launcherMeta.mainClass &&
          item.launcherMeta.mainClass.server,
      ) ||
      (loaders || [])[0];
    if (!selectedLoader || !selectedLoader.loader || !selectedLoader.loader.version) {
      throw new Error(`Fabric does not support version ${version}.`);
    }

    const selectedInstaller =
      (installerVersions || []).find((item) => item.stable && item.version) ||
      (installerVersions || []).find((item) => item.version);
    if (!selectedInstaller || !selectedInstaller.version) {
      throw new Error("Could not resolve a Fabric installer version.");
    }

    const downloadUrl = `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(
      version,
    )}/${encodeURIComponent(selectedLoader.loader.version)}/${encodeURIComponent(
      selectedInstaller.version,
    )}/server/jar`;
    await this.downloadFile(downloadUrl, jarPath);
  }

  fetchJson(url, redirects = 0) {
    if (redirects > 5) {
      return Promise.reject(new Error(`Too many redirects while fetching ${url}`));
    }
    return new Promise((resolve, reject) => {
      https
        .get(url, { headers: HTTP_HEADERS }, (res) => {
          const statusCode = res.statusCode || 0;
          if (HTTP_REDIRECT_CODES.has(statusCode) && res.headers.location) {
            const nextUrl = new URL(res.headers.location, url).toString();
            res.resume();
            resolve(this.fetchJson(nextUrl, redirects + 1));
            return;
          }
          if (statusCode !== 200) {
            res.resume();
            reject(new Error(`Request failed for ${url}: ${statusCode}`));
            return;
          }

          let data = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            try {
              resolve(JSON.parse(data));
            } catch (err) {
              reject(err);
            }
          });
        })
        .on("error", reject);
    });
  }

  downloadFile(url, dest, redirects = 0) {
    if (redirects > 5) {
      return Promise.reject(new Error(`Too many redirects while downloading ${url}`));
    }

    return new Promise((resolve, reject) => {
      https
        .get(url, { headers: HTTP_HEADERS }, (res) => {
          const statusCode = res.statusCode || 0;
          if (HTTP_REDIRECT_CODES.has(statusCode) && res.headers.location) {
            const nextUrl = new URL(res.headers.location, url).toString();
            res.resume();
            resolve(this.downloadFile(nextUrl, dest, redirects + 1));
            return;
          }
          if (statusCode !== 200) {
            res.resume();
            reject(new Error(`Download failed: ${statusCode}`));
            return;
          }

          fs.mkdirSync(path.dirname(dest), { recursive: true });
          const file = fs.createWriteStream(dest);
          const total = Number(res.headers["content-length"] || 0);
          let received = 0;
          let settled = false;

          const fail = (err) => {
            if (settled) return;
            settled = true;
            file.destroy();
            fs.rm(dest, { force: true }, () => reject(err));
          };

          res.on("data", (chunk) => {
            received += chunk.length;
            this.emit("download-progress", {
              received,
              total,
              percent: total ? Math.round((received / total) * 100) : null,
            });
          });
          res.on("error", fail);
          file.on("error", fail);
          file.on("finish", () => {
            if (settled) return;
            settled = true;
            file.close(resolve);
          });

          res.pipe(file);
        })
        .on("error", reject);
    });
  }

  getCatalogLoaders(runtime = this.currentSoftware || DEFAULT_SERVER_SOFTWARE) {
    if (runtime === "fabric") {
      return ["fabric"];
    }
    if (runtime === "paper") {
      return PAPER_LOADERS;
    }
    return [];
  }

  getCatalogFacets(runtime = this.currentSoftware || DEFAULT_SERVER_SOFTWARE) {
    if (runtime === "fabric") {
      return [
        ["project_type:mod"],
        ["categories:fabric"],
        [`versions:${this.currentVersion}`],
        ["server_side:required", "server_side:optional"],
      ];
    }
    if (runtime === "paper") {
      return [
        ["project_type:plugin", "project_type:mod"],
        [`versions:${this.currentVersion}`],
        [
          "categories:paper",
          "categories:purpur",
          "categories:folia",
          "categories:spigot",
          "categories:bukkit",
        ],
        ["server_side:required", "server_side:optional"],
      ];
    }
    return [];
  }

  async searchAddonCatalog(
    query,
    runtime = this.currentSoftware || DEFAULT_SERVER_SOFTWARE,
    options = {},
  ) {
    const context = this.getAddonContext(runtime);
    if (!context.supported) {
      return [];
    }

    const searchQuery = String(query || "").trim();
    if (!searchQuery) {
      return [];
    }

    const safeSort = CATALOG_SORT_INDEX.has(options.sort) ? options.sort : "relevance";
    const limit = Math.min(24, Math.max(1, Number(options.limit) || 12));
    const searchUrl = `${MODRINTH_API_BASE}/search?query=${encodeURIComponent(
      searchQuery,
    )}&limit=${limit}&index=${safeSort}&facets=${encodeURIComponent(
      JSON.stringify(this.getCatalogFacets(runtime)),
    )}`;
    const results = await this.fetchJson(searchUrl);
    return (results.hits || []).map((hit) => ({
      projectId: hit.project_id,
      slug: hit.slug,
      title: hit.title,
      author: hit.author,
      description: hit.description,
      downloads: hit.downloads,
      follows: Number(hit.follows || hit.followers || 0),
      iconUrl: hit.icon_url || null,
      categories: hit.categories || [],
      gallery: Array.isArray(hit.gallery) ? hit.gallery : [],
      featuredGallery:
        (Array.isArray(hit.gallery) && hit.gallery[0] && hit.gallery[0].url) ||
        hit.featured_gallery ||
        hit.icon_url ||
        null,
      dateModified: hit.date_modified || hit.date_created || null,
      projectType: hit.project_type || context.kind.slice(0, -1),
    }));
  }

  async getCatalogProject(projectId) {
    const safeProjectId = String(projectId || "").trim();
    if (!safeProjectId) {
      throw new Error("Project id is required.");
    }
    const detail = await this.fetchJson(`${MODRINTH_API_BASE}/project/${encodeURIComponent(safeProjectId)}`);
    return {
      projectId: String(detail.id || safeProjectId),
      slug: String(detail.slug || ""),
      title: String(detail.title || ""),
      author: String(detail.team || detail.organization || "Unknown"),
      description: String(detail.description || ""),
      body: String(detail.body || ""),
      downloads: Number(detail.downloads || 0),
      follows: Number(detail.followers || detail.follows || 0),
      iconUrl: detail.icon_url || null,
      categories: Array.isArray(detail.categories) ? detail.categories : [],
      gallery: Array.isArray(detail.gallery) ? detail.gallery : [],
      featuredGallery:
        (Array.isArray(detail.gallery) && detail.gallery[0] && detail.gallery[0].url) || detail.icon_url || null,
      dateModified: detail.updated || detail.published || null,
      projectType: detail.project_type || "mod",
      clientSide: detail.client_side || "unknown",
      serverSide: detail.server_side || "unknown",
    };
  }

  async resolveCatalogVersion(projectId, runtime = this.currentSoftware || DEFAULT_SERVER_SOFTWARE) {
    const loaders = this.getCatalogLoaders(runtime);
    if (loaders.length === 0) {
      return null;
    }
    const versionsUrl = `${MODRINTH_API_BASE}/project/${encodeURIComponent(
      projectId,
    )}/version?loaders=${encodeURIComponent(JSON.stringify(loaders))}&game_versions=${encodeURIComponent(
      JSON.stringify([this.currentVersion]),
    )}`;
    const versions = await this.fetchJson(versionsUrl);
    return (
      (versions || []).find((version) => version.version_type === "release") ||
      (versions || [])[0] ||
      null
    );
  }

  async installCatalogAddon(projectId, runtime = this.currentSoftware || DEFAULT_SERVER_SOFTWARE) {
    const context = this.getAddonContext(runtime);
    const folderPath = this.getAddonDir(runtime);
    if (!context.supported || !folderPath) {
      throw new Error(context.helperText);
    }
    if (!projectId) {
      throw new Error("Project id is required.");
    }

    const selectedVersion = await this.resolveCatalogVersion(projectId, runtime);
    if (!selectedVersion) {
      throw new Error(`No compatible ${context.kind.slice(0, -1)} version found for ${this.currentVersion}.`);
    }

    const file =
      (selectedVersion.files || []).find((entry) => entry.primary && entry.filename.endsWith(".jar")) ||
      (selectedVersion.files || []).find((entry) => entry.filename && entry.filename.endsWith(".jar"));
    if (!file || !file.url || !file.filename) {
      throw new Error("Compatible add-on version found, but no installable jar file was available.");
    }

    if (this.hasMeaningfulProfileContent()) {
      this.createBackup(`before-${context.kind}-install`);
    }
    await this.downloadFile(file.url, path.join(folderPath, file.filename));
    this.setAddonCatalogMetadata(file.filename, {
      projectId,
      installedVersionId: selectedVersion.id,
      installedVersionNumber: selectedVersion.version_number,
    });
    this.clearAddonMetadataCache();
    return this.listAddons(runtime);
  }

  async checkAddonUpdates(runtime = this.currentSoftware || DEFAULT_SERVER_SOFTWARE) {
    const state = this.listAddons(runtime);
    if (!state.supported || !Array.isArray(state.items) || state.items.length === 0) {
      return state;
    }

    const projects = [...new Set(state.items.map((item) => item.projectId).filter(Boolean))];
    if (projects.length === 0) {
      return state;
    }

    const latestByProject = new Map();
    await Promise.all(
      projects.map(async (projectId) => {
        try {
          const latest = await this.resolveCatalogVersion(projectId, runtime);
          latestByProject.set(projectId, latest ? latest.id : "");
        } catch {
          latestByProject.set(projectId, "");
        }
      }),
    );

    return {
      ...state,
      items: state.items.map((item) => {
        if (!item.projectId) {
          return item;
        }
        const latestVersionId = latestByProject.get(item.projectId) || "";
        if (!latestVersionId || !item.installedVersionId) {
          return item;
        }
        return {
          ...item,
          updateAvailable: latestVersionId !== item.installedVersionId,
        };
      }),
    };
  }

  async writeDefaultProperties(overrides = {}) {
    const merged = this.enforcePolicyProperties(
      {
        ...this.getDefaultProperties(),
        ...this.normalizePropertyMap(overrides),
      },
      overrides,
    );
    fs.writeFileSync(this.paths.properties, stringifyProperties(merged));
    return merged;
  }

  async readProperties() {
    const profile = this.getActiveProfile();
    if (this.isRemoteProfile(profile)) {
      return {
        motd: profile.motd || DEFAULT_MOTD,
        "server-port": String(profile.port || 25565),
        "server-ip": "",
        "max-players": "0",
        "view-distance": "0",
        "simulation-distance": "0",
        "white-list": "false",
        "enforce-whitelist": "false",
        "online-mode": "true",
      };
    }

    if (!fs.existsSync(this.paths.properties)) {
      return this.writeDefaultProperties();
    }

    const raw = fs.readFileSync(this.paths.properties, "utf-8");
    const parsed = parseProperties(raw);
    const merged = this.enforcePolicyProperties({
      ...this.getDefaultProperties(),
      ...parsed,
    });

    if (propertiesDiffer(parsed, merged)) {
      fs.writeFileSync(this.paths.properties, stringifyProperties(merged));
    }

    return merged;
  }

  async writeProperties(updates) {
    const profile = this.getActiveProfile();
    if (this.isRemoteProfile(profile)) {
      const normalizedUpdates = this.normalizePropertyMap(updates);
      const nextMotd = String(normalizedUpdates.motd || profile.motd || DEFAULT_MOTD).trim();
      const nextPort =
        Number.parseInt(String(normalizedUpdates["server-port"] || profile.port || 25565), 10) || 25565;
      const persisted = this.persistCurrentProfile({
        motd: nextMotd || DEFAULT_MOTD,
        port: Math.min(65535, Math.max(1, nextPort)),
      });
      return {
        motd: persisted.motd || DEFAULT_MOTD,
        "server-port": String(persisted.port || 25565),
        "server-ip": "",
      };
    }

    const props = await this.readProperties();
    const normalizedUpdates = this.normalizePropertyMap(updates);
    const merged = this.enforcePolicyProperties(
      {
        ...props,
        ...normalizedUpdates,
      },
      normalizedUpdates,
    );

    fs.writeFileSync(this.paths.properties, stringifyProperties(merged));

    if (merged.motd && merged.motd !== profile.motd) {
      this.persistCurrentProfile({ motd: merged.motd });
    }

    return merged;
  }

  async acceptEula() {
    fs.writeFileSync(this.paths.eula, "eula=true\n");
  }

  async start(options = {}) {
    if (this.isRemoteProfile()) {
      return this.remoteStart(this.profileName);
    }

    if (!this.verifyJava()) {
      throw new Error("Java runtime not found in PATH. Install Java 17+ and retry.");
    }
    if (this.serverProcess) {
      throw new Error("Server already running");
    }

    this.currentVersion = options.version || this.currentVersion || DEFAULT_MC_VERSION;
    this.currentSoftware =
      options.serverSoftware || this.currentSoftware || DEFAULT_SERVER_SOFTWARE;
    const minMem = Math.max(1024, Number(options.minMem || this.currentProfile.minMem || 2048));
    const maxMem = Math.max(minMem, Number(options.maxMem || this.currentProfile.maxMem || 4096));
    const port = Math.min(
      65535,
      Math.max(1024, Number(options.port || this.currentProfile.port || 25565)),
    );
    const idleShutdownMinutes = this.normalizeIdleShutdownMinutes(
      options.idleShutdownMinutes ?? this.currentProfile.idleShutdownMinutes,
    );
    this.jarPath = this.getJarPath(this.currentVersion, this.currentSoftware);
    this.ensureBaseDir();
    this.persistCurrentProfile({
      version: this.currentVersion,
      serverSoftware: this.currentSoftware,
      motd: options.motd || this.currentProfile.motd || DEFAULT_MOTD,
      minMem,
      maxMem,
      port,
      idleShutdownMinutes,
    });

    this.registerServerStart();

    await this.ensureJar(this.currentVersion, this.currentSoftware);
    await this.acceptEula();

    const props = await this.writeProperties({
      "server-port": String(port),
      motd: options.motd || this.currentProfile.motd || DEFAULT_MOTD,
      "max-players": String(options.maxPlayers || 8),
      "view-distance": String(options.viewDistance || 20),
      "simulation-distance": String(options.simulationDistance || 10),
    });

    const javaArgs = [`-Xms${minMem}M`, `-Xmx${maxMem}M`, "-jar", this.jarPath, "nogui"];

    this.serverProcess = spawn("java", javaArgs, {
      cwd: this.profileDir,
      env: { ...process.env },
    });
    this.startedAt = Date.now();
    this.startAutoBackupLoop();
    this.startIdleShutdownLoop(idleShutdownMinutes);

    const lockedProfile = this.persistCurrentProfile({
      rulesLocked: true,
      version: this.currentVersion,
      serverSoftware: this.currentSoftware,
      motd: props.motd || this.currentProfile.motd || DEFAULT_MOTD,
      minMem,
      maxMem,
      port: Number(props["server-port"] || port),
      idleShutdownMinutes,
    });

    this.serverProcess.stdout.on("data", (data) => {
      this.handleServerOutput(data);
    });
    this.serverProcess.stderr.on("data", (data) => {
      this.handleServerOutput(data);
    });
    this.serverProcess.on("close", (code) => {
      this.flushLogBuffer();
      this.emit("log", `Server exited with code ${code}`);
      this.stopAutoBackupLoop();
      this.stopIdleShutdownLoop();
      this.autoBackupInProgress = false;
      this.serverProcess = null;
      this.applyPendingHardcoreReset();
      this.emit("status", {
        running: false,
        profile: lockedProfile.id,
        version: lockedProfile.version,
        serverSoftware: lockedProfile.serverSoftware,
        modePreset: lockedProfile.modePreset,
        cheatLock: lockedProfile.cheatLock,
        rulesLocked: lockedProfile.rulesLocked,
        minMem: lockedProfile.minMem,
        maxMem: lockedProfile.maxMem,
        port: lockedProfile.port,
        idleShutdownMinutes: lockedProfile.idleShutdownMinutes,
      });
    });

    this.emit("status", {
      running: true,
      version: this.currentVersion,
      serverSoftware: this.currentSoftware,
      path: this.profileDir,
      port: Number(props["server-port"] || 25565),
      profile: lockedProfile.id,
      modePreset: lockedProfile.modePreset,
      cheatLock: lockedProfile.cheatLock,
      rulesLocked: lockedProfile.rulesLocked,
      minMem: lockedProfile.minMem,
      maxMem: lockedProfile.maxMem,
      port: lockedProfile.port,
      idleShutdownMinutes: lockedProfile.idleShutdownMinutes,
    });

    return {
      running: true,
      path: this.profileDir,
      version: this.currentVersion,
      serverSoftware: this.currentSoftware,
      profile: lockedProfile.id,
      modePreset: lockedProfile.modePreset,
      cheatLock: lockedProfile.cheatLock,
      rulesLocked: lockedProfile.rulesLocked,
      minMem: lockedProfile.minMem,
      maxMem: lockedProfile.maxMem,
      port: lockedProfile.port,
      idleShutdownMinutes: lockedProfile.idleShutdownMinutes,
    };
  }

  async stop() {
    if (this.isRemoteProfile()) {
      return this.remoteStop(this.profileName);
    }
    if (!this.serverProcess) {
      return { running: false };
    }
    this.stopAutoBackupLoop();
    this.stopIdleShutdownLoop();
    this.serverProcess.stdin.write("stop\n");
    const proc = this.serverProcess;
    return new Promise((resolve) => {
      const forceKill = () => {
        if (proc.exitCode !== null) return;
        if (process.platform === "win32") {
          spawnSync("taskkill", ["/pid", String(proc.pid), "/t", "/f"], { stdio: "ignore" });
          return;
        }
        proc.kill("SIGTERM");
      };
      const timer = setTimeout(forceKill, 6000);
      proc.once("close", () => {
        clearTimeout(timer);
        this.emit("status", {
          running: false,
          profile: this.currentProfile.id,
          version: this.currentProfile.version,
          serverSoftware: this.currentProfile.serverSoftware,
          modePreset: this.currentProfile.modePreset,
          cheatLock: this.currentProfile.cheatLock,
          rulesLocked: this.currentProfile.rulesLocked,
          minMem: this.currentProfile.minMem,
          maxMem: this.currentProfile.maxMem,
          port: this.currentProfile.port,
          idleShutdownMinutes: this.currentProfile.idleShutdownMinutes,
        });
        resolve();
      });
    });
  }

  isCommandAllowed(cmd) {
    const root = String(cmd || "")
      .trim()
      .split(/\s+/)[0]
      .toLowerCase();
    return SAFE_CONSOLE_COMMANDS.has(root);
  }

  async sendCommand(cmd) {
    const profile = this.getActiveProfile();
    if (profile.cheatLock && !this.isCommandAllowed(cmd)) {
      throw new Error(`Cheat guard is on. Only safe admin commands are allowed from ${APP_NAME}.`);
    }

    if (this.isRemoteProfile(profile)) {
      await this.remoteCommand(cmd, profile.id);
      return;
    }

    if (!this.serverProcess) throw new Error("Server is not running");
    this.serverProcess.stdin.write(`${cmd}\n`);
  }

  async getStats() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const systemUsage = {
      totalMB: Math.round(totalMem / 1024 / 1024),
      freeMB: Math.round(freeMem / 1024 / 1024),
      usedMB: Math.round(usedMem / 1024 / 1024),
      usagePct: Number(((usedMem / totalMem) * 100).toFixed(1)),
    };
    const profile = this.getActiveProfile();

    if (this.isRemoteProfile(profile)) {
      return {
        running: Boolean(this.remoteConnected),
        cpu: 0,
        memoryMB: 0,
        uptime: this.startedAt ? Math.round((Date.now() - this.startedAt) / 1000) : 0,
        system: systemUsage,
        remote: true,
        configuredMinMB: profile.minMem,
        configuredMaxMB: profile.maxMem,
      };
    }

    if (this.serverProcess) {
      const usage = await pidusage(this.serverProcess.pid);
      return {
        running: true,
        cpu: Number(usage.cpu.toFixed(1)),
        memoryMB: Math.round(usage.memory / 1024 / 1024),
        uptime: Math.round((Date.now() - this.startedAt) / 1000),
        system: systemUsage,
        remote: false,
        configuredMinMB: profile.minMem,
        configuredMaxMB: profile.maxMem,
      };
    }
    return {
      running: false,
      cpu: 0,
      memoryMB: 0,
      uptime: 0,
      system: systemUsage,
      remote: false,
      configuredMinMB: profile.minMem,
      configuredMaxMB: profile.maxMem,
    };
  }
}

module.exports = ServerManager;
