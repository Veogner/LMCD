import React, { useEffect, useMemo, useRef, useState } from "react";
import "./index.css";
import type {
  AddonState,
  BackupEntry,
  CatalogResult,
  ModePreset,
  Profile,
  ServerSoftware,
  ServerStartOptions,
  ServerStats,
} from "./types";

const APP_NAME = "LMCD";
const APP_RELEASE_TAG = "1m26c1ea";
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
    description: "One life, hard difficulty, survival mode, and cheat guard meant to stay locked.",
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

const PAPER_PROTECTION_PACK_ID = "__paper-protection-pack__";

const PAPER_PROTECTION_RECOMMENDATIONS = [
  {
    projectId: "LJNGWSvH",
    label: "GrimAC",
    tag: "Anti-cheat",
    description: "Main Paper anti-cheat layer for movement, combat, and common exploit checks.",
    note: "Use this as the baseline server-side anti-cheat on Paper.",
    matchers: ["grimac", "grim"],
  },
  {
    projectId: "urbcIOmx",
    label: "Simple AntiFreecam",
    tag: "Freecam",
    description: "Adds server-side checks aimed at blocking freecam-style interaction and peeking.",
    note: "Useful if you want a direct anti-freecam layer on top of the main anti-cheat.",
    matchers: ["simple-antifreecam", "antifreecam", "freecam"],
  },
  {
    projectId: "ppEJeZTE",
    label: "Mod Detector",
    tag: "Client mods",
    description: "Detects clients that announce blocked mods and can kick them automatically.",
    note: "Best-effort only. No Paper plugin can reliably detect every client-side mod.",
    matchers: ["mod-detector", "moddetector"],
  },
] as const;

const defaultOptions: Required<ServerStartOptions> = {
  minMem: 2048,
  maxMem: 4096,
  port: 25565,
  motd: DEFAULT_MOTD,
  viewDistance: 12,
  simulationDistance: 10,
  maxPlayers: 8,
  version: DEFAULT_VERSION,
  serverSoftware: DEFAULT_SERVER_SOFTWARE,
};

type CreateDraft = {
  name: string;
  version: string;
  motd: string;
  serverSoftware: ServerSoftware;
  modePreset: ModePreset;
  cheatLock: boolean;
};

type LaunchDraft = {
  minMem: string;
  maxMem: string;
  port: string;
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
  version: DEFAULT_VERSION,
  motd: DEFAULT_MOTD,
  serverSoftware: DEFAULT_SERVER_SOFTWARE,
  modePreset: "hardcore" as ModePreset,
  cheatLock: true,
};

type StatusDetails = {
  running?: boolean;
  downloading?: boolean;
  path?: string;
  port?: number;
  profile?: string;
  version?: string;
  serverSoftware?: ServerSoftware;
  modePreset?: ModePreset;
  cheatLock?: boolean;
  rulesLocked?: boolean;
};

