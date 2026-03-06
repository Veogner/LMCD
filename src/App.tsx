import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./index.css";
import type {
  AddonState,
  BackupEntry,
  CatalogResult,
  LogBatchPayload,
  ModePreset,
  NetworkDiagnostics,
  Profile,
  ServerSoftware,
  ServerStartOptions,
  ServerStats,
  StorageCleanupResult,
  StorageReport,
} from "./types";

const APP_NAME = "LMCD";
const APP_RELEASE_TAG = "4m26s4ea";
const APP_DISPLAY_NAME = `${APP_NAME} ${APP_RELEASE_TAG}`;
const DEFAULT_VERSION = "1.21.11";
const DEFAULT_MOTD = "LMCD Hardcore";
const DEFAULT_SERVER_SOFTWARE: ServerSoftware = "paper";

const FALLBACK_VERSION_PRESETS = [
  "1.21.11",
  "1.21.10",
  "1.21.8",
  "1.21.6",
  "1.20.6",
  "1.20.4",
  "1.19.4",
];

const MODE_PRESET_OPTIONS: Array<{
  id: ModePreset;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    id: "hardcore",
    label: "Hardcore Ironman",
    shortLabel: "Hardcore",
    description:
      "One life, hard difficulty, survival mode, cheat guard locked on, and the world wipes with its backups if a death is detected.",
  },
  {
    id: "survival_locked",
    label: "Survival Locked",
    shortLabel: "Survival",
    description: "Normal survival world with gamemode forced and preset rules that lock after first launch.",
  },
  {
    id: "adventure_locked",
    label: "Adventure Locked",
    shortLabel: "Adventure",
    description: "Adventure-only world with forced mode and the same post-creation rule lock.",
  },
];

const MODE_PRESET_MAP = Object.fromEntries(
  MODE_PRESET_OPTIONS.map((preset) => [preset.id, preset]),
) as Record<ModePreset, (typeof MODE_PRESET_OPTIONS)[number]>;

const SERVER_SOFTWARE_OPTIONS: Array<{
  id: ServerSoftware;
  label: string;
  shortLabel: string;
  description: string;
  note: string;
}> = [
  {
    id: "paper",
    label: "Paper",
    shortLabel: "Paper",
    description:
      "Recommended default. Best balance of performance, stability, plugin control, and vanilla gameplay.",
    note: "Use this if you want the strongest all-around server runtime.",
  },
  {
    id: "fabric",
    label: "Fabric",
    shortLabel: "Fabric",
    description: "Best path for future server-side mods with a lightweight loader and clean version support.",
    note: "Only official Fabric-supported versions show up in the picker.",
  },
  {
    id: "vanilla",
    label: "Vanilla",
    shortLabel: "Vanilla",
    description: "Pure Mojang server jar with no third-party runtime and the closest stock behavior.",
    note: "Use this when you want the plain official server.",
  },
];

const SERVER_SOFTWARE_MAP = Object.fromEntries(
  SERVER_SOFTWARE_OPTIONS.map((software) => [software.id, software]),
) as Record<ServerSoftware, (typeof SERVER_SOFTWARE_OPTIONS)[number]>;

const SAFE_ACTIONS = [
  { label: "List players", command: "list" },
  { label: "Save world", command: "save-all" },
  { label: "Say hello", command: "say Server check-in from LMCD" },
];

const defaultOptions: Required<ServerStartOptions> = {
  minMem: 2048,
  maxMem: 4096,
  port: 25565,
  idleShutdownMinutes: 0,
  motd: DEFAULT_MOTD,
  viewDistance: 12,
  simulationDistance: 10,
  maxPlayers: 8,
  version: DEFAULT_VERSION,
  serverSoftware: DEFAULT_SERVER_SOFTWARE,
};

type CreateDraft = {
  name: string;
  profileType: "local" | "remote";
  version: string;
  motd: string;
  serverSoftware: ServerSoftware;
  modePreset: ModePreset;
  cheatLock: boolean;
  minMem: string;
  maxMem: string;
  port: string;
  idleShutdownMinutes: string;
  host: string;
  publicHost: string;
  rconPort: string;
  wakeCommand: string;
  wakeTimeoutSec: string;
  connectTimeoutSec: string;
  password: string;
};

const MAX_LOG_LINES = 400;
const MAX_CHAT_LINES = 400;
const LOAD_TIMEOUT_MS = 12000;

type LaunchDraft = {
  minMem: string;
  maxMem: string;
  port: string;
  idleShutdownMinutes: string;
};

type PropertyDraft = {
  name: string;
  motd: string;
  maxPlayers: string;
  viewDistance: string;
  simulationDistance: string;
  allowFlight: boolean;
  whitelist: boolean;
};

const emptyCreateDraft: CreateDraft = {
  name: "",
  profileType: "local",
  version: DEFAULT_VERSION,
  motd: DEFAULT_MOTD,
  serverSoftware: DEFAULT_SERVER_SOFTWARE,
  modePreset: "hardcore" as ModePreset,
  cheatLock: true,
  minMem: String(defaultOptions.minMem),
  maxMem: String(defaultOptions.maxMem),
  port: String(defaultOptions.port),
  idleShutdownMinutes: String(defaultOptions.idleShutdownMinutes),
  host: "",
  publicHost: "",
  rconPort: "25575",
  wakeCommand: "",
  wakeTimeoutSec: "45",
  connectTimeoutSec: "15",
  password: "",
};

type StatusDetails = {
  running?: boolean;
  downloading?: boolean;
  path?: string;
  port?: number;
  minMem?: number;
  maxMem?: number;
  idleShutdownMinutes?: number;
  profile?: string;
  version?: string;
  serverSoftware?: ServerSoftware;
  modePreset?: ModePreset;
  cheatLock?: boolean;
  rulesLocked?: boolean;
  profileType?: "local" | "remote";
  host?: string;
  publicHost?: string;
  rconPort?: number;
};

const emptyLaunchDraft: LaunchDraft = {
  minMem: String(defaultOptions.minMem),
  maxMem: String(defaultOptions.maxMem),
  port: String(defaultOptions.port),
  idleShutdownMinutes: String(defaultOptions.idleShutdownMinutes),
};

const emptyPropertyDraft: PropertyDraft = {
  name: "",
  motd: DEFAULT_MOTD,
  maxPlayers: String(defaultOptions.maxPlayers),
  viewDistance: String(defaultOptions.viewDistance),
  simulationDistance: String(defaultOptions.simulationDistance),
  allowFlight: false,
  whitelist: false,
};

const formatUptime = (seconds: number) => {
  if (!seconds) return "-";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h ? `${h}h` : null, m ? `${m}m` : null, `${s}s`].filter(Boolean).join(" ");
};

const normalizeModePreset = (value?: string): ModePreset =>
  MODE_PRESET_OPTIONS.some((preset) => preset.id === value)
    ? (value as ModePreset)
    : "hardcore";

const normalizeServerSoftware = (value?: string): ServerSoftware =>
  SERVER_SOFTWARE_OPTIONS.some((software) => software.id === value)
    ? (value as ServerSoftware)
    : DEFAULT_SERVER_SOFTWARE;

const normalizeProfiles = (list: Profile[]) =>
  (list || []).map((profile, index) => {
    const minMem = clampInteger(String(profile.minMem ?? ""), defaultOptions.minMem, 1024);
    const maxMem = clampInteger(String(profile.maxMem ?? ""), defaultOptions.maxMem, minMem);
    const port = clampInteger(String(profile.port ?? ""), defaultOptions.port, 1, 65535);
    const idleShutdownMinutes = clampInteger(
      String(profile.idleShutdownMinutes ?? ""),
      defaultOptions.idleShutdownMinutes,
      0,
      1440,
    );
    const profileType: Profile["profileType"] =
      profile.profileType === "remote" ? "remote" : "local";

    return {
      id: profile.id || `server-${index + 1}`,
      name: profile.name || `Server ${index + 1}`,
      profileType,
      version: profile.version || DEFAULT_VERSION,
      motd: profile.motd || DEFAULT_MOTD,
      minMem,
      maxMem,
      port,
      idleShutdownMinutes,
      serverSoftware: normalizeServerSoftware(profile.serverSoftware),
      modePreset: normalizeModePreset(profile.modePreset),
      cheatLock: profile.cheatLock !== false,
      rulesLocked: Boolean(profile.rulesLocked),
      host: String(profile.host || "").trim(),
      publicHost: String(profile.publicHost || "").trim(),
      rconPort: clampInteger(String(profile.rconPort ?? ""), 25575, 1, 65535),
      rconPasswordRef: String(profile.rconPasswordRef || "").trim(),
      wakeCommand: String(profile.wakeCommand || "").trim(),
      wakeTimeoutSec: clampInteger(String(profile.wakeTimeoutSec ?? ""), 45, 5, 300),
      connectTimeoutSec: clampInteger(String(profile.connectTimeoutSec ?? ""), 15, 3, 120),
    } as Profile;
  });

const makeProfileId = (name: string) =>
  `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "server"}-${Date.now()}`;

const createLaunchDraft = (
  profile: Profile,
  loadedOptions: Required<ServerStartOptions>,
  nextProps: Record<string, string>,
): LaunchDraft => ({
  minMem: String(profile.minMem ?? loadedOptions.minMem),
  maxMem: String(profile.maxMem ?? loadedOptions.maxMem),
  port: String(profile.port ?? nextProps["server-port"] ?? loadedOptions.port),
  idleShutdownMinutes: String(profile.idleShutdownMinutes ?? loadedOptions.idleShutdownMinutes),
});

const createPropertyDraft = (
  profile: Profile,
  nextProps: Record<string, string>,
): PropertyDraft => ({
  name: profile.name,
  motd: nextProps.motd || profile.motd || DEFAULT_MOTD,
  maxPlayers: String(nextProps["max-players"] || defaultOptions.maxPlayers),
  viewDistance: String(nextProps["view-distance"] || defaultOptions.viewDistance),
  simulationDistance: String(
    nextProps["simulation-distance"] || defaultOptions.simulationDistance,
  ),
  allowFlight: nextProps["allow-flight"] === "true",
  whitelist: nextProps["white-list"] === "true",
});

const getBackupPolicySummary = (profile?: Profile | null) => {
  if (!profile) {
    return "Each server keeps up to 4 backups total: 2 auto + 2 manual/change snapshots.";
  }
  if (profile.modePreset === "hardcore") {
    return "Hardcore servers keep 2 auto + 2 manual/change backups, with auto backups every 5 minutes while running.";
  }
  return "Non-hardcore servers keep 2 auto + 2 manual/change backups, with auto backups every 5 minutes while running.";
};

const clampInteger = (
  value: string,
  fallback: number,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, parsed));
};

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return fallback;
};

const formatAddonSize = (sizeBytes: number) => {
  if (sizeBytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
  }
  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
};

const formatStorageSize = (sizeBytes: number) => {
  const safe = Math.max(0, Number(sizeBytes) || 0);
  if (safe >= 1024 * 1024 * 1024) {
    return `${(safe / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }
  if (safe >= 1024 * 1024) {
    return `${(safe / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(safe / 1024))} KB`;
};

const extractChatLine = (rawLine: string) => {
  const line = String(rawLine || "").replace(/\r?\n$/, "");
  if (!line) {
    return null;
  }
  const payload = line.includes("]: ") ? line.split("]: ").pop() || line : line;
  return /^(\[Not Secure\] )?<[^>]+> .+/.test(payload) ? line : null;
};

const trimTail = <T,>(items: T[], limit: number) => {
  if (items.length <= limit) {
    return items;
  }
  return items.slice(-limit);
};

const formatDownloads = (count: number) => {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${Math.round(count / 1_000)}K`;
  }
  return String(count);
};

const getCatalogStars = (downloads: number, follows?: number) => {
  const safeDownloads = Math.max(0, Number(downloads) || 0);
  const safeFollows = Math.max(0, Number(follows) || 0);
  const scoreRaw = 0.65 * Math.log10(safeFollows + 1) + 0.35 * Math.log10(safeDownloads + 1);
  return Math.max(1, Math.min(5, Math.round(scoreRaw * 1.35 * 10) / 10));
};

const withTimeout = async <T,>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

