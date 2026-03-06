const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { APP_NAME, getAppRootDir } = require("./profiles.cjs");

const FALLBACK_FILE = ".lmcd-credentials.json";
const KEYTAR_SERVICE = `${APP_NAME}.remote`;
const CIPHER_ALGO = "aes-256-gcm";

function loadKeytar() {
  try {
    // Optional dependency: if unavailable we fall back to local encrypted storage.
    return require("keytar");
  } catch {
    return null;
  }
}

function getFallbackPath() {
  return path.join(getAppRootDir(), FALLBACK_FILE);
}

function deriveMachineKey() {
  const seed = `${os.hostname()}|${os.userInfo().username}|${APP_NAME}|lmcd-cred-v1`;
  return crypto.createHash("sha256").update(seed).digest();
}

function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const key = deriveMachineKey();
  const cipher = crypto.createCipheriv(CIPHER_ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString("base64"),
    payload: encrypted.toString("base64"),
    tag: tag.toString("base64"),
  };
}

function decrypt(value) {
  if (!value || !value.iv || !value.payload || !value.tag) {
    return "";
  }
  const key = deriveMachineKey();
  const decipher = crypto.createDecipheriv(
    CIPHER_ALGO,
    key,
    Buffer.from(String(value.iv), "base64"),
  );
  decipher.setAuthTag(Buffer.from(String(value.tag), "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(String(value.payload), "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

function readFallbackStore() {
  try {
    const filePath = getFallbackPath();
    if (!fs.existsSync(filePath)) {
      return {};
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8")) || {};
  } catch {
    return {};
  }
}

function writeFallbackStore(nextStore) {
  const filePath = getFallbackPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(nextStore, null, 2));
}

async function setSecret(account, secret) {
  const safeAccount = String(account || "").trim();
  if (!safeAccount) {
    throw new Error("Credential account id is required.");
  }
  const keytar = loadKeytar();
  if (keytar) {
    await keytar.setPassword(KEYTAR_SERVICE, safeAccount, String(secret || ""));
    return { provider: "keytar", ref: safeAccount };
  }

  const store = readFallbackStore();
  store[safeAccount] = encrypt(secret || "");
  writeFallbackStore(store);
  return { provider: "fallback", ref: safeAccount };
}

async function getSecret(account) {
  const safeAccount = String(account || "").trim();
  if (!safeAccount) {
    return "";
  }
  const keytar = loadKeytar();
  if (keytar) {
    return (await keytar.getPassword(KEYTAR_SERVICE, safeAccount)) || "";
  }

  const store = readFallbackStore();
  return decrypt(store[safeAccount]);
}

async function deleteSecret(account) {
  const safeAccount = String(account || "").trim();
  if (!safeAccount) {
    return;
  }
  const keytar = loadKeytar();
  if (keytar) {
    await keytar.deletePassword(KEYTAR_SERVICE, safeAccount);
    return;
  }

  const store = readFallbackStore();
  delete store[safeAccount];
  writeFallbackStore(store);
}

module.exports = {
  setSecret,
  getSecret,
  deleteSecret,
};
