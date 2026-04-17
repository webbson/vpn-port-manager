import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "../src/crypto.js";

const SECRET = "test-secret-key-0123456789abcdef";

describe("crypto", () => {
  it("round-trips a plaintext string", () => {
    const blob = encrypt("hello world", SECRET);
    expect(blob.startsWith("v1:")).toBe(true);
    expect(decrypt(blob, SECRET)).toBe("hello world");
  });

  it("produces a different ciphertext each call (random salt+iv)", () => {
    const a = encrypt("same", SECRET);
    const b = encrypt("same", SECRET);
    expect(a).not.toBe(b);
    expect(decrypt(a, SECRET)).toBe("same");
    expect(decrypt(b, SECRET)).toBe("same");
  });

  it("round-trips UTF-8 and an empty string", () => {
    expect(decrypt(encrypt("", SECRET), SECRET)).toBe("");
    const unicode = "π øre — 日本語 🔑";
    expect(decrypt(encrypt(unicode, SECRET), SECRET)).toBe(unicode);
  });

  it("throws when the key is wrong", () => {
    const blob = encrypt("secret", SECRET);
    expect(() => decrypt(blob, "wrong-key-0000000000000000000000")).toThrow(
      /APP_SECRET_KEY wrong or data corrupt/
    );
  });

  it("detects tampering with the auth tag", () => {
    const blob = encrypt("secret", SECRET);
    const [version, payload] = blob.split(":", 2);
    const raw = Buffer.from(payload, "base64");
    // Flip a bit inside the auth tag region (salt=16, iv=12; tag starts at 28)
    raw[30] ^= 0x01;
    const tampered = `${version}:${raw.toString("base64")}`;
    expect(() => decrypt(tampered, SECRET)).toThrow();
  });

  it("rejects an unknown version prefix", () => {
    expect(() => decrypt("v0:aaaa", SECRET)).toThrow(/Unsupported ciphertext format/);
    expect(() => decrypt("not-a-blob", SECRET)).toThrow(/Unsupported ciphertext format/);
  });

  it("rejects truncated ciphertext", () => {
    expect(() => decrypt("v1:" + Buffer.from("short").toString("base64"), SECRET)).toThrow(
      /truncated/
    );
  });
});
