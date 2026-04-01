import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const IV_LEN = 12;
const TAG_LEN = 16;

function deriveKey(secretB64: string): Buffer {
  const raw = Buffer.from(secretB64, "base64");
  if (raw.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be base64 of exactly 32 bytes");
  }
  return raw;
}

export function encryptSecret(plaintext: string, encryptionKeyB64: string): string {
  const key = deriveKey(encryptionKeyB64);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptSecret(ciphertextB64: string, encryptionKeyB64: string): string {
  const key = deriveKey(encryptionKeyB64);
  const buf = Buffer.from(ciphertextB64, "base64");
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new Error("Invalid ciphertext");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
