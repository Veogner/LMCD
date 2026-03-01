export type ModePreset = "hardcore" | "survival_locked" | "adventure_locked";
export type ServerSoftware = "vanilla" | "paper" | "fabric";

export type ServerStats = {
  running: boolean;
  cpu: number;
  memoryMB: number;
  uptime: number;
  system: {
    totalMB: number;
    freeMB: number;
    usedMB: number;
  };
};

export type AddonItem = {
  name: string;
  sizeBytes: number;
  updatedAt: number;
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

export type CatalogResult = {
  projectId: string;
  slug: string;
  title: string;
  author: string;
  description: string;
  downloads: number;
  iconUrl: string | null;
  categories: string[];
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

export type ServerStartOptions = {
  minMem?: number;
  maxMem?: number;
  port?: number;
  motd?: string;
  viewDistance?: number;
  simulationDistance?: number;
  maxPlayers?: number;
  version?: string;
  serverSoftware?: ServerSoftware;
};

export type Profile = {
  id: string;
  name: string;
  version: string;
  motd: string;
  serverSoftware: ServerSoftware;
  modePreset: ModePreset;
  cheatLock: boolean;
  rulesLocked: boolean;
};

declare global {
  interface Window {
    bridge: {
      ensureJar: (
        version?: string,
        software?: ServerSoftware,
      ) => Promise<{ downloaded: boolean; path: string; version: string; serverSoftware: ServerSoftware }>;
      listVersions: (software?: ServerSoftware) => Promise<string[]>;
      startServer: (options: ServerStartOptions) => Promise<any>;
      stopServer: () => Promise<void>;
      sendCommand: (cmd: string) => Promise<void>;
      readProps: () => Promise<Record<string, string>>;
      writeProps: (updates: Record<string, string | number | boolean>) => Promise<Record<string, string>>;
      getStats: () => Promise<ServerStats>;
      openFolder: () => Promise<any>;
      listAddons: () => Promise<AddonState>;
      pickAddons: () => Promise<AddonState>;
      removeAddon: (fileName: string) => Promise<AddonState>;
      openAddonFolder: () => Promise<any>;
      searchCatalog: (query: string) => Promise<CatalogResult[]>;
      installCatalogAddon: (projectId: string) => Promise<AddonState>;
      listBackups: () => Promise<BackupEntry[]>;
      createBackup: (reason?: string) => Promise<BackupEntry>;
      restoreBackup: (backupId: string) => Promise<BackupEntry[]>;
      onLog: (cb: (line: string) => void) => () => void;
      onStatus: (cb: (payload: any) => void) => () => void;
      onDownload: (cb: (payload: any) => void) => () => void;
      setProfile: (profile: {
        id: string;
        version?: string;
        serverSoftware?: ServerSoftware;
        modePreset?: ModePreset;
        cheatLock?: boolean;
        rulesLocked?: boolean;
      }) => Promise<void>;
      listProfiles: () => Promise<Profile[]>;
      saveProfiles: (list: Profile[]) => Promise<Profile[]>;
      deleteProfile: (profileId: string) => Promise<Profile[]>;
    };
  }
}

export {};
