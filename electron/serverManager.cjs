const fs = require("fs");
const path = require("path");
const https = require("https");
const { spawn, spawnSync } = require("child_process");
const EventEmitter = require("events");
const os = require("os");
const pidusage = require("pidusage");
const AdmZip = require("adm-zip");
const yaml = require("js-yaml");
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
  "view-distance": "12",
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
const BACKUP_SKIP_NAMES = new Set(["cache", "libraries", "logs", "versions"]);

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
    this.ensureBaseDir();
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

  getBackupsDir(profileId = this.profileName) {
    return path.join(this.baseRoot, "backups", profileId);
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

  listBackups(profileId = this.profileName) {
    const backupRoot = this.getBackupsDir(profileId);
    if (!fs.existsSync(backupRoot)) {
      return [];
    }

    return fs
      .readdirSync(backupRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const metadataPath = path.join(backupRoot, entry.name, "metadata.json");
        const metadata = safeJsonParse(
          fs.existsSync(metadataPath) ? fs.readFileSync(metadataPath, "utf8") : "{}",
        );
        return {
          id: entry.name,
          createdAt: Number(metadata && metadata.createdAt) || 0,
          reason: (metadata && metadata.reason) || "manual",
          sizeBytes:
            Number(metadata && metadata.sizeBytes) ||
            this.getDirectorySize(path.join(backupRoot, entry.name, "data")),
        };
      })
      .sort((left, right) => right.createdAt - left.createdAt);
  }

  createBackup(reason = "manual") {
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
    const backupId = `${createdAt}-${String(reason || "manual")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "backup"}`;
    const backupDir = path.join(backupRoot, backupId);
    const backupDataDir = path.join(backupDir, "data");

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
      sizeBytes: this.getDirectorySize(backupDataDir),
    };
    fs.writeFileSync(path.join(backupDir, "metadata.json"), JSON.stringify(backupEntry, null, 2));
    return backupEntry;
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
      this.createBackup("pre-restore");
    }

    fs.mkdirSync(this.profileDir, { recursive: true });
    for (const entry of fs.readdirSync(this.profileDir)) {
      fs.rmSync(path.join(this.profileDir, entry), { recursive: true, force: true });
    }
    for (const entry of fs.readdirSync(sourceDir)) {
      this.copyRecursive(path.join(sourceDir, entry), path.join(this.profileDir, entry));
    }

    this.emit("status", {
      profile: this.currentProfile.id,
      version: this.currentProfile.version,
      serverSoftware: this.currentProfile.serverSoftware,
      rulesLocked: this.currentProfile.rulesLocked,
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

  buildCompatibilityReport(items, runtime = this.currentSoftware || DEFAULT_SERVER_SOFTWARE) {
    const findings = [];
    if (runtime === "vanilla") {
      return {
        ready: true,
        summary: "Vanilla has no add-on compatibility checks because it does not load mods or plugins.",
        findings,
      };
    }

    const metadataList = items
      .map((item) => {
        const filePath = path.join(this.getAddonDir(runtime), item.name);
        return this.getAddonMetadata(filePath, runtime);
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
    return ["world", "world_nether", "world_the_end", "level.dat", "session.lock"].some(
      (entry) => fs.existsSync(path.join(profileDir, entry)),
    );
  }

  syncWorldLockState() {
    if (this.currentProfile && this.hasWorldData() && !this.currentProfile.rulesLocked) {
      const next = this.persistCurrentProfile({ rulesLocked: true });
      this.emit("status", {
        profile: next.id,
        version: next.version,
        serverSoftware: next.serverSoftware,
        modePreset: next.modePreset,
        cheatLock: next.cheatLock,
        rulesLocked: next.rulesLocked,
      });
    }
  }

  setProfile(profile) {
    const resolved = this.resolveProfileInput(profile);
    this.currentProfile = resolved;
    this.profileName = resolved.id || "default";
    this.currentVersion = resolved.version || DEFAULT_MC_VERSION;
    this.currentSoftware = resolved.serverSoftware || DEFAULT_SERVER_SOFTWARE;
    this.profileDir = path.join(this.baseRoot, "profiles", this.profileName);
    this.baseDir = this.profileDir;
    this.jarPath = this.getJarPath(this.currentVersion, this.currentSoftware);
    this.ensureBaseDir();
    this.syncWorldLockState();

    const active = this.getActiveProfile();
    this.emit("status", {
      profile: active.id,
      version: active.version,
      serverSoftware: active.serverSoftware,
      modePreset: active.modePreset,
      cheatLock: active.cheatLock,
      rulesLocked: active.rulesLocked,
    });
  }

  deleteProfile(profileId) {
    if (!profileId) {
      throw new Error("Profile id is required");
    }
    if (this.serverProcess && this.profileName === profileId) {
      throw new Error("Stop the server before deleting it.");
    }
    const profileDir = path.join(this.baseRoot, "profiles", profileId);
    if (fs.existsSync(profileDir)) {
      fs.rmSync(profileDir, { recursive: true, force: true });
    }
    return { deleted: true, id: profileId };
  }

  listAddons(software = this.currentSoftware || DEFAULT_SERVER_SOFTWARE) {
    const context = this.getAddonContext(software);
    const folderPath = this.getAddonDir(software);
    if (!context.supported || !folderPath) {
      return {
        supported: false,
        kind: context.kind,
        label: context.label,
        helperText: context.helperText,
        folderPath: null,
        runtime: context.runtime,
        items: [],
        compatibility: {
          ready: true,
          summary: context.helperText,
          findings: [],
        },
      };
    }

    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    const items = fs
      .readdirSync(folderPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".jar"))
      .map((entry) => {
        const filePath = path.join(folderPath, entry.name);
        const stats = fs.statSync(filePath);
        return {
          name: entry.name,
          sizeBytes: stats.size,
          updatedAt: stats.mtimeMs,
        };
      })
      .sort((left, right) => right.updatedAt - left.updatedAt);

    return {
      supported: true,
      kind: context.kind,
      label: context.label,
      helperText: context.helperText,
      folderPath,
      runtime: context.runtime,
      items,
      compatibility: this.buildCompatibilityReport(items, software),
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
    }

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
    }
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

  async searchAddonCatalog(query, runtime = this.currentSoftware || DEFAULT_SERVER_SOFTWARE) {
    const context = this.getAddonContext(runtime);
    if (!context.supported) {
      return [];
    }

    const searchQuery = String(query || "").trim();
    if (!searchQuery) {
      return [];
    }

    const searchUrl = `${MODRINTH_API_BASE}/search?query=${encodeURIComponent(
      searchQuery,
    )}&limit=8&index=relevance&facets=${encodeURIComponent(
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
      iconUrl: hit.icon_url || null,
      categories: hit.categories || [],
    }));
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

    const loaders = this.getCatalogLoaders(runtime);
    const versionsUrl = `${MODRINTH_API_BASE}/project/${encodeURIComponent(
      projectId,
    )}/version?loaders=${encodeURIComponent(JSON.stringify(loaders))}&game_versions=${encodeURIComponent(
      JSON.stringify([this.currentVersion]),
    )}`;
    const versions = await this.fetchJson(versionsUrl);
    const selectedVersion =
      (versions || []).find((version) => version.version_type === "release") ||
      (versions || [])[0];
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
    return this.listAddons(runtime);
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
    if (!this.verifyJava()) {
      throw new Error("Java runtime not found in PATH. Install Java 17+ and retry.");
    }
    if (this.serverProcess) {
      throw new Error("Server already running");
    }

    this.currentVersion = options.version || this.currentVersion || DEFAULT_MC_VERSION;
    this.currentSoftware =
      options.serverSoftware || this.currentSoftware || DEFAULT_SERVER_SOFTWARE;
    this.jarPath = this.getJarPath(this.currentVersion, this.currentSoftware);
    this.ensureBaseDir();
    this.persistCurrentProfile({
      version: this.currentVersion,
      serverSoftware: this.currentSoftware,
      motd: options.motd || this.currentProfile.motd || DEFAULT_MOTD,
    });

    if (this.hasMeaningfulProfileContent()) {
      this.createBackup("before-start");
    }

    await this.ensureJar(this.currentVersion, this.currentSoftware);
    await this.acceptEula();

    const props = await this.writeProperties({
      "server-port": String(options.port || 25565),
      motd: options.motd || this.currentProfile.motd || DEFAULT_MOTD,
      "max-players": String(options.maxPlayers || 8),
      "view-distance": String(options.viewDistance || 12),
      "simulation-distance": String(options.simulationDistance || 10),
    });

    const minMem = Math.max(1024, Number(options.minMem || 2048));
    const maxMem = Math.max(minMem, Number(options.maxMem || 4096));
    const javaArgs = [`-Xms${minMem}M`, `-Xmx${maxMem}M`, "-jar", this.jarPath, "nogui"];

    this.serverProcess = spawn("java", javaArgs, {
      cwd: this.profileDir,
      env: { ...process.env },
    });
    this.startedAt = Date.now();

    const lockedProfile = this.persistCurrentProfile({
      rulesLocked: true,
      version: this.currentVersion,
      serverSoftware: this.currentSoftware,
      motd: props.motd || this.currentProfile.motd || DEFAULT_MOTD,
    });

    this.serverProcess.stdout.on("data", (data) => {
      this.emit("log", data.toString());
    });
    this.serverProcess.stderr.on("data", (data) => {
      this.emit("log", data.toString());
    });
    this.serverProcess.on("close", (code) => {
      this.emit("log", `Server exited with code ${code}`);
      this.serverProcess = null;
      this.emit("status", {
        running: false,
        profile: lockedProfile.id,
        version: lockedProfile.version,
        serverSoftware: lockedProfile.serverSoftware,
        modePreset: lockedProfile.modePreset,
        cheatLock: lockedProfile.cheatLock,
        rulesLocked: lockedProfile.rulesLocked,
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
    };
  }

  async stop() {
    if (!this.serverProcess) return;
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
    if (!this.serverProcess) throw new Error("Server is not running");
    const profile = this.getActiveProfile();
    if (profile.cheatLock && !this.isCommandAllowed(cmd)) {
      throw new Error(`Cheat guard is on. Only safe admin commands are allowed from ${APP_NAME}.`);
    }
    this.serverProcess.stdin.write(`${cmd}\n`);
  }

  async getStats() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const systemUsage = {
      totalMB: Math.round(totalMem / 1024 / 1024),
      freeMB: Math.round(freeMem / 1024 / 1024),
      usedMB: Math.round((totalMem - freeMem) / 1024 / 1024),
    };

    if (this.serverProcess) {
      const usage = await pidusage(this.serverProcess.pid);
      return {
        running: true,
        cpu: Number(usage.cpu.toFixed(1)),
        memoryMB: Math.round(usage.memory / 1024 / 1024),
        uptime: Math.round((Date.now() - this.startedAt) / 1000),
        system: systemUsage,
      };
    }
    return { running: false, cpu: 0, memoryMB: 0, uptime: 0, system: systemUsage };
  }
}

module.exports = ServerManager;
