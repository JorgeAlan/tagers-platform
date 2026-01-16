import crypto from "crypto";

export function computeSignature({ secret, timestamp, rawBody }) {
  // Signature base string: `${timestamp}.${rawBody}`
  const base = `${timestamp}.${rawBody}`;
  return crypto.createHmac("sha256", secret).update(base, "utf8").digest("hex");
}

export function timingSafeEqualHex(a, b) {
  try {
    const ba = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}
