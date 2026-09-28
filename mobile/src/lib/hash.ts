import * as Crypto from "expo-crypto";

/**
 * sha256 of a text, lowercase hex, over its UTF-8 bytes — byte for byte what
 * the server's `textHash` computes (lib/sync.ts), so a `base_hash` from the
 * phone compares equal to the server's for the same text.
 */
export function textHash(text: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text, {
    encoding: Crypto.CryptoEncoding.HEX,
  });
}

/** A v4 UUID for a new note or a queued change. The server accepts client ids only as UUIDs. */
export function newId(): string {
  return Crypto.randomUUID();
}
