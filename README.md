# LMCD

LMCD is a Windows desktop app for running and managing local Minecraft servers with a full GUI instead of a terminal.

Current release label: `1m26c1ea`

## Download

Use the GitHub Releases page and download one of these top-level files:

- `LMCD-1m26c1ea-Setup-x64.exe`
- `LMCD-1m26c1ea-Portable-x64.exe`

You do not need to open `win-unpacked` to use the app.

## What it does

- create and manage multiple local servers
- support `Paper`, `Fabric`, and `Vanilla`
- edit core server settings from the app
- install Fabric mods or Paper plugins from local files or the built-in browser
- create backups and restore them from the UI
- apply locked world-rule presets and cheat guard options

## Data location

LMCD stores managed server data under `Documents/LMCD`.

If an older `Documents/TFSU-MiCr` folder exists, LMCD migrates it forward automatically when possible.

## Releases

Packaged Windows artifacts are generated into `release/`, while the distributable files intended for GitHub Releases are:

- `release/LMCD-1m26c1ea-Setup-x64.exe`
- `release/LMCD-1m26c1ea-Portable-x64.exe`

## License

MIT. See `LICENSE`.
