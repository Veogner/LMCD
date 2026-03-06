export type ModePreset = "hardcore" | "survival_locked" | "adventure_locked";
export type ServerSoftware = "vanilla" | "paper" | "fabric";
export type ProfileType = "local" | "remote";

export type ServerStats = {
  running: boolean;
  cpu: number;
  memoryMB: number;
  uptime: number;
  remote?: boolean;
  configuredMinMB?: number;
  configuredMaxMB?: number;
  system: {
    totalMB: number;
    freeMB: number;
    usedMB: number;
    usagePct: number;
  };
};

export type AddonItem = {
  name: string;
  displayName: string;
  version: string;
  description: string;
  valid: boolean;
  sizeBytes: number;
  updatedAt: number;
  projectId?: string;
  installedVersionId?: string;
  installedVersionNumber?: string;
  updateAvailable?: boolean;
};

export type CompatibilityFinding = {
  level: "error" | "warning" | "info";
  addon: string;
  message: string;
};

export type CompatibilityReport = {
  ready: boolean;
  summary: string;
  findings: CompatibilityFinding[];
};

export type CatalogGalleryItem = {
  url: string;
  featured?: boolean;
  title?: string;
  description?: string;
  ordering?: number;
};

export type CatalogResult = {
  projectId: string;
  slug: string;
  title: string;
  author: string;
  description: string;
  body?: string;
  downloads: number;
  follows?: number;
  iconUrl: string | null;
  categories: string[];
  gallery?: CatalogGalleryItem[];
  featuredGallery?: string | null;
  dateModified?: string | null;
  projectType?: string;
  clientSide?: string;
  serverSide?: string;
};

export type AddonState = {
  supported: boolean;
  kind: "mods" | "plugins" | "none";
  label: string;
  helperText: string;
  folderPath: string | null;
  runtime: ServerSoftware;
  items: AddonItem[];
  compatibility: CompatibilityReport;
};

export type BackupEntry = {
  id: string;
  createdAt: number;
  reason: string;
  sizeBytes: number;
};

export type PropertySchemaEntry = {
  category: string;
  key: string;
  label: string;
  type: "boolean" | "number" | "text" | "enum";
  defaultValue: string;
  min?: number;
  max?: number;
  enumValues?: string[];
  helper?: string;
};

export type NetworkDiagnosticsLocal = {
  mode: "local";
  bindIp: string;
  port: number;
  localhostReachable: boolean;
  publicIp: string;
  publicHost: string;
  publicEndpoint: string;
  needsPortForward: boolean;
  localIps: string[];
  summary: string;
};

export type NetworkDiagnosticsRemote = {
  mode: "remote";
  host: string;
  rconPort: number;
  reachable: boolean;
  summary: string;
};

export type NetworkDiagnostics = NetworkDiagnosticsLocal | NetworkDiagnosticsRemote;

export type ServerStartOptions = {
  minMem?: number;
  maxMem?: number;
  port?: number;
  idleShutdownMinutes?: number;
  motd?: string;
  viewDistance?: number;
  simulationDistance?: number;
  maxPlayers?: number;
  version?: string;
  serverSoftware?: ServerSoftware;
};

export type ServerStatusPayload = {
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
  profileType?: ProfileType;
  host?: string;
  rconPort?: number;
  publicHost?: string;
  remote?: boolean;
};

export type DownloadProgressPayload = {
  received: number;
  total: number;
  percent: number | null;
};

export type LogBatchPayload = string[];

export type StorageReport = {
  profileId: string;
  jarsBytes: number;
  backupsBytes: number;
  logsBytes: number;
  addonsBytes: number;
  totalBytes: number;
  jarCount: number;
  backupCount: number;
  addonCount: number;
};

export type StorageCleanupOptions = {
  jarMaxAgeDays?: number;
  backupMaxAgeDays?: number;
  logMaxAgeDays?: number;
};

export type StorageCleanupResult = {
  profileId: string;
  removed: {
    jars: number;
    backups: number;
    logs: number;
    bytes: number;
  };
  policy: {
    jarMaxAgeDays: number;
    backupMaxAgeDays: number;
    logMaxAgeDays: number;
    keepBackupsPerWorld: number;
  };
  report: StorageReport;
};

