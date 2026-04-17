import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const VERSION = "v1";
const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const SCRYPT_COST = 16384;

function deriveKey(secret: string, salt: Buffer): Buffer {
  return scryptSync(secret, salt, KEY_LEN, { N: SCRYPT_COST });
}

export function encrypt(plaintext: string, secret: string): string {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = deriveKey(secret, salt);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([salt, iv, tag, ciphertext]).toString("base64");
  return `${VERSION}:${payload}`;
}

export function decrypt(blob: string, secret: string): string {
  const [version, payload] = blob.split(":", 2);
  if (version !== VERSION || !payload) {
    throw new Error(`Unsupported ciphertext format (expected ${VERSION}:…)`);
  }
  const raw = Buffer.from(payload, "base64");
  if (raw.length < SALT_LEN + IV_LEN + TAG_LEN) {
    throw new Error("Ciphertext truncated");
  }
  const salt = raw.subarray(0, SALT_LEN);
  const iv = raw.subarray(SALT_LEN, SALT_LEN + IV_LEN);
  const tag = raw.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN);
  const ciphertext = raw.subarray(SALT_LEN + IV_LEN + TAG_LEN);
  const key = deriveKey(secret, salt);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Decryption failed — APP_SECRET_KEY wrong or data corrupt");
  }
}
