import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32(bytes: Buffer) {
  let bits = 0, value = 0, result = "";
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { result += alphabet[(value >>> (bits -= 5)) & 31]; }
  }
  if (bits) result += alphabet[(value << (5 - bits)) & 31];
  return result;
}
function decode(secret: string) {
  let bits = 0, value = 0; const bytes: number[] = [];
  for (const c of secret) {
    const index = alphabet.indexOf(c);
    if (index < 0) throw new Error("Invalid MFA secret format.");
    value = (value << 5) | index; bits += 5;
    if (bits >= 8) bytes.push((value >>> (bits -= 8)) & 255);
  }
  return Buffer.from(bytes);
}
export const newMfaSecret = () => base32(randomBytes(20));
// RFC 4226 dynamic truncation with the RFC 6238 30-second moving factor.
export function totp(secret: string, time = Date.now(), digits = 6) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 30_000)));
  const hmac = createHmac("sha1", decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 15;
  return ((hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits).toString().padStart(digits, "0");
}
export function totpStep(secret: string, code: string, lastStep: number, time = Date.now()) {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(time / 30_000);
  // Prefer the current step; allow one adjacent step for clock skew.
  for (const step of [current, current - 1, current + 1]) {
    if (step >= 0 && step > lastStep && timingSafeEqual(Buffer.from(totp(secret, step * 30_000)), Buffer.from(code))) return step;
  }
  return null;
}
export function mfaCipher(encodedKey: string) {
  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32 || key.toString("base64") !== encodedKey) throw new Error("ADMIN_ENCRYPTION_KEY must be 32 bytes encoded as base64.");
  return {
    encrypt(secret: string) {
      const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, nonce);
      const bytes = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
      return Buffer.concat([nonce, cipher.getAuthTag(), bytes]).toString("base64");
    },
    decrypt(encoded: string) {
      const bytes = Buffer.from(encoded, "base64"), decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
    },
  };
}
