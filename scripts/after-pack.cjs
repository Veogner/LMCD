const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

module.exports = async (context) => {
  if (!context || context.electronPlatformName !== "win32") {
    return;
  }

  const projectDir = context.packager?.projectDir || process.cwd();
  const iconPath = path.resolve(projectDir, "build", "icon.ico");
  const rceditX64 = path.resolve(projectDir, "build", "rcedit", "rcedit-x64.exe");
  const rceditX86 = path.resolve(projectDir, "build", "rcedit", "rcedit-x86.exe");
  const rceditPath = fs.existsSync(rceditX64) ? rceditX64 : rceditX86;
  const appOutDir = context.appOutDir;
  const executableName =
    context.packager?.platformSpecificBuildOptions?.executableName ||
    context.packager?.appInfo?.productFilename ||
    "LMCD";
  const executablePath = path.join(appOutDir, `${executableName}.exe`);
  const appVersion = String(context.packager?.appInfo?.version || "0.0.0");
  const productName = String(context.packager?.appInfo?.productName || executableName);

  if (!fs.existsSync(executablePath)) {
    throw new Error(`afterPack: executable not found at ${executablePath}`);
  }
  if (!fs.existsSync(iconPath)) {
    throw new Error(`afterPack: icon file not found at ${iconPath}`);
  }
  if (!fs.existsSync(rceditPath)) {
    throw new Error(`afterPack: rcedit binary not found at ${rceditPath}`);
  }

  const args = [
    executablePath,
    "--set-icon",
    iconPath,
    "--set-version-string",
    "ProductName",
    productName,
    "--set-version-string",
    "FileDescription",
    productName,
    "--set-version-string",
    "OriginalFilename",
    `${executableName}.exe`,
    "--set-file-version",
    appVersion,
    "--set-product-version",
    appVersion,
  ];

  execFileSync(rceditPath, args, { stdio: "inherit", windowsHide: true });

  const pruneCandidates = ["dxcompiler.dll", "dxil.dll"];
  for (const fileName of pruneCandidates) {
    const targetPath = path.join(appOutDir, fileName);
    if (fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { force: true });
    }
  }
};