export type ServerStartResult = {
  running: boolean;
  path?: string;
  version?: string;
  serverSoftware?: ServerSoftware;
  profile: string;
  modePreset?: ModePreset;
  cheatLock?: boolean;
  rulesLocked?: boolean;
  minMem?: number;
  maxMem?: number;
  port?: number;
  idleShutdownMinutes?: number;
  remote?: boolean;
  host?: string;
  rconPort?: number;
};

export type Profile = {
  id: string;
  name: string;
  profileType: ProfileType;
  version: string;
  motd: string;
  minMem: number;
  maxMem: number;
  port: number;
  idleShutdownMinutes: number;
  serverSoftware: ServerSoftware;
  modePreset: ModePreset;
  cheatLock: boolean;
  rulesLocked: boolean;
  host: string;
  publicHost: string;
  rconPort: number;
  rconPasswordRef: string;
  wakeCommand: string;
  wakeTimeoutSec: number;
  connectTimeoutSec: number;
};

export type CatalogSearchOptions = {
  sort?: "relevance" | "downloads" | "follows" | "updated";
  limit?: number;
};

declare global {
  interface Window {
    bridge: {
      ensureJar: (
        version?: string,
        software?: ServerSoftware,
      ) => Promise<{ downloaded: boolean; path: string; version: string; serverSoftware: ServerSoftware }>;
      listVersions: (software?: ServerSoftware) => Promise<string[]>;
      startServer: (options: ServerStartOptions) => Promise<ServerStartResult>;
      stopServer: () => Promise<void>;
      sendCommand: (cmd: string) => Promise<void>;
      readProps: () => Promise<Record<string, string>>;
      writeProps: (updates: Record<string, string | number | boolean>) => Promise<Record<string, string>>;
      listPropertySchema: () => Promise<PropertySchemaEntry[]>;
      getStats: () => Promise<ServerStats>;
      openFolder: () => Promise<string>;
      getStorageReport: (profileId?: string) => Promise<StorageReport>;
      cleanupStorage: (
        profileId?: string,
        options?: StorageCleanupOptions,
      ) => Promise<StorageCleanupResult>;
      listAddons: () => Promise<AddonState>;
      pickAddons: () => Promise<AddonState>;
      removeAddon: (fileName: string) => Promise<AddonState>;
      checkAddonUpdates: () => Promise<AddonState>;
      openAddonFolder: () => Promise<string>;
      searchCatalog: (
        query: string,
        runtime?: ServerSoftware,
        options?: CatalogSearchOptions,
      ) => Promise<CatalogResult[]>;
      getCatalogProject: (projectId: string) => Promise<CatalogResult>;
      installCatalogAddon: (projectId: string) => Promise<AddonState>;
      listBackups: () => Promise<BackupEntry[]>;
      createBackup: (reason?: string) => Promise<BackupEntry>;
      restoreBackup: (backupId: string) => Promise<BackupEntry[]>;
      remoteSetPassword: (
        profileId: string,
        password: string,
      ) => Promise<{ ok: boolean; profileId: string; rconPasswordRef: string }>;
      remoteClearPassword: (profileId: string) => Promise<{ ok: boolean; profileId: string }>;
      remoteTestConnection: (profileId: string) => Promise<{ ok: boolean; response: string }>;
      remoteStart: (profileId: string) => Promise<ServerStartResult>;
      remoteStop: (profileId: string) => Promise<{ running: boolean }>;
      remoteCommand: (profileId: string, command: string) => Promise<string>;
      networkDiagnostics: (profileId: string) => Promise<NetworkDiagnostics>;
      networkUpnpMap: (profileId: string) => Promise<{ mapped: boolean; port: number; endpoint: string }>;
      networkUpnpUnmap: (profileId: string) => Promise<{ mapped: boolean; port: number }>;
      onLog: (cb: (line: string) => void) => () => void;
      onLogBatch: (cb: (lines: LogBatchPayload) => void) => () => void;
      onStatus: (cb: (payload: ServerStatusPayload) => void) => () => void;
      onDownload: (cb: (payload: DownloadProgressPayload) => void) => () => void;
      setProfile: (profile: Partial<Profile> & { id: string }) => Promise<Profile>;
      listProfiles: () => Promise<Profile[]>;
      saveProfiles: (list: Profile[]) => Promise<Profile[]>;
      deleteProfile: (profileId: string) => Promise<Profile[]>;
    };
  }
}

export {};