const emptyLaunchDraft: LaunchDraft = {
  minMem: String(defaultOptions.minMem),
  maxMem: String(defaultOptions.maxMem),
  port: String(defaultOptions.port),
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
    : "vanilla";

const normalizeProfiles = (list: Profile[]) =>
  (list || []).map((profile, index) => ({
    id: profile.id || `server-${index + 1}`,
    name: profile.name || `Server ${index + 1}`,
    version: profile.version || DEFAULT_VERSION,
    motd: profile.motd || DEFAULT_MOTD,
    serverSoftware: normalizeServerSoftware(profile.serverSoftware),
    modePreset: normalizeModePreset(profile.modePreset),
    cheatLock: profile.cheatLock !== false,
    rulesLocked: Boolean(profile.rulesLocked),
  }));

const makeProfileId = (name: string) =>
  `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "server"}-${Date.now()}`;

const createLaunchDraft = (
  loadedOptions: Required<ServerStartOptions>,
  nextProps: Record<string, string>,
): LaunchDraft => ({
  minMem: String(loadedOptions.minMem),
  maxMem: String(loadedOptions.maxMem),
  port: String(nextProps["server-port"] || loadedOptions.port),
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

const formatAddonSize = (sizeBytes: number) => {
  if (sizeBytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
  }
  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
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

const hasMatchingAddon = (
  items: Array<{ name: string }>,
  matchers: readonly string[],
) => {
  const loweredMatchers = matchers.map((matcher) => matcher.toLowerCase());
  return items.some((item) => {
    const fileName = item.name.toLowerCase();
    return loweredMatchers.some((matcher) => fileName.includes(matcher));
  });
};

function App() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [options, setOptions] = useState(defaultOptions);
  const [properties, setProperties] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [stats, setStats] = useState<ServerStats | null>(null);
  const [starting, setStarting] = useState(false);
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
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [installingProjectId, setInstallingProjectId] = useState<string | null>(null);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [workingBackupId, setWorkingBackupId] = useState<string | null>(null);
  const consoleRef = useRef<HTMLDivElement | null>(null);

  const activeProfile = profiles.find((profile) => profile.id === activeId) || null;
  const activePreset = activeProfile ? MODE_PRESET_MAP[activeProfile.modePreset] : null;
  const activeSoftware = activeProfile
    ? SERVER_SOFTWARE_MAP[activeProfile.serverSoftware]
    : null;
  const preloadSoftware = activeSoftware || SERVER_SOFTWARE_MAP[DEFAULT_SERVER_SOFTWARE];
  const rulesLocked = Boolean(activeProfile?.rulesLocked);
  const deleteMatches = deleteTarget ? deleteText.trim() === deleteTarget.name : false;
  const versionChoices = versionOptions.length > 0 ? versionOptions : FALLBACK_VERSION_PRESETS;
  const canShowPaperProtection = addonState.runtime === "paper" && addonState.supported;
  const protectionPackInstalled = canShowPaperProtection
    ? PAPER_PROTECTION_RECOMMENDATIONS.every((tool) =>
        hasMatchingAddon(addonState.items, tool.matchers),
      )
    : false;

  const isProtectionInstalled = (matchers: readonly string[]) =>
    hasMatchingAddon(addonState.items, matchers);

  const applyLoadedProfile = (profile: Profile, nextProps: Record<string, string>) => {
    const nextOptions = {
      ...defaultOptions,
      ...options,
      port: Number(nextProps["server-port"] || defaultOptions.port),
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
    setLaunchDraft(createLaunchDraft(nextOptions, nextProps));
    setPropertyDraft(createPropertyDraft(profile, nextProps));
  };

  const loadProfileState = async (profile: Profile) => {
    await window.bridge.setProfile(profile);
    const nextProps = await window.bridge.readProps();
    applyLoadedProfile(profile, nextProps);
  };

  const loadAddonState = async () => {
    setLoadingAddons(true);
    try {
      setAddonState(await window.bridge.listAddons());
    } catch (addonError) {
      console.error(addonError);
      setError("Could not load mods or plugins for this server.");
    } finally {
      setLoadingAddons(false);
    }
  };

  const loadBackups = async () => {
    setLoadingBackups(true);
    try {
      setBackups(await window.bridge.listBackups());
    } catch (backupError) {
      console.error(backupError);
      setError("Could not load backups for this server.");
    } finally {
      setLoadingBackups(false);
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
    if (!activeProfile) {
      setProperties({});
      setOptions(defaultOptions);
      setRunning(false);
      setStats(null);
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
      setCatalogQuery("");
      return;
    }

    const loadProfile = async () => {
      try {
        setError(null);
        setCatalogResults([]);
        await loadProfileState(activeProfile);
        await loadAddonState();
        await loadBackups();
      } catch (err) {
        console.error(err);
        setError("Could not load the selected server.");
      }
    };

    loadProfile();
  }, [activeId]);

  useEffect(() => {
    const unsubLog = window.bridge.onLog((line) => {
      setLogs((prev) => [...prev, line.replace(/\r?\n$/, "")].slice(-400));
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

      setProfiles((prev) =>
        prev.map((profile) =>
          profile.id === payload.profile
            ? {
                ...profile,
                version: payload.version || profile.version,
                serverSoftware:
                  payload.serverSoftware || profile.serverSoftware,
                modePreset: normalizeModePreset(payload.modePreset || profile.modePreset),
                cheatLock:
                  typeof payload.cheatLock === "boolean" ? payload.cheatLock : profile.cheatLock,
                rulesLocked:
                  typeof payload.rulesLocked === "boolean"
                    ? payload.rulesLocked
                    : profile.rulesLocked,
              }
            : profile,
        ),
      );
    });

    const unsubDownload = window.bridge.onDownload((payload) => {
      setDownloadPct(payload.percent ?? null);
    });

    return () => {
      unsubLog();
      unsubStatus();
      unsubDownload();
    };
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    if (running) {
      const tick = async () => {
        try {
          const nextStats = await window.bridge.getStats();
          setStats(nextStats);
        } catch (err) {
          console.error(err);
        } finally {
          timer = setTimeout(tick, 1200);
        }
      };

      tick();
    }

    return () => {
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [running]);

  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [logs]);

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
        version,
        motd,
        serverSoftware: createDraft.serverSoftware,
        modePreset: createDraft.modePreset,
        cheatLock: createDraft.cheatLock,
        rulesLocked: false,
      };

      await persistProfiles([...profiles, created], created.id);
      setCreateOpen(false);
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Could not create this server.");
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
        setLogs([]);
      }
      setDeleteTarget(null);
      setDeleteText("");
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Could not delete this server.");
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
    } catch (err: any) {
      setError(err?.message || "Could not update the world rules.");
    } finally {
      setSavingRules(false);
    }
  };

  const handleStart = async () => {
    if (!activeProfile) return;
    setStarting(true);
    setError(null);

    try {
      const minMem = clampInteger(launchDraft.minMem, options.minMem, 1024);
      const maxMem = clampInteger(launchDraft.maxMem, options.maxMem, minMem);
      const port = clampInteger(launchDraft.port, options.port, 1024, 65535);
      const nextStartOptions: Required<ServerStartOptions> = {
        ...options,
        minMem,
        maxMem,
        port,
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
      });

      await window.bridge.startServer({
        ...nextStartOptions,
      });
      setRunning(true);
      await loadBackups();
    } catch (err: any) {
      setError(err?.message || "Could not start server.");
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    setStarting(true);
    try {
      await window.bridge.stopServer();
      setRunning(false);
    } catch (err: any) {
      setError(err?.message || "Could not stop server.");
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
    } catch (err: any) {
      setError(err?.message || "Could not save server properties.");
    } finally {
      setSavingProps(false);
    }
  };

  const handleCommand = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!command.trim()) return;

    try {
      await window.bridge.sendCommand(command.trim());
      setLogs((prev) => [...prev, `> ${command.trim()}`].slice(-400));
      setCommand("");
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Command failed.");
    }
  };

  const handleQuickCommand = async (nextCommand: string) => {
    try {
      await window.bridge.sendCommand(nextCommand);
      setLogs((prev) => [...prev, `> ${nextCommand}`].slice(-400));
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Quick action failed.");
    }
  };

  const handlePreload = async () => {
    try {
      setError(null);
      await window.bridge.ensureJar(
        activeProfile?.version || DEFAULT_VERSION,
        activeProfile?.serverSoftware || DEFAULT_SERVER_SOFTWARE,
      );
    } catch (err: any) {
      setError(err?.message || "Could not preload the server jar.");
    }
  };

  const handlePickAddons = async () => {
    setManagingAddons(true);
    setError(null);
    try {
      setAddonState(await window.bridge.pickAddons());
      await loadBackups();
    } catch (err: any) {
      setError(err?.message || "Could not add mod or plugin jars.");
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
    } catch (err: any) {
      setError(err?.message || "Could not remove that add-on.");
    } finally {
      setManagingAddons(false);
    }
  };

  const handleOpenAddonFolder = async () => {
    try {
      await window.bridge.openAddonFolder();
    } catch (err: any) {
      setError(err?.message || "Could not open the add-on folder.");
    }
  };

  const handleSearchCatalog = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const query = catalogQuery.trim();
    if (!query || !addonState.supported) {
      setCatalogResults([]);
      return;
    }

    setLoadingCatalog(true);
    setError(null);
    try {
      setCatalogResults(await window.bridge.searchCatalog(query));
    } catch (err: any) {
      setError(err?.message || "Could not search for add-ons.");
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
    } catch (err: any) {
      setError(err?.message || "Could not install that add-on.");
    } finally {
      setInstallingProjectId(null);
    }
  };

  const handleInstallProtectionPack = async () => {
    if (!canShowPaperProtection) return;

    setInstallingProjectId(PAPER_PROTECTION_PACK_ID);
    setError(null);

    try {
      let nextState = addonState;
      for (const tool of PAPER_PROTECTION_RECOMMENDATIONS) {
        if (hasMatchingAddon(nextState.items, tool.matchers)) {
          continue;
        }
        nextState = await window.bridge.installCatalogAddon(tool.projectId);
      }
      setAddonState(nextState);
      await loadBackups();
    } catch (err: any) {
      setError(err?.message || "Could not install the Paper protection pack.");
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
    } catch (err: any) {
      setError(err?.message || "Could not create a backup.");
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
      }
    } catch (err: any) {
      setError(err?.message || "Could not restore that backup.");
    } finally {
      setWorkingBackupId(null);
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

  return (
    <div className="min-h-screen px-3 pb-6 text-slate sm:px-4 xl:px-6">
      <div className="mx-auto flex min-h-screen w-full max-w-[1800px] flex-col pt-4 sm:pt-5">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center">
            <p className="text-lg font-semibold text-white">{APP_DISPLAY_NAME}</p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button className="pill hover:border-mint/50" onClick={openCreateModal}>
              + New server
            </button>
            <button className="pill hover:border-white/25" onClick={handlePreload}>
              Preload {preloadSoftware.shortLabel} {activeProfile?.version || DEFAULT_VERSION}
            </button>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
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
                      onClick={() => setActiveId(profile.id)}
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

            <div className="grid gap-4 2xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
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
                  <span className="pill text-amber">
                    {activeSoftware?.shortLabel || "No runtime"} {activeProfile?.version || "No version"}
                  </span>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(22rem,0.85fr)]">
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

              <div className="min-w-0 space-y-4">
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
                </div>

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

                  <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-white">Compatibility check</p>
                      <span
                        className={`pill ${
                          addonState.compatibility.ready ? "text-mint" : "text-red-200"
                        }`}
                      >
                        {addonState.compatibility.ready ? "Ready" : "Needs fixes"}
                      </span>
                    </div>
                    <p className="text-xs text-slate/60">{addonState.compatibility.summary}</p>
                    {addonState.compatibility.findings.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {addonState.compatibility.findings.map((finding, index) => (
                          <div
                            key={`${finding.addon}-${finding.message}-${index}`}
                            className={`rounded-xl border px-3 py-2 text-xs ${
                              finding.level === "error"
                                ? "border-red-500/30 bg-red-500/10 text-red-100"
                                : finding.level === "warning"
                                  ? "border-amber/30 bg-amber/10 text-amber"
                                  : "border-white/10 bg-white/5 text-slate"
                            }`}
                          >
                            <span className="font-semibold">{finding.addon}</span>: {finding.message}
                          </div>
                        ))}
                      </div>
                    )}
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
                      onClick={loadAddonState}
                      disabled={loadingAddons}
                    >
                      {loadingAddons ? "Refreshing..." : "Refresh"}
                    </button>
                  </div>

                  {addonState.runtime === "paper" ? (
                    <div className="rounded-2xl border border-mint/20 bg-black/10 p-4">
                      <div className="mb-3 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-white">Protection kit</p>
                          <p className="mt-1 text-xs text-slate/60">
                            Best-effort Paper protection for hacks, freecam-style abuse, and
                            clients that announce blocked mods.
                          </p>
                        </div>
                        <button
                          type="button"
                          className="rounded-lg border border-mint/40 bg-obsidian px-3 py-2 text-sm text-mint transition hover:bg-mint hover:text-basalt disabled:opacity-50"
                          onClick={handleInstallProtectionPack}
                          disabled={
                            !addonState.supported ||
                            protectionPackInstalled ||
                            installingProjectId === PAPER_PROTECTION_PACK_ID
                          }
                        >
                          {installingProjectId === PAPER_PROTECTION_PACK_ID
                            ? "Installing..."
                            : protectionPackInstalled
                              ? "Protection pack installed"
                              : "Install recommended set"}
                        </button>
                      </div>

                      <div className="grid gap-3 2xl:grid-cols-3">
                        {PAPER_PROTECTION_RECOMMENDATIONS.map((tool) => {
                          const installed = isProtectionInstalled(tool.matchers);
                          return (
                            <div
                              key={tool.projectId}
                              className="rounded-2xl border border-white/10 bg-black/15 p-4"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-sm font-semibold text-white">{tool.label}</p>
                                <span
                                  className={`pill ${
                                    installed ? "text-mint" : "text-slate/80"
                                  }`}
                                >
                                  {installed ? "Installed" : tool.tag}
                                </span>
                              </div>
                              <p className="mt-2 text-xs text-slate/70">{tool.description}</p>
                              <p className="mt-2 text-xs text-slate/55">{tool.note}</p>
                              <button
                                type="button"
                                className="mt-4 w-full rounded-lg border border-white/10 bg-obsidian px-3 py-2 text-sm text-slate transition hover:border-mint/40 disabled:opacity-50"
                                onClick={() => handleInstallCatalogAddon(tool.projectId)}
                                disabled={
                                  installed ||
                                  installingProjectId === tool.projectId ||
                                  installingProjectId === PAPER_PROTECTION_PACK_ID
                                }
                              >
                                {installingProjectId === tool.projectId
                                  ? "Installing..."
                                  : installed
                                    ? "Installed"
                                    : `Install ${tool.label}`}
                              </button>
                            </div>
                          );
                        })}
                      </div>

                      <p className="mt-3 text-xs text-slate/55">
                        Hard limit: no Paper-side solution can reliably detect every client mod.
                        This stack is for best-effort enforcement, not a perfect guarantee.
                      </p>
                    </div>
                  ) : addonState.runtime === "fabric" ? (
                    <div className="rounded-2xl border border-amber/20 bg-black/10 p-4 text-xs text-slate/65">
                      Paper still has the strongest server-side anti-cheat path. Fabric can run
                      server mods, but it is not the best option if your main goal is blocking
                      hacks and client-side cheats.
                    </div>
                  ) : null}

                  <form
                    onSubmit={handleSearchCatalog}
                    className="min-w-0 rounded-2xl border border-white/10 bg-black/10 p-4"
                  >
                    <div className="mb-3">
                      <p className="text-sm font-semibold text-white">Online browser</p>
                      <p className="mt-1 text-xs text-slate/60">
                        Search Modrinth for {addonState.kind === "plugins" ? "Paper plugins" : "Fabric mods"} that match
                        this server version.
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
                        disabled={!addonState.supported}
                      />
                      <button
                        type="submit"
                        className="w-full rounded-lg bg-mint px-4 py-2 font-semibold text-basalt disabled:opacity-50 lg:w-auto lg:shrink-0"
                        disabled={!addonState.supported || loadingCatalog}
                      >
                        {loadingCatalog ? "Searching..." : "Search"}
                      </button>
                    </div>
                    {catalogResults.length > 0 && (
                      <div className="mt-3 min-w-0 space-y-2">
                        {catalogResults.map((result) => (
                          <div
                            key={result.projectId}
                            className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-black/15 px-4 py-3 sm:flex-row sm:items-start sm:justify-between"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="truncate text-sm font-semibold text-white">{result.title}</p>
                                <span className="text-xs text-slate/50">by {result.author}</span>
                              </div>
                              <p className="mt-1 line-clamp-2 text-xs text-slate/65">
                                {result.description}
                              </p>
                              <p className="mt-2 text-xs text-slate/50">
                                {formatDownloads(result.downloads)} downloads
                              </p>
                            </div>
                            <button
                              className="w-full rounded-lg border border-mint/30 px-3 py-1 text-xs text-mint hover:bg-mint hover:text-basalt disabled:opacity-50 sm:w-auto sm:shrink-0"
                              onClick={() => handleInstallCatalogAddon(result.projectId)}
                              disabled={installingProjectId === result.projectId}
                              type="button"
                            >
                              {installingProjectId === result.projectId ? "Installing..." : "Install"}
                            </button>
                          </div>
                        ))}
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
                    {!addonState.supported ? (
                      <div className="rounded-2xl border border-dashed border-white/10 bg-black/10 px-4 py-4 text-sm text-slate/65">
                        {addonState.helperText}
                      </div>
                    ) : addonState.items.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-white/10 bg-black/10 px-4 py-4 text-sm text-slate/65">
                        No {addonState.kind} added yet.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {addonState.items.map((item) => (
                          <div
                            key={item.name}
                            className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-black/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-white">{item.name}</p>
                              <p className="text-xs text-slate/60">
                                {formatAddonSize(item.sizeBytes)} -{" "}
                                {new Date(item.updatedAt).toLocaleDateString()}
                              </p>
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

                  <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">Backups</p>
                        <p className="mt-1 text-xs text-slate/60">
                          Auto-backups run before server starts and before add-on changes. You can
                          also make one manually.
                        </p>
                      </div>
                      <button
                        className="rounded-lg border border-white/10 bg-obsidian px-3 py-2 text-sm text-slate hover:border-mint/40 disabled:opacity-50"
                        onClick={() => handleCreateBackup("manual")}
                        disabled={!activeProfile || workingBackupId === "create"}
                      >
                        {workingBackupId === "create" ? "Creating..." : "Create backup"}
                      </button>
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
                                {backup.reason} - {formatAddonSize(backup.sizeBytes)}
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
              </div>
            </div>
          </div>
        </div>
      </div>

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
