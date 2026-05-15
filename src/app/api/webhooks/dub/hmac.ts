/**
 * HMAC-SHA256 verification for the Dub webhook handler. Pulled into
 * its own module so the route.ts file only exports HTTP method
 * handlers (Next.js convention) — and so we can unit-test the verifier
 * without spinning up the route.
 */
export async function verifyHmacSha256(secret: string, body: string, signature: string): Promise<boolean> {
  const sigHex = signature.startsWith("sha256=") ? signature.slice("sha256=".length) : signature;
  const sigBytes = hexToBytes(sigHex);
  if (!sigBytes) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  // crypto.subtle.verify wants BufferSource. The SharedArrayBuffer-typing
  // friction in newer @types/node disappears if we hand it a freshly
  // allocated ArrayBuffer slice.
  const sigBuf = sigBytes.buffer.slice(sigBytes.byteOffset, sigBytes.byteOffset + sigBytes.byteLength) as ArrayBuffer;
  return crypto.subtle.verify("HMAC", key, sigBuf, new TextEncoder().encode(body));
}

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0) return null;
  if (!/^[0-9a-fA-F]*$/.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
