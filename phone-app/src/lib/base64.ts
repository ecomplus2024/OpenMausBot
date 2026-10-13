const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Decode base64/base64url to bytes without relying on a global atob. */
export function base64UrlDecode(input: string): Uint8Array {
  const normalized = input.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const out: number[] = [];
  for (let i = 0; i < padded.length; i += 4) {
    const a = ALPHABET.indexOf(padded[i]);
    const b = ALPHABET.indexOf(padded[i + 1]);
    const c = padded[i + 2] === "=" ? -1 : ALPHABET.indexOf(padded[i + 2]);
    const d = padded[i + 3] === "=" ? -1 : ALPHABET.indexOf(padded[i + 3]);
    if (a < 0 || b < 0) throw new Error("invalid base64");
    out.push((a << 2) | (b >> 4));
    if (c >= 0) out.push(((b & 15) << 4) | (c >> 2));
    if (d >= 0) out.push(((c & 3) << 6) | d);
  }
  return new Uint8Array(out);
}

export function base64UrlDecodeJson<T>(input: string): T {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(input))) as T;
}