function App() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<"selector" | "workspace">("selector");
  const [activeTab, setActiveTab] = useState<"settings" | "mods" | "terminal" | "chat">(
    "settings",
  );
  const [options, setOptions] = useState(defaultOptions);
  const [properties, setProperties] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [chatLines, setChatLines] = useState<string[]>([]);
  const [stats, setStats] = useState<ServerStats | null>(null);
  const [starting, setStarting] = useState(false);
  const [savingLaunchSettings, setSavingLaunchSettings] = useState(false);
  const [savingProps, setSavingProps] = useState(false);
  const [savingRules, setSavingRules] = useState(false);
  const [command, setCommand] = useState("");
  const [downloadPct, setDownloadPct] = useState<number | null>(null);
  const [statusDetails, setStatusDetails] = useState<StatusDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createDraft, setCreateDraft] = useState(emptyCreateDraft);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null);
  const [deleteText, setDeleteText] = useState("");
  const [launchDraft, setLaunchDraft] = useState<LaunchDraft>(emptyLaunchDraft);
  const [propertyDraft, setPropertyDraft] = useState<PropertyDraft>(emptyPropertyDraft);
  const [versionOptions, setVersionOptions] = useState<string[]>(FALLBACK_VERSION_PRESETS);
  const [loadingVersionOptions, setLoadingVersionOptions] = useState(false);
  const [addonState, setAddonState] = useState<AddonState>({
    supported: false,
    kind: "none",
    label: "Runtime add-ons unavailable",
    helperText: "Select a server to manage extensions.",
    folderPath: null,
    runtime: DEFAULT_SERVER_SOFTWARE,
    items: [],
    compatibility: {
      ready: true,
      summary: "Select a server to manage extensions.",
      findings: [],
    },
  });
  const [loadingAddons, setLoadingAddons] = useState(false);
  const [managingAddons, setManagingAddons] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogResults, setCatalogResults] = useState<CatalogResult[]>([]);
  const [selectedCatalog, setSelectedCatalog] = useState<CatalogResult | null>(null);
  const [loadingCatalogDetail, setLoadingCatalogDetail] = useState(false);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [installingProjectId, setInstallingProjectId] = useState<string | null>(null);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [workingBackupId, setWorkingBackupId] = useState<string | null>(null);
  const [networkDiagnostics, setNetworkDiagnostics] = useState<NetworkDiagnostics | null>(null);
  const [networkBusy, setNetworkBusy] = useState(false);
  const [storageReport, setStorageReport] = useState<StorageReport | null>(null);
  const [storageBusy, setStorageBusy] = useState(false);
  const [storageCleanup, setStorageCleanup] = useState<StorageCleanupResult | null>(null);
  const consoleRef = useRef<HTMLDivElement | null>(null);
  const chatRef = useRef<HTMLDivElement | null>(null);
  const profileLoadSeqRef = useRef(0);
  const addonLoadTokenRef = useRef(0);
  const backupLoadTokenRef = useRef(0);
  const diagnosticsLoadTokenRef = useRef(0);
  const storageLoadTokenRef = useRef(0);
  const lastLoadedProfileIdRef = useRef<string | null>(null);
  const logBufferRef = useRef<string[]>([]);
  const chatBufferRef = useRef<string[]>([]);

  const activeProfile = profiles.find((profile) => profile.id === activeId) || profiles[0] || null;
  const activePreset = activeProfile ? MODE_PRESET_MAP[activeProfile.modePreset] : null;
  const activeSoftware = activeProfile
    ? SERVER_SOFTWARE_MAP[activeProfile.serverSoftware]
    : null;
  const preloadSoftware = activeSoftware || SERVER_SOFTWARE_MAP[DEFAULT_SERVER_SOFTWARE];
  const rulesLocked = Boolean(activeProfile?.rulesLocked);
  const deleteMatches = deleteTarget ? deleteText.trim() === deleteTarget.name : false;
  const versionChoices = versionOptions.length > 0 ? versionOptions : FALLBACK_VERSION_PRESETS;

  useEffect(() => {
    if (profiles.length === 0) {
      if (activeId !== null) {
        setActiveId(null);
      }
      return;
    }

    const hasActive = activeId ? profiles.some((profile) => profile.id === activeId) : false;
    if (!hasActive) {
      setActiveId(profiles[0].id);
    }
  }, [profiles, activeId]);

  const applyLoadedProfile = useCallback((profile: Profile, nextProps: Record<string, string>) => {
    const nextOptions = {
      ...defaultOptions,
      minMem: profile.minMem || defaultOptions.minMem,
      maxMem: profile.maxMem || defaultOptions.maxMem,
      port: Number(profile.port || nextProps["server-port"] || defaultOptions.port),
      idleShutdownMinutes:
        Number(profile.idleShutdownMinutes ?? defaultOptions.idleShutdownMinutes) ||
        defaultOptions.idleShutdownMinutes,
      viewDistance: Number(nextProps["view-distance"] || defaultOptions.viewDistance),
      simulationDistance: Number(
        nextProps["simulation-distance"] || defaultOptions.simulationDistance,
      ),
      maxPlayers: Number(nextProps["max-players"] || defaultOptions.maxPlayers),
      motd: nextProps.motd || profile.motd,
      version: profile.version,
      serverSoftware: profile.serverSoftware,
    };

    setProperties(nextProps);
    setOptions(nextOptions);
    setLaunchDraft(createLaunchDraft(profile, nextOptions, nextProps));
    setPropertyDraft(createPropertyDraft(profile, nextProps));
  }, []);

  const isProfileLoadCurrent = useCallback(
    (loadSeq?: number) => loadSeq === undefined || loadSeq === profileLoadSeqRef.current,
    [],
  );

  const loadProfileState = useCallback(async (profile: Profile, loadSeq?: number) => {
    await window.bridge.setProfile(profile);
    if (!isProfileLoadCurrent(loadSeq)) {
      return false;
    }
    const nextProps = await window.bridge.readProps();
    if (!isProfileLoadCurrent(loadSeq)) {
      return false;
    }
    applyLoadedProfile(profile, nextProps);
    return true;
  }, [applyLoadedProfile, isProfileLoadCurrent]);

  const loadAddonState = useCallback(async (loadSeq?: number) => {
    const requestToken = addonLoadTokenRef.current + 1;
    addonLoadTokenRef.current = requestToken;
    setLoadingAddons(true);
    try {
      const next = await withTimeout(
        window.bridge.listAddons(),
        LOAD_TIMEOUT_MS,
        "Add-on list timed out. Try Refresh.",
      );
      if (isProfileLoadCurrent(loadSeq)) {
        setAddonState(next);
      }
    } catch (addonError) {
      console.error(addonError);
      if (isProfileLoadCurrent(loadSeq)) {
        setError("Could not load mods or plugins for this server.");
      }
    } finally {
      if (requestToken === addonLoadTokenRef.current) {
        setLoadingAddons(false);
      }
    }
  }, [isProfileLoadCurrent]);

  const loadBackups = useCallback(async (loadSeq?: number) => {
    const requestToken = backupLoadTokenRef.current + 1;
    backupLoadTokenRef.current = requestToken;
    setLoadingBackups(true);
    try {
      const next = await withTimeout(
        window.bridge.listBackups(),
        LOAD_TIMEOUT_MS,
        "Backup list timed out. Try Refresh.",
      );
      if (isProfileLoadCurrent(loadSeq)) {
        setBackups(next);
      }
    } catch (backupError) {
      console.error(backupError);
      if (isProfileLoadCurrent(loadSeq)) {
        setError("Could not load backups for this server.");
      }
    } finally {
      if (requestToken === backupLoadTokenRef.current) {
        setLoadingBackups(false);
      }
    }
  }, [isProfileLoadCurrent]);

  const loadDiagnostics = useCallback(async (profileId: string, loadSeq?: number) => {
    const requestToken = diagnosticsLoadTokenRef.current + 1;
    diagnosticsLoadTokenRef.current = requestToken;
    setNetworkBusy(true);
    try {
      const next = await withTimeout(
        window.bridge.networkDiagnostics(profileId),
        LOAD_TIMEOUT_MS,
        "Network diagnostics timed out. Try Refresh.",
      );
      if (isProfileLoadCurrent(loadSeq)) {
        setNetworkDiagnostics(next);
      }
    } catch (diagnosticsError) {
      console.error(diagnosticsError);
      if (isProfileLoadCurrent(loadSeq)) {
        setError("Could not load network diagnostics for this server.");
      }
    } finally {
      if (requestToken === diagnosticsLoadTokenRef.current) {
        setNetworkBusy(false);
      }
    }
  }, [isProfileLoadCurrent]);

  const loadStorageReport = useCallback(async (profileId?: string, loadSeq?: number) => {
    const requestToken = storageLoadTokenRef.current + 1;
    storageLoadTokenRef.current = requestToken;
    setStorageBusy(true);
    try {
      const next = await withTimeout(
        window.bridge.getStorageReport(profileId),
        LOAD_TIMEOUT_MS,
        "Storage report timed out. Try Refresh.",
      );
      if (isProfileLoadCurrent(loadSeq)) {
        setStorageReport(next);
      }
    } catch (storageError) {
      console.error(storageError);
      if (isProfileLoadCurrent(loadSeq)) {
        setError("Could not load storage usage for this server.");
      }
    } finally {
      if (requestToken === storageLoadTokenRef.current) {
        setStorageBusy(false);
      }
    }
  }, [isProfileLoadCurrent]);

  const handleUpnpMap = async () => {
    if (!activeProfile) return;
    setNetworkBusy(true);
    try {
      await window.bridge.networkUpnpMap(activeProfile.id);
      await loadDiagnostics(activeProfile.id);
    } catch (upnpError) {
      console.error(upnpError);
      setError("UPnP mapping failed for this server.");
    } finally {
      setNetworkBusy(false);
    }
  };

  const handleUpnpUnmap = async () => {
    if (!activeProfile) return;
    setNetworkBusy(true);
    try {
      await window.bridge.networkUpnpUnmap(activeProfile.id);
      await loadDiagnostics(activeProfile.id);
    } catch (upnpError) {
      console.error(upnpError);
      setError("UPnP unmap failed for this server.");
    } finally {
      setNetworkBusy(false);
    }
  };

  useEffect(() => {
    const boot = async () => {
      try {
        const rawProfiles = await window.bridge.listProfiles();
        const nextProfiles = normalizeProfiles(rawProfiles);
        if (JSON.stringify(rawProfiles) !== JSON.stringify(nextProfiles)) {
          const saved = normalizeProfiles(await window.bridge.saveProfiles(nextProfiles));
          setProfiles(saved);
          if (saved.length > 0) {
            setActiveId(saved[0].id);
          }
          return;
        }
        setProfiles(nextProfiles);
        if (nextProfiles.length > 0) {
          setActiveId(nextProfiles[0].id);
        }
      } catch (err) {
        console.error(err);
        setError("Could not load saved servers.");
      }
    };

    boot();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const targetSoftware = createDraft.serverSoftware;

    const loadVersions = async () => {
      setLoadingVersionOptions(true);
      try {
        const availableVersions = await window.bridge.listVersions(targetSoftware);
        if (cancelled) return;
        const nextVersions =
          availableVersions && availableVersions.length > 0
            ? availableVersions
            : FALLBACK_VERSION_PRESETS;
        setVersionOptions(nextVersions);
        setCreateDraft((prev) => {
          if (prev.serverSoftware !== targetSoftware) {
            return prev;
          }
          if (nextVersions.includes(prev.version)) {
            return prev;
          }
          return { ...prev, version: nextVersions[0] || DEFAULT_VERSION };
        });
      } catch (versionError) {
        console.error(versionError);
        if (cancelled) return;
        setVersionOptions(FALLBACK_VERSION_PRESETS);
        setCreateDraft((prev) => {
          if (prev.serverSoftware !== targetSoftware) {
            return prev;
          }
          if (FALLBACK_VERSION_PRESETS.includes(prev.version)) {
            return prev;
          }
          return { ...prev, version: FALLBACK_VERSION_PRESETS[0] || DEFAULT_VERSION };
        });
      } finally {
        if (!cancelled) {
          setLoadingVersionOptions(false);
        }
      }
    };

    loadVersions();
    return () => {
      cancelled = true;
    };
  }, [createDraft.serverSoftware]);

  useEffect(() => {
    const loadSeq = profileLoadSeqRef.current + 1;
    profileLoadSeqRef.current = loadSeq;

    if (!activeId) {
      lastLoadedProfileIdRef.current = null;
      addonLoadTokenRef.current += 1;
      backupLoadTokenRef.current += 1;
      diagnosticsLoadTokenRef.current += 1;
      storageLoadTokenRef.current += 1;
      setProperties({});
      setOptions(defaultOptions);
      setRunning(false);
      setStats(null);
      setStarting(false);
      setSavingLaunchSettings(false);
      setSavingProps(false);
      setSavingRules(false);
      setLoadingAddons(false);
      setLoadingBackups(false);
      setNetworkBusy(false);
      setStorageBusy(false);
      setLaunchDraft(emptyLaunchDraft);
      setPropertyDraft(emptyPropertyDraft);
      setCatalogQuery("");
      setAddonState({
        supported: false,
        kind: "none",
        label: "Runtime add-ons unavailable",
        helperText: "Select a server to manage extensions.",
        folderPath: null,
        runtime: DEFAULT_SERVER_SOFTWARE,
        items: [],
        compatibility: {
          ready: true,
          summary: "Select a server to manage extensions.",
          findings: [],
        },
      });
      setBackups([]);
      setCatalogResults([]);
      setSelectedCatalog(null);
      setCatalogQuery("");
      setNetworkDiagnostics(null);
      logBufferRef.current = [];
      chatBufferRef.current = [];
      setLogs([]);
      setChatLines([]);
      setStorageReport(null);
      setStorageCleanup(null);
      return;
    }

    const profileForLoad = profiles.find((profile) => profile.id === activeId) || null;
    if (!profileForLoad) {
      return;
    }
    const isSwitchingProfile = lastLoadedProfileIdRef.current !== profileForLoad.id;

    const loadProfile = async () => {
      try {
        setError(null);
        if (isSwitchingProfile) {
          setCatalogResults([]);
          setSelectedCatalog(null);
        }
        const loaded = await loadProfileState(profileForLoad, loadSeq);
        if (!loaded || !isProfileLoadCurrent(loadSeq)) {
          return;
        }
        lastLoadedProfileIdRef.current = profileForLoad.id;
        await Promise.all([
          loadAddonState(loadSeq),
          loadBackups(loadSeq),
          loadDiagnostics(profileForLoad.id, loadSeq),
          loadStorageReport(profileForLoad.id, loadSeq),
        ]);
      } catch (err) {
        console.error(err);
        if (isProfileLoadCurrent(loadSeq)) {
          lastLoadedProfileIdRef.current = null;
          setError("Could not load the selected server.");
        }
      }
    };

    void loadProfile();

    return () => {
      if (profileLoadSeqRef.current === loadSeq) {
        profileLoadSeqRef.current += 1;
      }
    };
  }, [
    activeId,
    profiles,
    loadAddonState,
    loadBackups,
    loadDiagnostics,
    isProfileLoadCurrent,
    loadProfileState,
    loadStorageReport,
  ]);

  const appendLogLines = useCallback((incomingLines: LogBatchPayload) => {
    const normalizedLines = incomingLines
      .map((line) => String(line || "").replace(/\r?\n$/, ""))
      .filter(Boolean);
    if (normalizedLines.length === 0) {
      return;
    }

    logBufferRef.current = trimTail([...logBufferRef.current, ...normalizedLines], MAX_LOG_LINES);

    const incomingChatLines = normalizedLines
      .map((line) => extractChatLine(line))
      .filter((line): line is string => Boolean(line));
    if (incomingChatLines.length > 0) {
      chatBufferRef.current = trimTail(
        [...chatBufferRef.current, ...incomingChatLines],
        MAX_CHAT_LINES,
      );
    }

    if (activeTab === "terminal") {
      setLogs([...logBufferRef.current]);
    }

    if (activeTab === "chat") {
      setChatLines([...chatBufferRef.current]);
    }
  }, [activeTab]);

  const appendManualLogLine = useCallback((line: string) => {
    const normalized = String(line || "").replace(/\r?\n$/, "");
    if (!normalized) {
      return;
    }

    logBufferRef.current = trimTail([...logBufferRef.current, normalized], MAX_LOG_LINES);
    const chatMatch = extractChatLine(normalized);
    if (chatMatch) {
      chatBufferRef.current = trimTail([...chatBufferRef.current, chatMatch], MAX_CHAT_LINES);
    }

    if (activeTab === "terminal") {
      setLogs([...logBufferRef.current]);
    }
    if (activeTab === "chat" && chatMatch) {
      setChatLines([...chatBufferRef.current]);
    }
  }, [activeTab]);

  useEffect(() => {
    const unsubLogBatch = window.bridge.onLogBatch((lines) => {
      appendLogLines(Array.isArray(lines) ? lines : [String(lines || "")]);
    });

    const unsubStatus = window.bridge.onStatus((payload: StatusDetails) => {
      if (typeof payload.running === "boolean") {
        setRunning(payload.running);
      }
      if (payload.downloading === false) {
        setDownloadPct(null);
      }
      setStatusDetails(payload);
      if (!payload.profile) return;

      setProfiles((prev) => {
        let changed = false;
        const next = prev.map((profile) => {
          if (profile.id !== payload.profile) {
            return profile;
          }

          const nextVersion = payload.version || profile.version;
          const nextSoftware = payload.serverSoftware || profile.serverSoftware;
          const nextPreset = normalizeModePreset(payload.modePreset || profile.modePreset);
          const nextCheatLock =
            typeof payload.cheatLock === "boolean" ? payload.cheatLock : profile.cheatLock;
          const nextRulesLocked =
            typeof payload.rulesLocked === "boolean" ? payload.rulesLocked : profile.rulesLocked;

          if (
            nextVersion === profile.version &&
            nextSoftware === profile.serverSoftware &&
            nextPreset === profile.modePreset &&
            nextCheatLock === profile.cheatLock &&
            nextRulesLocked === profile.rulesLocked
          ) {
            return profile;
          }

          changed = true;
          return {
            ...profile,
            version: nextVersion,
            serverSoftware: nextSoftware,
            modePreset: nextPreset,
            cheatLock: nextCheatLock,
            rulesLocked: nextRulesLocked,
          };
        });
        return changed ? next : prev;
      });
    });

    const unsubDownload = window.bridge.onDownload((payload) => {
      setDownloadPct(payload.percent ?? null);
    });

    return () => {
      unsubLogBatch();
      unsubStatus();
      unsubDownload();
    };
  }, [appendLogLines]);

  useEffect(() => {
    if (activeTab === "terminal") {
      setLogs([...logBufferRef.current]);
    }
    if (activeTab === "chat") {
      setChatLines([...chatBufferRef.current]);
    }
  }, [activeTab]);

  useEffect(() => {
    if (!running) {
      setStats(null);
      return;
    }

    let cancelled = false;
    let inFlight = false;
    const pollStats = async () => {
      if (cancelled || inFlight) {
        return;
      }
      inFlight = true;
      try {
        const nextStats = await window.bridge.getStats();
        if (!cancelled) {
          setStats(nextStats);
        }
      } catch (err) {
        if (!cancelled) {
          console.error(err);
        }
      } finally {
        inFlight = false;
      }
    };

    void pollStats();
    const timer = setInterval(() => {
      void pollStats();
    }, 1200);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [running, activeProfile?.id]);

  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [logs]);

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [chatLines]);

  const persistProfiles = async (nextProfiles: Profile[], nextActiveId: string | null) => {
    const normalized = normalizeProfiles(nextProfiles);
    const saved = normalizeProfiles(await window.bridge.saveProfiles(normalized));
    setProfiles(saved);
    setActiveId(nextActiveId);
    return saved;
  };

  const syncActiveProfile = async (updates: Partial<Profile>, reload = false) => {
    if (!activeProfile) return null;
    const nextProfiles = profiles.map((profile) =>
      profile.id === activeProfile.id ? { ...profile, ...updates } : profile,
    );
    const saved = await persistProfiles(nextProfiles, activeProfile.id);
    const nextActive = saved.find((profile) => profile.id === activeProfile.id) || null;
    if (reload && nextActive) {
      await loadProfileState(nextActive);
    }
    return nextActive;
  };

  const openCreateModal = () => {
    setCreateDraft(emptyCreateDraft);
    setCreateOpen(true);
  };

  const handleCreateProfile = async (event: React.FormEvent) => {
    event.preventDefault();

    const name = createDraft.name.trim();
    const version = createDraft.version.trim();
    const motd = createDraft.motd.trim() || DEFAULT_MOTD;

    if (!name) {
      setError("Server name is required.");
      return;
    }
    if (!version) {
      setError("Minecraft version is required.");
      return;
    }
    if (!versionChoices.includes(version)) {
      setError(
        `${SERVER_SOFTWARE_MAP[createDraft.serverSoftware].label} does not support that version in the current official list.`,
      );
      return;
    }

    try {
      const created: Profile = {
        id: makeProfileId(name),
        name,
        profileType: createDraft.profileType,
        version,
        motd,
        minMem: clampInteger(createDraft.minMem, defaultOptions.minMem, 1024),
        maxMem: clampInteger(
          createDraft.maxMem,
          defaultOptions.maxMem,
          clampInteger(createDraft.minMem, defaultOptions.minMem, 1024),
        ),
        port: clampInteger(createDraft.port, defaultOptions.port, 1, 65535),
        idleShutdownMinutes: clampInteger(
          createDraft.idleShutdownMinutes,
          defaultOptions.idleShutdownMinutes,
          0,
          1440,
        ),
        serverSoftware: createDraft.serverSoftware,
        modePreset: createDraft.modePreset,
        cheatLock: createDraft.cheatLock,
        rulesLocked: false,
        host: createDraft.host.trim(),
        publicHost: createDraft.publicHost.trim(),
        rconPort: clampInteger(createDraft.rconPort, 25575, 1, 65535),
        rconPasswordRef: "",
        wakeCommand: createDraft.wakeCommand.trim(),
        wakeTimeoutSec: clampInteger(createDraft.wakeTimeoutSec, 45, 5, 300),
        connectTimeoutSec: clampInteger(createDraft.connectTimeoutSec, 15, 3, 120),
      };

      await persistProfiles([...profiles, created], created.id);
      if (created.profileType === "remote" && createDraft.password.trim()) {
        await window.bridge.remoteSetPassword(created.id, createDraft.password.trim());
      }
      setCreateOpen(false);
      setView("workspace");
      setError(null);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Could not create this server."));
    }
  };

  const askDeleteProfile = () => {
    if (!activeProfile) return;
    setDeleteTarget(activeProfile);
    setDeleteText("");
  };

  const handleDeleteProfile = async () => {
    if (!deleteTarget || deleteText.trim() !== deleteTarget.name) return;

    try {
      const nextProfiles = normalizeProfiles(await window.bridge.deleteProfile(deleteTarget.id));
      setProfiles(nextProfiles);
      if (nextProfiles.length > 0) {
        setActiveId(nextProfiles[0].id);
      } else {
        setActiveId(null);
        setProperties({});
        setLaunchDraft(emptyLaunchDraft);
        setPropertyDraft(emptyPropertyDraft);
        setAddonState({
          supported: false,
          kind: "none",
          label: "Runtime add-ons unavailable",
          helperText: "Create a server to manage extensions.",
          folderPath: null,
          runtime: DEFAULT_SERVER_SOFTWARE,
          items: [],
          compatibility: {
            ready: true,
            summary: "Create a server to manage extensions.",
            findings: [],
          },
        });
        setBackups([]);
        setCatalogResults([]);
        setCatalogQuery("");
        setStats(null);
        setRunning(false);
        setStatusDetails(null);
        logBufferRef.current = [];
        chatBufferRef.current = [];
        setLogs([]);
        setChatLines([]);
        setStorageReport(null);
        setStorageCleanup(null);
      }
      setDeleteTarget(null);
      setDeleteText("");
      setError(null);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Could not delete this server."));
    }
  };

  const handleRuleChange = async (
    updates: Partial<Pick<Profile, "modePreset" | "cheatLock">>,
  ) => {
    if (!activeProfile || activeProfile.rulesLocked) return;
    if (
      Object.prototype.hasOwnProperty.call(updates, "cheatLock") &&
      updates.cheatLock === false &&
      activeProfile.cheatLock
    ) {
      setError("Cheat guard is permanent once enabled for a server.");
      return;
    }
    setSavingRules(true);
    setError(null);

    try {
      await syncActiveProfile(updates, true);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Could not update the world rules."));
    } finally {
      setSavingRules(false);
    }
  };

  const handleSaveLaunchSettings = async () => {
    if (!activeProfile) return;
    setSavingLaunchSettings(true);
    setError(null);

    try {
      const minMem = clampInteger(launchDraft.minMem, options.minMem, 1024);
      const maxMem = clampInteger(launchDraft.maxMem, options.maxMem, minMem);
      const port = clampInteger(launchDraft.port, options.port, 1, 65535);
      const idleShutdownMinutes = clampInteger(
        launchDraft.idleShutdownMinutes,
        options.idleShutdownMinutes,
        0,
        1440,
      );

      setLaunchDraft({
        minMem: String(minMem),
        maxMem: String(maxMem),
        port: String(port),
        idleShutdownMinutes: String(idleShutdownMinutes),
      });
      setOptions((prev) => ({
        ...prev,
        minMem,
        maxMem,
        port,
        idleShutdownMinutes,
      }));
      await syncActiveProfile({
        minMem,
        maxMem,
        port,
        idleShutdownMinutes,
      });
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Could not save launch settings."));
    } finally {
      setSavingLaunchSettings(false);
    }
  };

  const handleStart = async () => {
    if (!activeProfile) return;
    const targetProfileId = activeProfile.id;
    setStarting(true);
    setError(null);

    try {
      if (activeProfile.profileType === "remote") {
        await window.bridge.startServer({});
        setRunning(true);
        void loadDiagnostics(targetProfileId).catch((refreshError) => {
          console.error(refreshError);
        });
        return;
      }

      const minMem = clampInteger(launchDraft.minMem, options.minMem, 1024);
      const maxMem = clampInteger(launchDraft.maxMem, options.maxMem, minMem);
      const port = clampInteger(launchDraft.port, options.port, 1, 65535);
      const idleShutdownMinutes = clampInteger(
        launchDraft.idleShutdownMinutes,
        options.idleShutdownMinutes,
        0,
        1440,
      );
      const nextStartOptions: Required<ServerStartOptions> = {
        ...options,
        minMem,
        maxMem,
        port,
        idleShutdownMinutes,
        motd: propertyDraft.motd.trim() || DEFAULT_MOTD,
        viewDistance: clampInteger(
          propertyDraft.viewDistance,
          options.viewDistance,
          2,
          32,
        ),
        simulationDistance: clampInteger(
          propertyDraft.simulationDistance,
          options.simulationDistance,
          2,
          32,
        ),
        maxPlayers: clampInteger(propertyDraft.maxPlayers, options.maxPlayers, 1, 999),
        version: activeProfile.version,
        serverSoftware: activeProfile.serverSoftware,
      };

      setOptions(nextStartOptions);
      setLaunchDraft({
        minMem: String(minMem),
        maxMem: String(maxMem),
        port: String(port),
        idleShutdownMinutes: String(idleShutdownMinutes),
      });
      await syncActiveProfile({
        minMem,
        maxMem,
        port,
        idleShutdownMinutes,
      });

      await window.bridge.startServer({
        ...nextStartOptions,
      });
      setRunning(true);
      void Promise.all([
        loadBackups(),
        loadDiagnostics(targetProfileId),
        loadStorageReport(targetProfileId),
      ]).catch((refreshError) => {
        console.error(refreshError);
      });
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Could not start server."));
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    const targetProfileId = activeProfile?.id || null;
    setStarting(true);
    setError(null);
    try {
      await window.bridge.stopServer();
      setRunning(false);
      if (targetProfileId) {
        void Promise.all([
          loadDiagnostics(targetProfileId),
          loadStorageReport(targetProfileId),
        ]).catch((refreshError) => {
          console.error(refreshError);
        });
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Could not stop server."));
    } finally {
      setStarting(false);
    }
  };

  const handleSaveProps = async () => {
    setSavingProps(true);
    setError(null);

    try {
      const nextName = propertyDraft.name.trim();
      if (activeProfile && !nextName) {
        throw new Error("Server name is required.");
      }

      const updates = {
        ...properties,
        motd: propertyDraft.motd.trim() || DEFAULT_MOTD,
        "max-players": String(clampInteger(propertyDraft.maxPlayers, options.maxPlayers, 1, 999)),
        "view-distance": String(
          clampInteger(propertyDraft.viewDistance, options.viewDistance, 2, 32),
        ),
        "simulation-distance": String(
          clampInteger(propertyDraft.simulationDistance, options.simulationDistance, 2, 32),
        ),
        "allow-flight": propertyDraft.allowFlight ? "true" : "false",
        "white-list": propertyDraft.whitelist ? "true" : "false",
      };

      const updated = await window.bridge.writeProps(updates);
      applyLoadedProfile(
        {
          ...activeProfile!,
          name: nextName,
          motd: updated.motd || propertyDraft.motd,
        },
        updated,
      );

      if (activeProfile) {
        const profileUpdates: Partial<Profile> = {};
        if (nextName && nextName !== activeProfile.name) {
          profileUpdates.name = nextName;
        }
        if (updated.motd && updated.motd !== activeProfile.motd) {
          profileUpdates.motd = updated.motd;
        }
        if (Object.keys(profileUpdates).length > 0) {
          await syncActiveProfile(profileUpdates);
        }
      }
      setPropertyDraft((prev) => ({ ...prev, name: nextName }));
      setError(null);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Could not save server properties."));
    } finally {
      setSavingProps(false);
    }
  };

  const handleCommand = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!command.trim()) return;

    try {
      await window.bridge.sendCommand(command.trim());
      appendManualLogLine(`> ${command.trim()}`);
      setCommand("");
      setError(null);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Command failed."));
    }
  };

  const handleQuickCommand = async (nextCommand: string) => {
    try {
      await window.bridge.sendCommand(nextCommand);
      appendManualLogLine(`> ${nextCommand}`);
      setError(null);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Quick action failed."));
    }
  };

  const handlePreload = async () => {
    try {
      setError(null);
      await window.bridge.ensureJar(
        activeProfile?.version || DEFAULT_VERSION,
        activeProfile?.serverSoftware || DEFAULT_SERVER_SOFTWARE,
      );
      if (activeProfile) {
        await loadStorageReport(activeProfile.id);
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Could not preload the server jar."));
    }
  };

  const handlePickAddons = async () => {
    setManagingAddons(true);
    setError(null);
    try {
      setAddonState(await window.bridge.pickAddons());
      await loadBackups();
      if (activeProfile) {
        await loadStorageReport(activeProfile.id);
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Could not add mod or plugin jars."));
    } finally {
      setManagingAddons(false);
    }
  };

  const handleRemoveAddon = async (fileName: string) => {
    setManagingAddons(true);
    setError(null);
    try {
      setAddonState(await window.bridge.removeAddon(fileName));
      await loadBackups();
      if (activeProfile) {
        await loadStorageReport(activeProfile.id);
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Could not remove that add-on."));
    } finally {
      setManagingAddons(false);
    }
  };

  const handleOpenAddonFolder = async () => {
    try {
      await window.bridge.openAddonFolder();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Could not open the add-on folder."));
    }
  };

  const handleSelectCatalogResult = async (result: CatalogResult) => {
    setSelectedCatalog(result);
    setLoadingCatalogDetail(true);
    try {
      const detail = await window.bridge.getCatalogProject(result.projectId);
      setSelectedCatalog((prev) =>
        prev && prev.projectId === result.projectId ? { ...result, ...detail } : prev,
      );
    } catch (detailError) {
      console.error(detailError);
    } finally {
      setLoadingCatalogDetail(false);
    }
  };

  const handleSearchCatalog = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const query = catalogQuery.trim();
    if (!query) {
      setCatalogResults([]);
      setSelectedCatalog(null);
      return;
    }

    setLoadingCatalog(true);
    setError(null);
    try {
      const runtimes: ServerSoftware[] = ["fabric", "paper"];
      const resultsByRuntime = await Promise.all(
        runtimes.map((runtime) =>
          window.bridge
            .searchCatalog(query, runtime, { sort: "relevance", limit: 24 })
            .catch(() => [] as CatalogResult[]),
        ),
      );
      const merged = [];
      const seen = new Set<string>();
      for (const list of resultsByRuntime) {
        for (const item of list) {
          if (!item || !item.projectId || seen.has(item.projectId)) {
            continue;
          }
          seen.add(item.projectId);
          merged.push(item);
        }
      }
      setCatalogResults(merged);
      if (merged.length > 0) {
        void handleSelectCatalogResult(merged[0]);
      } else {
        setSelectedCatalog(null);
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Could not search for add-ons."));
    } finally {
      setLoadingCatalog(false);
    }
  };

  const handleInstallCatalogAddon = async (projectId: string) => {
    setInstallingProjectId(projectId);
    setError(null);
    try {
      setAddonState(await window.bridge.installCatalogAddon(projectId));
      await loadBackups();
      if (activeProfile) {
        await loadStorageReport(activeProfile.id);
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Could not install that add-on."));
    } finally {
      setInstallingProjectId(null);
    }
  };

  const handleCreateBackup = async (reason = "manual") => {
    setWorkingBackupId("create");
    setError(null);
    try {
      const created = await window.bridge.createBackup(reason);
      if (created.id) {
        setBackups((prev) => [created, ...prev.filter((entry) => entry.id !== created.id)]);
      } else {
        await loadBackups();
      }
      if (activeProfile) {
        await loadStorageReport(activeProfile.id);
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Could not create a backup."));
    } finally {
      setWorkingBackupId(null);
    }
  };

  const handleRestoreBackup = async (backupId: string) => {
    setWorkingBackupId(backupId);
    setError(null);
    try {
      const nextBackups = await window.bridge.restoreBackup(backupId);
      setBackups(nextBackups);
      if (activeProfile) {
        await loadProfileState(activeProfile);
        await loadAddonState();
        await loadStorageReport(activeProfile.id);
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Could not restore that backup."));
    } finally {
      setWorkingBackupId(null);
    }
  };

  const handleRunStorageCleanup = async () => {
    if (!activeProfile) {
      return;
    }
    setStorageBusy(true);
    setError(null);
    try {
      const result = await window.bridge.cleanupStorage(activeProfile.id);
      setStorageCleanup(result);
      setStorageReport(result.report);
      await Promise.all([loadBackups(), loadAddonState()]);
    } catch (cleanupError: unknown) {
      setError(getErrorMessage(cleanupError, "Could not clean up old server files."));
    } finally {
      setStorageBusy(false);
    }
  };

  const statusColor = running ? "bg-mint text-black" : "bg-slate text-basalt";
  const uptime = formatUptime(stats?.uptime || 0);
  const launchLabel = activePreset ? `Launch ${activePreset.shortLabel}` : "Launch Server";
  const liveStats = useMemo(
    () => [
      { label: "CPU", value: stats ? `${stats.cpu.toFixed(1)}%` : "-" },
      { label: "RAM (JVM)", value: stats ? `${stats.memoryMB} MB` : "-" },
      {
        label: "System RAM",
        value: stats ? `${stats.system.usedMB}/${stats.system.totalMB} MB` : "-",
      },
      { label: "Uptime", value: uptime },
    ],
    [stats, uptime],
  );

  if (view === "selector") {
    return (
      <div className="min-h-screen px-3 pb-6 text-slate sm:px-4 xl:px-6">
        <div className="mx-auto flex min-h-screen w-full max-w-[1200px] flex-col pt-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-lg font-semibold text-white">{APP_DISPLAY_NAME}</p>
              <p className="text-sm text-slate/70">
                Select a world/server first, then open its workspace.
              </p>
            </div>
            <button
              className="pill hover:border-mint/50"
              onClick={() => {
                setView("workspace");
                openCreateModal();
              }}
            >
              + New server
            </button>
          </div>

          <div className="card min-w-0">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm text-slate/80">Worlds and Servers</p>
              <span className="text-xs text-slate/60">{profiles.length} total</span>
            </div>
            {profiles.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 bg-black/10 px-4 py-5 text-sm text-slate/70">
                Create your first server profile to continue.
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {profiles.map((profile) => (
                  <button
                    key={profile.id}
                    type="button"
                    className="rounded-2xl border border-white/10 bg-black/10 px-4 py-3 text-left transition hover:border-mint/40"
                    onClick={() => {
                      setActiveId(profile.id);
                      setView("workspace");
                    }}
                  >
                    <p className="truncate text-sm font-semibold text-white">{profile.name}</p>
                    <p className="truncate text-xs text-slate/70">{profile.motd}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <span className="badge border border-white/10 bg-obsidian text-amber">
                        {profile.serverSoftware}
                      </span>
                      <span className="badge border border-white/10 bg-obsidian text-slate">
                        {profile.version}
                      </span>
                      <span className="badge border border-white/10 bg-obsidian text-mint">
                        {profile.profileType === "remote" ? "Remote" : "Local"}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-3 pb-6 text-slate sm:px-4 xl:px-6">
      <div className="mx-auto flex min-h-screen w-full max-w-[2200px] flex-col pt-4 sm:pt-5">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center">
            <p className="text-lg font-semibold text-white">{APP_DISPLAY_NAME}</p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              className="pill hover:border-white/25"
              onClick={() => setView("selector")}
            >
              Back
            </button>
            <button className="pill hover:border-mint/50" onClick={openCreateModal}>
              + New server
            </button>
            <button className="pill hover:border-white/25" onClick={handlePreload}>
              Preload {preloadSoftware.shortLabel} {activeProfile?.version || DEFAULT_VERSION}
            </button>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
          <div className="card h-full min-w-0">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm text-slate/80">Servers</p>
              <span className="text-xs text-slate/60">{profiles.length} total</span>
            </div>
            {profiles.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 bg-black/10 px-4 py-5 text-sm text-slate/70">
                <p className="mb-1 font-semibold text-white">No servers yet</p>
                <p>
                  Create one with Paper, Fabric, or Vanilla, then lock its world preset and cheat
                  guard before first launch.
                </p>
                <button
                  className="mt-4 w-full rounded-lg bg-mint py-2 font-semibold text-basalt"
                  onClick={openCreateModal}
                >
                  Create first server
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {profiles.map((profile) => {
                  const preset = MODE_PRESET_MAP[profile.modePreset];
                  return (
                    <button
                      key={profile.id}
                      onClick={() => {
                        setActiveId(profile.id);
                        setView("workspace");
                      }}
                      className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                        profile.id === activeId
                          ? "border-mint/60 bg-white/5"
                          : "border-white/10 bg-white/0 hover:border-white/25"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-semibold text-white">{profile.name}</span>
                        <span className="text-xs text-slate/60">
                          {SERVER_SOFTWARE_MAP[profile.serverSoftware].shortLabel} {profile.version}
                        </span>
                      </div>
                      <p className="truncate text-xs text-slate/70">{profile.motd}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <span className="badge border border-white/10 bg-obsidian text-mint">
                          {profile.profileType === "remote" ? "Remote" : "Local"}
                        </span>
                        <span className="badge border border-white/10 bg-obsidian text-amber">
                          {SERVER_SOFTWARE_MAP[profile.serverSoftware].shortLabel}
                        </span>
                        <span className="badge border border-white/10 bg-obsidian text-slate">
                          {preset.shortLabel}
                        </span>
                        <span
                          className={`badge border border-white/10 ${
                            profile.cheatLock ? "bg-obsidian text-mint" : "bg-obsidian text-amber"
                          }`}
                        >
                          {profile.cheatLock ? "Cheat guard" : "Cheats open"}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="mt-4 border-t border-white/10 pt-4">
              <p className="mb-2 text-xs uppercase tracking-wide text-slate/70">Workspace menu</p>
              <div className="space-y-2">
                {[
                  { id: "settings", label: "Settings" },
                  { id: "mods", label: "Mods" },
                  { id: "terminal", label: "Terminal" },
                  { id: "chat", label: "Chat" },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
                      activeTab === tab.id
                        ? "border-mint/60 bg-white/5 text-white"
                        : "border-white/10 bg-obsidian text-slate hover:border-white/25"
                    }`}
                    onClick={() => setActiveTab(tab.id as "settings" | "mods" | "terminal" | "chat")}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="min-w-0 space-y-4">
            <header className="card min-w-0 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="badge border border-white/10 bg-obsidian text-mint">
                    {activePreset?.label || "No preset"}
                  </span>
                  <span className={`badge ${statusColor}`}>{running ? "Online" : "Offline"}</span>
                  <span className="badge border border-white/10 bg-obsidian text-amber">
                    {activeSoftware?.shortLabel || "-"}
                  </span>
                  <span className="badge border border-white/10 bg-obsidian text-mint">
                    {activeProfile?.profileType === "remote" ? "Remote" : "Local"}
                  </span>
                  <span className="badge border border-white/10 bg-obsidian text-amber">
                    {activeProfile?.version || "-"}
                  </span>
                  <span className="badge border border-white/10 bg-obsidian text-slate">
                    {activeProfile?.cheatLock ? "Cheat guard on" : "Cheat guard off"}
                  </span>
                </div>
                <div>
                  <h1 className="text-2xl font-semibold text-white">
                    {activeProfile?.name || "No server selected"}
                  </h1>
                  <p className="text-sm text-slate/80">
                    Create local worlds, choose the runtime, lock the rules after first launch, and
                    manage the server without touching command line.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {running ? (
                  <button
                    className="rounded-xl bg-red-500/90 px-4 py-2 font-semibold text-white transition-colors hover:bg-red-400"
                    onClick={handleStop}
                    disabled={starting}
                  >
                    Stop Server
                  </button>
                ) : (
                  <button
                    className="rounded-xl bg-mint px-4 py-2 font-semibold text-basalt shadow-glow transition-all hover:scale-[1.01] disabled:opacity-50"
                    onClick={handleStart}
                    disabled={starting || !activeProfile}
                  >
                    {launchLabel}
                  </button>
                )}
                <button
                  className="pill transition hover:border-white/20"
                  onClick={() => window.bridge.openFolder()}
                >
                  Open server folder
                </button>
              </div>
            </header>

            {downloadPct !== null && (
              <div className="card border border-mint/30">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm text-slate">Downloading server jar</p>
                  <span className="font-semibold text-mint">{downloadPct}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/5">
                  <div
                    className="h-full bg-gradient-to-r from-mint to-amber transition-all"
                    style={{ width: `${downloadPct}%` }}
                  />
                </div>
              </div>
            )}

            {error && <div className="card border border-red-500/50 text-red-200">{error}</div>}

            <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
              {liveStats.map((item) => (
                <div key={item.label} className="card min-w-0">
                  <p className="text-xs uppercase tracking-wide text-slate/70">{item.label}</p>
                  <p className="mt-1 text-xl font-semibold text-white">{item.value}</p>
                </div>
              ))}
            </div>

            <div
              className={`grid gap-4 ${
                activeTab === "terminal"
                  ? "grid-cols-1"
                  : activeTab === "mods"
                    ? "grid-cols-1"
                    : "2xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]"
              } ${activeTab === "chat" ? "hidden" : ""}`}
            >
              {activeTab === "settings" && (
                <>
                <div className="card min-w-0">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate/70">Launch settings</p>
                    <p className="text-lg font-semibold text-white">
                      {activeProfile?.name || "Select a server"}
                    </p>
                    <p className="mt-1 text-sm text-slate/70">
                      These values control how the server starts from LMCD.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="rounded-lg border border-white/10 bg-obsidian px-3 py-1 text-xs text-slate hover:border-mint/40 disabled:opacity-50"
                      onClick={handleSaveLaunchSettings}
                      disabled={!activeProfile || savingLaunchSettings}
                    >
                      {savingLaunchSettings ? "Saving..." : "Save launch settings"}
                    </button>
                    <span className="pill text-amber">
                      {activeSoftware?.shortLabel || "No runtime"} {activeProfile?.version || "No version"}
                    </span>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <label className="block text-sm text-slate/80">
                    Min RAM (MB)
                    <input
                      inputMode="numeric"
                      className="mt-1 w-full rounded-lg border border-white/10 bg-obsidian px-3 py-2 text-white"
                      value={launchDraft.minMem}
                      onChange={(event) =>
                        setLaunchDraft((prev) => ({ ...prev, minMem: event.target.value }))
                      }
                    />
                  </label>
                  <label className="block text-sm text-slate/80">
                    Max RAM (MB)
                    <input
                      inputMode="numeric"
                      className="mt-1 w-full rounded-lg border border-white/10 bg-obsidian px-3 py-2 text-white"
                      value={launchDraft.maxMem}
                      onChange={(event) =>
                        setLaunchDraft((prev) => ({ ...prev, maxMem: event.target.value }))
                      }
                    />
                  </label>
                  <label className="block text-sm text-slate/80">
                    Server Port
                    <input
                      inputMode="numeric"
                      className="mt-1 w-full rounded-lg border border-white/10 bg-obsidian px-3 py-2 text-white"
                      value={launchDraft.port}
                      onChange={(event) =>
                        setLaunchDraft((prev) => ({ ...prev, port: event.target.value }))
                      }
                    />
                  </label>
                  <label className="block text-sm text-slate/80">
                    Idle Shutdown (min)
                    <input
                      inputMode="numeric"
                      className="mt-1 w-full rounded-lg border border-white/10 bg-obsidian px-3 py-2 text-white"
                      value={launchDraft.idleShutdownMinutes}
                      onChange={(event) =>
                        setLaunchDraft((prev) => ({
                          ...prev,
                          idleShutdownMinutes: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>

                <div className="mt-4 rounded-2xl border border-white/10 bg-black/15 p-4">
                  <div className="grid gap-2 text-sm text-slate/75 sm:grid-cols-2 xl:grid-cols-3">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-slate/55">Runtime</p>
                      <p className="mt-1 font-semibold text-white">
                        {activeSoftware?.label || "No runtime"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-slate/55">Version</p>
                      <p className="mt-1 font-semibold text-white">{activeProfile?.version || "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-slate/55">Preset</p>
                      <p className="mt-1 font-semibold text-white">{activePreset?.label || "-"}</p>
                    </div>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-white/10 bg-black/10 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-semibold text-white">Network diagnostics</p>
                    <button
                      type="button"
                      className="rounded-lg border border-white/10 bg-obsidian px-3 py-1 text-xs text-slate hover:border-mint/40 disabled:opacity-50"
                      onClick={() => activeProfile && loadDiagnostics(activeProfile.id)}
                      disabled={!activeProfile || networkBusy}
                    >
                      {networkBusy ? "Checking..." : "Refresh"}
                    </button>
                  </div>
                  {!networkDiagnostics ? (
                    <p className="text-xs text-slate/60">No diagnostics loaded yet.</p>
                  ) : networkDiagnostics.mode === "remote" ? (
                    <div className="space-y-1 text-xs text-slate/70">
                      <p>{networkDiagnostics.summary}</p>
                      <p>Host: {networkDiagnostics.host}</p>
                      <p>RCON Port: {networkDiagnostics.rconPort}</p>
                      <p>Reachable: {networkDiagnostics.reachable ? "Yes" : "No"}</p>
                    </div>
                  ) : (
                    <div className="space-y-1 text-xs text-slate/70">
                      <p>{networkDiagnostics.summary}</p>
                      <p>Bind: {networkDiagnostics.bindIp}</p>
                      <p>Public endpoint: {networkDiagnostics.publicEndpoint}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded-lg border border-mint/30 px-2 py-1 text-xs text-mint hover:bg-mint hover:text-basalt disabled:opacity-50"
                          onClick={handleUpnpMap}
                          disabled={networkBusy}
                        >
                          UPnP map
                        </button>
                        <button
                          type="button"
                          className="rounded-lg border border-white/10 px-2 py-1 text-xs text-slate hover:border-white/20 disabled:opacity-50"
                          onClick={handleUpnpUnmap}
                          disabled={networkBusy}
                        >
                          UPnP unmap
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-4 rounded-2xl border border-white/10 bg-black/10 p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-white">Storage maintenance</p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded-lg border border-white/10 bg-obsidian px-3 py-1 text-xs text-slate hover:border-mint/40 disabled:opacity-50"
                        onClick={() => activeProfile && loadStorageReport(activeProfile.id)}
                        disabled={!activeProfile || storageBusy}
                      >
                        {storageBusy ? "Working..." : "Refresh"}
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-mint/30 px-3 py-1 text-xs text-mint hover:bg-mint hover:text-basalt disabled:opacity-50"
                        onClick={handleRunStorageCleanup}
                        disabled={!activeProfile || storageBusy}
                      >
                        Run cleanup
                      </button>
                    </div>
                  </div>
                  {!storageReport ? (
                    <p className="text-xs text-slate/60">No storage report loaded yet.</p>
                  ) : (
                    <div className="grid gap-2 text-xs text-slate/70 sm:grid-cols-2">
                      <p>
                        Jars: {formatStorageSize(storageReport.jarsBytes)} ({storageReport.jarCount})
                      </p>
                      <p>
                        Backups: {formatStorageSize(storageReport.backupsBytes)} ({storageReport.backupCount})
                      </p>
                      <p>
                        Logs: {formatStorageSize(storageReport.logsBytes)}
                      </p>
                      <p>
                        Mods/Plugins: {formatStorageSize(storageReport.addonsBytes)} ({storageReport.addonCount})
                      </p>
                      <p className="sm:col-span-2 font-semibold text-white">
                        Total tracked: {formatStorageSize(storageReport.totalBytes)}
                      </p>
                    </div>
                  )}
                  {storageCleanup && (
                    <p className="mt-2 text-xs text-slate/65">
                      Last cleanup removed {storageCleanup.removed.jars} jar(s),{" "}
                      {storageCleanup.removed.backups} backup(s), {storageCleanup.removed.logs} log
                      file(s) totaling {formatStorageSize(storageCleanup.removed.bytes)}.
                    </p>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  {running ? (
                    <button
                      className="rounded-xl bg-red-500/90 px-4 py-2 font-semibold text-white transition-colors hover:bg-red-400"
                      onClick={handleStop}
                      disabled={starting}
                    >
                      Stop Server
                    </button>
                  ) : (
                    <button
                      className="rounded-xl bg-mint px-4 py-2 font-semibold text-basalt shadow-glow transition-all hover:scale-[1.01] disabled:opacity-50"
                      onClick={handleStart}
                      disabled={starting || !activeProfile}
                    >
                      {launchLabel}
                    </button>
                  )}
                  <button
                    className="rounded-xl border border-transparent bg-white/5 px-3 py-2 text-slate hover:border-white/15"
                    onClick={handleStop}
                    disabled={!running}
                  >
                    Soft stop
                  </button>
                </div>
              </div>

              <div className="card min-w-0">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate/70">Server profile</p>
                    <p className="text-lg font-semibold text-white">Name, MOTD, and player limits</p>
                    <p className="mt-1 text-sm text-slate/70">
                      These fields stay editable. Save writes them into the server profile.
                    </p>
                  </div>
                  <button
                    className="rounded-lg border border-white/10 bg-obsidian px-3 py-1 text-slate hover:border-mint/40"
                    onClick={handleSaveProps}
                    disabled={savingProps || !activeProfile}
                  >
                    {savingProps ? "Saving..." : "Save"}
                  </button>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm text-slate/80 md:col-span-2">
                    Server Name
                    <input
                      type="text"
                      className="mt-1 w-full rounded-lg border border-white/10 bg-obsidian px-3 py-2 text-white"
                      value={propertyDraft.name}
                      onChange={(event) =>
                        setPropertyDraft((prev) => ({ ...prev, name: event.target.value }))
                      }
                    />
                  </label>
                  <label className="block text-sm text-slate/80 md:col-span-2">
                    MOTD
                    <input
                      type="text"
                      className="mt-1 w-full rounded-lg border border-white/10 bg-obsidian px-3 py-2 text-white"
                      value={propertyDraft.motd}
                      onChange={(event) =>
                        setPropertyDraft((prev) => ({ ...prev, motd: event.target.value }))
                      }
                    />
                  </label>
                  <label className="block text-sm text-slate/80">
                    Max Players
                    <input
                      inputMode="numeric"
                      className="mt-1 w-full rounded-lg border border-white/10 bg-obsidian px-3 py-2 text-white"
                      value={propertyDraft.maxPlayers}
                      onChange={(event) =>
                        setPropertyDraft((prev) => ({ ...prev, maxPlayers: event.target.value }))
                      }
                    />
                  </label>
                  <label className="block text-sm text-slate/80">
                    View Distance
                    <input
                      inputMode="numeric"
                      className="mt-1 w-full rounded-lg border border-white/10 bg-obsidian px-3 py-2 text-white"
                      value={propertyDraft.viewDistance}
                      onChange={(event) =>
                        setPropertyDraft((prev) => ({ ...prev, viewDistance: event.target.value }))
                      }
                    />
                  </label>
                  <label className="block text-sm text-slate/80">
                    Simulation Distance
                    <input
                      inputMode="numeric"
                      className="mt-1 w-full rounded-lg border border-white/10 bg-obsidian px-3 py-2 text-white"
                      value={propertyDraft.simulationDistance}
                      onChange={(event) =>
                        setPropertyDraft((prev) => ({
                          ...prev,
                          simulationDistance: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <div className="rounded-2xl border border-white/10 bg-black/15 p-4 text-sm text-slate/75">
                    <div className="flex flex-wrap gap-2">
                      <span className="pill text-amber">{activeSoftware?.label || "-"}</span>
                      <span className="pill">{activeProfile?.version || "-"}</span>
                    </div>
                    <p className="mt-3 text-xs text-slate/60">
                      {activeSoftware?.note || "Choose a server to see runtime notes."}
                    </p>
                  </div>
                  <label className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/10 px-4 py-3 text-sm text-slate/80 md:col-span-2">
                    <div>
                      <p className="font-semibold text-white">Whitelist</p>
                      <p className="text-xs text-slate/60">
                        Keep this on if you only want approved players joining.
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={propertyDraft.whitelist}
                      onChange={(event) =>
                        setPropertyDraft((prev) => ({ ...prev, whitelist: event.target.checked }))
                      }
                    />
                  </label>
                  <label className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/10 px-4 py-3 text-sm text-slate/80 md:col-span-2">
                    <div>
                      <p className="font-semibold text-white">Allow Flight</p>
                      <p className="text-xs text-slate/60">
                        Disabled automatically when cheat guard is active.
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={propertyDraft.allowFlight}
                      disabled={Boolean(activeProfile?.cheatLock)}
                      onChange={(event) =>
                        setPropertyDraft((prev) => ({
                          ...prev,
                          allowFlight: event.target.checked,
                        }))
                      }
                    />
                  </label>
                </div>
              </div>
                </>
              )}

              <div className="grid gap-4">
              {activeTab === "terminal" && (
                <div className="card min-w-0 flex min-h-[24rem] flex-col xl:min-h-[32rem] 2xl:min-h-[38rem]">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm text-slate/80">Live console</p>
                  <span className="pill">stdout</span>
                </div>
                <div className="relative flex-1 min-h-0 overflow-hidden rounded-xl border border-white/5 bg-black/40 p-3">
                  <div
                    ref={consoleRef}
                    className="h-full overflow-y-auto font-mono text-xs leading-relaxed text-slate"
                  >
                    {logs.map((line, index) => (
                      <div key={`${line}-${index}`} className="whitespace-pre-wrap text-slate/90">
                        {line}
                      </div>
                    ))}
                  </div>
                </div>
                <form onSubmit={handleCommand} className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    className="min-w-0 flex-1 rounded-lg border border-white/10 bg-obsidian px-3 py-2 text-white"
                    placeholder={
                      activeProfile?.cheatLock
                        ? "Cheat guard on: safe commands only (list, say, save-all, stop...)"
                        : "Type any server command"
                    }
                    value={command}
                    onChange={(event) => setCommand(event.target.value)}
                  />
                  <button
                    type="submit"
                    className="rounded-lg border border-mint/40 bg-obsidian px-3 py-2 text-mint transition hover:bg-mint hover:text-basalt sm:shrink-0"
                  >
                    Send
                  </button>
                </form>
              </div>
              )}

              {(activeTab === "settings" || activeTab === "mods") && (
                <div className="min-w-0 space-y-4 2xl:col-span-2">
                {activeTab === "settings" && (
                  <div className="card min-w-0 space-y-4">
                  <div>
                    <p className="text-sm text-slate/80">World rules</p>
                    <p className="mt-1 text-xs text-slate/60">
                      First successful launch locks the preset and cheat guard for that world.
                    </p>
                    {activeProfile?.cheatLock ? (
                      <p className="mt-2 text-xs text-mint">
                        Cheat guard is permanent for this server once enabled.
                      </p>
                    ) : (
                      <p className="mt-2 text-xs text-red-200">
                        Cheat guard is off. This world is not protected against unsafe admin commands.
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    {MODE_PRESET_OPTIONS.map((preset) => {
                      const selected = activeProfile?.modePreset === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                            selected
                              ? "border-mint/60 bg-white/5"
                              : "border-white/10 bg-white/0 hover:border-white/25"
                          } ${rulesLocked ? "cursor-default" : ""}`}
                          onClick={() => handleRuleChange({ modePreset: preset.id })}
                          disabled={!activeProfile || rulesLocked || savingRules}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-white">{preset.label}</span>
                            {selected && <span className="pill text-mint">Active</span>}
                          </div>
                          <p className="mt-1 text-xs text-slate/70">{preset.description}</p>
                        </button>
                      );
                    })}
                  </div>

                  <label className="flex items-center justify-between rounded-xl border border-white/10 bg-black/10 px-3 py-3 text-sm text-slate/80">
                    <div>
                      <p className="font-semibold text-white">Cheat guard</p>
                      <p className="text-xs text-slate/60">
                        Restricts unsafe console commands and hard-forces safe property values.
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={Boolean(activeProfile?.cheatLock)}
                      disabled={
                        !activeProfile || rulesLocked || savingRules || Boolean(activeProfile?.cheatLock)
                      }
                      onChange={(event) => handleRuleChange({ cheatLock: event.target.checked })}
                    />
                  </label>

                  <div className="space-y-2 text-sm text-slate/80">
                    <div className="flex items-center justify-between">
                      <span>Rule lock</span>
                      <span className="pill">{rulesLocked ? "Locked" : "Pending first launch"}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Preset</span>
                      <span className="pill">{activePreset?.shortLabel || "-"}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Software</span>
                      <span className="pill">{activeSoftware?.shortLabel || "-"}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Version</span>
                      <span className="pill">{activeProfile?.version || "-"}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Port</span>
                      <span className="pill">{launchDraft.port || "-"}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Server path</span>
                      <span className="max-w-[200px] text-right text-xs text-slate/60">
                        {statusDetails?.path || "Documents/LMCD"}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {SAFE_ACTIONS.map((action) => (
                      <button
                        key={action.command}
                        className="rounded-lg border border-white/10 bg-obsidian px-3 py-2 text-sm text-slate hover:border-mint/40 disabled:opacity-50"
                        onClick={() => handleQuickCommand(action.command)}
                        disabled={!running}
                      >
                        {action.label}
                      </button>
                    ))}
                    <button
                      className="rounded-lg border border-white/10 bg-obsidian px-3 py-2 text-sm text-slate hover:border-amber/40 disabled:opacity-50"
                      onClick={handlePreload}
                      disabled={!activeProfile}
                    >
                      Preload jar
                    </button>
                  </div>

                  <button
                    className="rounded-lg border border-red-500/40 bg-red-500/20 px-3 py-2 text-red-200 disabled:opacity-50"
                    onClick={askDeleteProfile}
                    disabled={!activeProfile}
                  >
                    Delete server
                  </button>

                  <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">Backups</p>
                        <p className="mt-1 text-xs text-slate/60">
                          {getBackupPolicySummary(activeProfile)}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          className="rounded-lg border border-white/10 bg-obsidian px-3 py-2 text-sm text-slate hover:border-white/20 disabled:opacity-50"
                          onClick={() => {
                            void loadBackups();
                          }}
                          disabled={!activeProfile || loadingBackups}
                        >
                          {loadingBackups ? "Refreshing..." : "Refresh backups"}
                        </button>
                        <button
                          className="rounded-lg border border-white/10 bg-obsidian px-3 py-2 text-sm text-slate hover:border-mint/40 disabled:opacity-50"
                          onClick={() => handleCreateBackup("manual")}
                          disabled={!activeProfile || workingBackupId === "create"}
                        >
                          {workingBackupId === "create" ? "Creating..." : "Create backup"}
                        </button>
                      </div>
                    </div>
                    {loadingBackups ? (
                      <div className="rounded-2xl border border-dashed border-white/10 bg-black/10 px-4 py-4 text-sm text-slate/65">
                        Loading backups...
                      </div>
                    ) : backups.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-white/10 bg-black/10 px-4 py-4 text-sm text-slate/65">
                        No backups yet for this server.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {backups.map((backup) => (
                          <div
                            key={backup.id}
                            className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-black/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div>
                              <p className="text-sm font-semibold text-white">
                                {new Date(backup.createdAt).toLocaleString()}
                              </p>
                              <p className="text-xs text-slate/60">
                                {backup.reason} -{" "}
                                {backup.sizeBytes > 0
                                  ? formatAddonSize(backup.sizeBytes)
                                  : "size unknown"}
                              </p>
                            </div>
                            <button
                              className="w-full rounded-lg border border-amber/30 px-3 py-1 text-xs text-amber hover:bg-amber/10 disabled:opacity-50 sm:w-auto sm:shrink-0"
                              onClick={() => handleRestoreBackup(backup.id)}
                              disabled={workingBackupId === backup.id}
                            >
                              {workingBackupId === backup.id ? "Restoring..." : "Restore"}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                )}

                {activeTab === "mods" && (
                  <div className="card min-w-0 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm text-slate/80">{addonState.label}</p>
                      <p className="mt-1 text-xs text-slate/60">{addonState.helperText}</p>
                    </div>
                    <span className="pill">
                      {addonState.kind === "none"
                        ? "No add-ons"
                        : `${addonState.items.length} ${addonState.kind}`}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      className="rounded-lg border border-white/10 bg-obsidian px-3 py-2 text-sm text-slate hover:border-mint/40 disabled:opacity-50"
                      onClick={handlePickAddons}
                      disabled={!addonState.supported || managingAddons}
                    >
                      {managingAddons
                        ? "Working..."
                        : addonState.kind === "plugins"
                          ? "Add plugin jars"
                          : "Add mod jars"}
                    </button>
                    <button
                      className="rounded-lg border border-white/10 bg-obsidian px-3 py-2 text-sm text-slate hover:border-white/20 disabled:opacity-50"
                      onClick={handleOpenAddonFolder}
                      disabled={!addonState.supported}
                    >
                      Open folder
                    </button>
                    <button
                      className="rounded-lg border border-white/10 bg-obsidian px-3 py-2 text-sm text-slate hover:border-white/20 disabled:opacity-50"
                      onClick={() => {
                        void loadAddonState();
                      }}
                      disabled={loadingAddons}
                    >
                      {loadingAddons ? "Refreshing..." : "Refresh"}
                    </button>
                    <button
                      className="rounded-lg border border-mint/30 bg-obsidian px-3 py-2 text-sm text-mint hover:bg-mint hover:text-basalt disabled:opacity-50"
                      onClick={async () => {
                        setManagingAddons(true);
                        try {
                          setAddonState(await window.bridge.checkAddonUpdates());
                        } catch (updateError) {
                          console.error(updateError);
                          setError("Could not check add-on updates.");
                        } finally {
                          setManagingAddons(false);
                        }
                      }}
                      disabled={managingAddons || !addonState.supported}
                    >
                      Check updates
                    </button>
                  </div>

                  <form
                    onSubmit={handleSearchCatalog}
                    className="min-w-0 rounded-2xl border border-white/10 bg-black/10 p-4"
                  >
                    <div className="mb-3">
                      <p className="text-sm font-semibold text-white">Online browser</p>
                      <p className="mt-1 text-xs text-slate/60">
                        Search Modrinth across Fabric + Paper and compare options with details.
                      </p>
                    </div>
                    <div className="flex flex-col gap-2 lg:flex-row">
                      <input
                        type="text"
                        className="min-w-0 flex-1 rounded-lg border border-white/10 bg-obsidian px-3 py-2 text-white"
                        value={catalogQuery}
                        onChange={(event) => setCatalogQuery(event.target.value)}
                        placeholder={
                          addonState.kind === "plugins"
                            ? "Search Paper plugins"
                            : "Search Fabric mods"
                        }
                      />
                      <button
                        type="submit"
                        className="w-full rounded-lg bg-mint px-4 py-2 font-semibold text-basalt disabled:opacity-50 lg:w-auto lg:shrink-0"
                        disabled={loadingCatalog}
                      >
                        {loadingCatalog ? "Searching..." : "Search"}
                      </button>
                    </div>
                    {catalogResults.length > 0 && (
                      <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,0.68fr)_minmax(0,0.32fr)]">
                        <div className="min-w-0 space-y-2">
                          {catalogResults.map((result) => {
                            const selected = selectedCatalog?.projectId === result.projectId;
                            return (
                              <div
                                key={result.projectId}
                                className={`flex flex-col gap-3 rounded-2xl border px-4 py-3 sm:flex-row sm:items-start sm:justify-between ${
                                  selected
                                    ? "border-mint/60 bg-black/25"
                                    : "border-white/10 bg-black/15"
                                }`}
                              >
                                <button
                                  type="button"
                                  className="min-w-0 flex-1 text-left"
                                  onClick={() => {
                                    void handleSelectCatalogResult(result);
                                  }}
                                >
                                  <div className="mb-2 h-24 overflow-hidden rounded-xl border border-white/10 bg-obsidian">
                                    {result.featuredGallery || result.iconUrl ? (
                                      <img
                                        src={result.featuredGallery || result.iconUrl || ""}
                                        alt={result.title}
                                        className="h-full w-full object-contain"
                                        loading="lazy"
                                      />
                                    ) : (
                                      <div className="flex h-full items-center justify-center text-xs text-slate/60">
                                        No preview image
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="break-words text-sm font-semibold text-white">
                                      {result.title}
                                    </p>
                                    <span className="break-words text-xs text-slate/50">
                                      by {result.author}
                                    </span>
                                    <span className="pill text-xs text-mint">
                                      {getCatalogStars(result.downloads, result.follows).toFixed(1)} stars
                                    </span>
                                  </div>
                                  <p className="mt-1 line-clamp-2 text-xs text-slate/65">
                                    {result.description}
                                  </p>
                                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate/50">
                                    <span>{formatDownloads(result.downloads)} downloads</span>
                                    <span>{formatDownloads(result.follows || 0)} follows</span>
                                    <span>{result.projectType || "mod"}</span>
                                  </div>
                                  {(result.categories || []).length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-1">
                                      {result.categories.slice(0, 4).map((category) => (
                                        <span
                                          key={`${result.projectId}-${category}`}
                                          className="badge border border-white/10 bg-obsidian text-slate/80"
                                        >
                                          {category}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </button>
                                <div className="flex w-full flex-col gap-2 sm:w-auto sm:shrink-0">
                                  <button
                                    className="rounded-lg border border-white/20 px-3 py-1 text-xs text-slate hover:border-mint/40"
                                    onClick={() => {
                                      void handleSelectCatalogResult(result);
                                    }}
                                    type="button"
                                  >
                                    Details
                                  </button>
                                  <button
                                    className="rounded-lg border border-mint/30 px-3 py-1 text-xs text-mint hover:bg-mint hover:text-basalt disabled:opacity-50"
                                    onClick={() => handleInstallCatalogAddon(result.projectId)}
                                    disabled={installingProjectId === result.projectId}
                                    type="button"
                                  >
                                    {installingProjectId === result.projectId ? "Installing..." : "Install"}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                          {!selectedCatalog ? (
                            <p className="text-sm text-slate/60">Select a result to view details.</p>
                          ) : (
                            <div className="space-y-3">
                              <div className="flex justify-end">
                                <button
                                  type="button"
                                  className="rounded-lg border border-white/20 px-2 py-1 text-xs text-slate hover:border-mint/40"
                                  onClick={() => setSelectedCatalog(null)}
                                >
                                  Close
                                </button>
                              </div>
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="break-words text-base font-semibold text-white">
                                  {selectedCatalog.title}
                                </p>
                                <span className="pill text-xs text-mint">
                                  {selectedCatalog.projectType || "mod"}
                                </span>
                              </div>
                              <p className="break-words text-xs text-slate/55">
                                by {selectedCatalog.author}
                              </p>
                              <p className="text-xs text-slate/65">
                                {formatDownloads(selectedCatalog.downloads)} downloads -{" "}
                                {formatDownloads(selectedCatalog.follows || 0)} follows
                              </p>
                              {selectedCatalog.dateModified && (
                                <p className="text-xs text-slate/55">
                                  Updated {new Date(selectedCatalog.dateModified).toLocaleString()}
                                </p>
                              )}
                              <div className="max-h-56 overflow-y-auto rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-slate/75">
                                <p className="whitespace-pre-wrap break-words">
                                  {loadingCatalogDetail
                                    ? "Loading full details..."
                                    : selectedCatalog.body ||
                                      selectedCatalog.description ||
                                      "No description available."}
                                </p>
                              </div>
                              {Array.isArray(selectedCatalog.gallery) &&
                                selectedCatalog.gallery.length > 0 && (
                                  <div className="grid grid-cols-2 gap-2">
                                    {selectedCatalog.gallery.slice(0, 4).map((item, index) => (
                                      <div
                                        key={`${selectedCatalog.projectId}-gallery-${index}`}
                                        className="h-20 overflow-hidden rounded-lg border border-white/10 bg-obsidian"
                                      >
                                        <img
                                          src={item.url}
                                          alt={item.title || selectedCatalog.title}
                                          className="h-full w-full object-contain"
                                          loading="lazy"
                                        />
                                      </div>
                                    ))}
                                  </div>
                                )}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </form>

                  <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">Installed {addonState.kind}</p>
                        <p className="mt-1 text-xs text-slate/60">
                          Local jars already in this server folder.
                        </p>
                      </div>
                    </div>
                    {!addonState.supported && (
                      <div className="mb-3 rounded-2xl border border-amber/30 bg-amber/10 px-4 py-3 text-xs text-amber">
                        {addonState.helperText}
                      </div>
                    )}
                    {addonState.items.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-white/10 bg-black/10 px-4 py-4 text-sm text-slate/65">
                        {addonState.supported
                          ? `No ${addonState.kind} added yet.`
                          : "No add-on jars detected in this server profile."}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {addonState.items.map((item) => (
                          <div
                            key={item.name}
                            className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-black/10 px-5 py-4 sm:flex-row sm:items-start sm:justify-between"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="truncate text-base font-semibold text-white">
                                  {item.displayName || item.name}
                                </p>
                                <span className="pill text-xs">{item.version || "unknown version"}</span>
                                <span className={`pill text-xs ${item.valid ? "text-mint" : "text-red-200"}`}>
                                  {item.valid ? "Metadata OK" : "Metadata missing"}
                                </span>
                              </div>
                              {item.displayName && item.displayName !== item.name && (
                                <p className="mt-1 truncate text-xs text-slate/55">File: {item.name}</p>
                              )}
                              <p className="mt-2 line-clamp-3 text-sm text-slate/70">
                                {item.description || "No description available."}
                              </p>
                              <p className="mt-2 text-xs text-slate/60">
                                {item.projectId
                                  ? item.updateAvailable
                                    ? "Update available"
                                    : "Up to date"
                                  : "Update unknown (manual jar)"}
                              </p>
                              <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate/60">
                                <span>{formatAddonSize(item.sizeBytes)}</span>
                                <span>{new Date(item.updatedAt).toLocaleString()}</span>
                              </div>
                            </div>
                            <button
                              className="w-full rounded-lg border border-red-500/30 px-3 py-1 text-xs text-red-200 hover:bg-red-500/10 sm:w-auto sm:shrink-0"
                              onClick={() => handleRemoveAddon(item.name)}
                              disabled={managingAddons}
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                </div>
                )}
              </div>
              )}
            </div>
          </div>
        </div>
      </div>
      </div>

      {activeTab === "chat" && (
        <div className="mx-auto mt-4 w-full max-w-[2200px]">
          <div className="card min-w-0 flex h-[30rem] max-h-[calc(100vh-16rem)] flex-col">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm text-slate/80">Player chat</p>
              <span className="pill">{chatLines.length} lines</span>
            </div>
            <div className="rounded-xl border border-white/5 bg-black/40 p-3">
              <div
                ref={chatRef}
                className="h-[22rem] overflow-y-auto font-mono text-xs leading-relaxed text-slate"
              >
                {chatLines.length === 0 ? (
                  <p className="text-slate/60">
                    No chat messages yet. Chat stays fixed here and scrolls without expanding the
                    page.
                  </p>
                ) : (
                  chatLines.map((line, index) => (
                    <div key={`${line}-${index}`} className="whitespace-pre-wrap text-slate/90">
                      {line}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <form
            className="card max-h-[calc(100vh-2rem)] w-full max-w-3xl space-y-5 overflow-y-auto"
            onSubmit={handleCreateProfile}
          >
            <div>
              <p className="text-xs uppercase tracking-wide text-slate/70">Create server</p>
              <h2 className="text-2xl font-semibold text-white">New Minecraft server</h2>
              <p className="text-sm text-slate/70">
                Choose the server runtime first. Paper is the default because it gives the best
                mix of performance, stability, control, and vanilla gameplay.
              </p>
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
              <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                <div className="mb-3">
                  <p className="text-sm font-semibold text-white">Server identity</p>
                  <p className="text-xs text-slate/60">
                    These are the basics you will actually see in the app and in Minecraft.
                  </p>
                </div>
                <div className="grid gap-4">
                  <label className="block text-sm text-slate/80">
                    Server Name
                    <input
                      type="text"
                      className="mt-1 w-full rounded-lg border border-white/10 bg-obsidian px-3 py-2 text-white"
                      value={createDraft.name}
                      onChange={(event) =>
                        setCreateDraft((prev) => ({ ...prev, name: event.target.value }))
                      }
                      placeholder="My Hardcore Server"
                      autoFocus
                    />
                  </label>
                  <label className="block text-sm text-slate/80">
                    MOTD
                    <input
                      type="text"
                      className="mt-1 w-full rounded-lg border border-white/10 bg-obsidian px-3 py-2 text-white"
                      value={createDraft.motd}
                      onChange={(event) =>
                        setCreateDraft((prev) => ({ ...prev, motd: event.target.value }))
                      }
                      placeholder={DEFAULT_MOTD}
                    />
                  </label>
                  <label className="block text-sm text-slate/80">
                    Profile Type
                    <select
                      className="mt-1 w-full rounded-lg border border-white/10 bg-obsidian px-3 py-2 text-white"
                      value={createDraft.profileType}
                      onChange={(event) =>
                        setCreateDraft((prev) => ({
                          ...prev,
                          profileType: event.target.value === "remote" ? "remote" : "local",
                        }))
                      }
                    >
                      <option value="local">Local hosted</option>
                      <option value="remote">Remote managed (RCON)</option>
                    </select>
                  </label>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                <div className="mb-3">
                  <p className="text-sm font-semibold text-white">Runtime and version</p>
                  <p className="text-xs text-slate/60">
                    Pick the server software first, then choose one of its supported versions.
                  </p>
                </div>
                <div className="space-y-3">
                  {SERVER_SOFTWARE_OPTIONS.map((software) => (
                    <button
                      key={software.id}
                      type="button"
                      className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                        createDraft.serverSoftware === software.id
                          ? "border-mint/60 bg-white/5"
                          : "border-white/10 bg-white/0 hover:border-white/25"
                      }`}
                      onClick={() =>
                        setCreateDraft((prev) => ({ ...prev, serverSoftware: software.id }))
                      }
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-white">{software.label}</p>
                          <p className="mt-1 text-xs text-slate/70">{software.description}</p>
                        </div>
                        {software.id === "paper" && (
                          <span className="pill shrink-0 whitespace-nowrap text-mint">
                            Recommended
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                  <label className="block text-sm text-slate/80">
                    Minecraft Version
                    <select
                      className="mt-1 w-full rounded-lg border border-white/10 bg-obsidian px-3 py-2 text-white"
                      value={createDraft.version}
                      onChange={(event) =>
                        setCreateDraft((prev) => ({ ...prev, version: event.target.value }))
                      }
                      disabled={loadingVersionOptions}
                    >
                      {versionChoices.map((version) => (
                        <option key={version} value={version}>
                          {version}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-slate/60">
                      {loadingVersionOptions
                        ? "Loading supported versions..."
                        : `${SERVER_SOFTWARE_MAP[createDraft.serverSoftware].label} only shows versions supported by its official server runtime.`}
                    </p>
                  </label>
                </div>
              </div>
            </div>

            {createDraft.profileType === "local" ? (
              <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                <div className="mb-3">
                  <p className="text-sm font-semibold text-white">Local launch defaults</p>
                  <p className="text-xs text-slate/60">
                    These values are saved per profile and reused for starts.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <label className="block text-sm text-slate/80">
                    Min RAM (MB)
                    <input
                      inputMode="numeric"
                      className="mt-1 w-full rounded-lg border border-white/10 bg-obsidian px-3 py-2 text-white"
                      value={createDraft.minMem}
                      onChange={(event) =>
                        setCreateDraft((prev) => ({ ...prev, minMem: event.target.value }))
                      }
                    />
                  </label>
                  <label className="block text-sm text-slate/80">
                    Max RAM (MB)
                    <input
                      inputMode="numeric"
                      className="mt-1 w-full rounded-lg border border-white/10 bg-obsidian px-3 py-2 text-white"
                      value={createDraft.maxMem}
                      onChange={(event) =>
                        setCreateDraft((prev) => ({ ...prev, maxMem: event.target.value }))
                      }
                    />
                  </label>
                  <label className="block text-sm text-slate/80">
                    Port
                    <input
                      inputMode="numeric"
                      className="mt-1 w-full rounded-lg border border-white/10 bg-obsidian px-3 py-2 text-white"
                      value={createDraft.port}
                      onChange={(event) =>
                        setCreateDraft((prev) => ({ ...prev, port: event.target.value }))
                      }
                    />
                  </label>
                  <label className="block text-sm text-slate/80">
                    Idle shutdown (min)
                    <input
                      inputMode="numeric"
                      className="mt-1 w-full rounded-lg border border-white/10 bg-obsidian px-3 py-2 text-white"
                      value={createDraft.idleShutdownMinutes}
                      onChange={(event) =>
                        setCreateDraft((prev) => ({
                          ...prev,
                          idleShutdownMinutes: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                <div className="mb-3">
                  <p className="text-sm font-semibold text-white">Remote connection</p>
                  <p className="text-xs text-slate/60">
                    RCON-only mode with optional wake command hooks.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm text-slate/80">
                    Host
                    <input
                      type="text"
                      className="mt-1 w-full rounded-lg border border-white/10 bg-obsidian px-3 py-2 text-white"
                      value={createDraft.host}
                      onChange={(event) =>
                        setCreateDraft((prev) => ({ ...prev, host: event.target.value }))
                      }
                      placeholder="mc12.argoisten.com"
                    />
                  </label>
                  <label className="block text-sm text-slate/80">
                    Public Host (optional)
                    <input
                      type="text"
                      className="mt-1 w-full rounded-lg border border-white/10 bg-obsidian px-3 py-2 text-white"
                      value={createDraft.publicHost}
                      onChange={(event) =>
                        setCreateDraft((prev) => ({ ...prev, publicHost: event.target.value }))
                      }
                    />
                  </label>
                  <label className="block text-sm text-slate/80">
                    RCON Port
                    <input
                      inputMode="numeric"
                      className="mt-1 w-full rounded-lg border border-white/10 bg-obsidian px-3 py-2 text-white"
                      value={createDraft.rconPort}
                      onChange={(event) =>
                        setCreateDraft((prev) => ({ ...prev, rconPort: event.target.value }))
                      }
                    />
                  </label>
                  <label className="block text-sm text-slate/80">
                    RCON Password
                    <input
                      type="password"
                      className="mt-1 w-full rounded-lg border border-white/10 bg-obsidian px-3 py-2 text-white"
                      value={createDraft.password}
                      onChange={(event) =>
                        setCreateDraft((prev) => ({ ...prev, password: event.target.value }))
                      }
                    />
                  </label>
                  <label className="block text-sm text-slate/80">
                    Wake Timeout (sec)
                    <input
                      inputMode="numeric"
                      className="mt-1 w-full rounded-lg border border-white/10 bg-obsidian px-3 py-2 text-white"
                      value={createDraft.wakeTimeoutSec}
                      onChange={(event) =>
                        setCreateDraft((prev) => ({ ...prev, wakeTimeoutSec: event.target.value }))
                      }
                    />
                  </label>
                  <label className="block text-sm text-slate/80">
                    Connect Timeout (sec)
                    <input
                      inputMode="numeric"
                      className="mt-1 w-full rounded-lg border border-white/10 bg-obsidian px-3 py-2 text-white"
                      value={createDraft.connectTimeoutSec}
                      onChange={(event) =>
                        setCreateDraft((prev) => ({
                          ...prev,
                          connectTimeoutSec: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="block text-sm text-slate/80 sm:col-span-2">
                    Wake Command (optional)
                    <input
                      type="text"
                      className="mt-1 w-full rounded-lg border border-white/10 bg-obsidian px-3 py-2 text-white"
                      value={createDraft.wakeCommand}
                      onChange={(event) =>
                        setCreateDraft((prev) => ({ ...prev, wakeCommand: event.target.value }))
                      }
                      placeholder="powershell -File wake-server.ps1"
                    />
                  </label>
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
              <div className="mb-3">
                <p className="text-sm font-semibold text-white">World preset</p>
                <p className="text-xs text-slate/60">
                  This decides the locked world rules before the first launch.
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                {MODE_PRESET_OPTIONS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={`rounded-2xl border px-4 py-4 text-left transition ${
                      createDraft.modePreset === preset.id
                        ? "border-mint/60 bg-white/5"
                        : "border-white/10 bg-white/0 hover:border-white/25"
                    }`}
                    onClick={() =>
                      setCreateDraft((prev) => ({ ...prev, modePreset: preset.id }))
                    }
                  >
                    <p className="font-semibold text-white">{preset.label}</p>
                    <p className="mt-1 text-xs text-slate/70">{preset.description}</p>
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/10 px-4 py-4 text-sm text-slate/80">
              <div>
                <p className="font-semibold text-white">Cheat guard</p>
                <p className="text-xs text-slate/60">
                  On by default. Once enabled for a server, it cannot be turned off later.
                </p>
              </div>
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={createDraft.cheatLock}
                onChange={(event) =>
                  setCreateDraft((prev) => ({ ...prev, cheatLock: event.target.checked }))
                }
              />
            </label>

            {!createDraft.cheatLock && (
              <div className="rounded-2xl border border-red-500/40 bg-red-500/15 px-4 py-3 text-sm text-red-100">
                Cheat guard is off for this server. LMCD will show it as unprotected and allow
                broader admin changes.
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-slate"
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-mint px-4 py-2 font-semibold text-basalt"
                disabled={loadingVersionOptions || versionChoices.length === 0}
              >
                Create server
              </button>
            </div>
          </form>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-lg space-y-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-red-200/80">Delete server</p>
              <h2 className="text-2xl font-semibold text-white">Are you sure?</h2>
              <p className="text-sm text-slate/70">
                This removes the server entry and its files from disk. Type{" "}
                <span className="font-semibold text-white">{deleteTarget.name}</span> to confirm.
              </p>
            </div>
            <input
              type="text"
              className="w-full rounded-lg border border-red-500/30 bg-obsidian px-3 py-2 text-white"
              value={deleteText}
              onChange={(event) => setDeleteText(event.target.value)}
              placeholder={deleteTarget.name}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-slate"
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteText("");
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-lg bg-red-500 px-4 py-2 font-semibold text-white disabled:opacity-50"
                onClick={handleDeleteProfile}
                disabled={!deleteMatches}
              >
                Delete server
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;


