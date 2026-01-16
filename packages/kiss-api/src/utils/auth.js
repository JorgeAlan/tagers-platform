import { config } from "../config.js";
import { computeSignature, timingSafeEqualHex } from "./hmac.js";

/**
 * HMAC auth:
 * - Client sends:
 *   X-Tagers-Timestamp: unix seconds
 *   X-Tagers-Signature: hex(hmac_sha256(secret, `${ts}.${rawBody}`))
 *
 * If TAGERS_SHARED_SECRET is empty, auth is disabled (dev).
 */
export function hmacAuthMiddleware(req, res, next) {
  if (!config.tagersSharedSecret) return next(); // dev mode

  const ts = req.header("X-Tagers-Timestamp");
  const sig = req.header("X-Tagers-Signature");

  if (!ts || !sig) {
    return res.status(401).json({ ok: false, error: "MISSING_AUTH_HEADERS" });
  }

  // Replay protection: allow +/- 5 minutes
  const now = Math.floor(Date.now() / 1000);
  const tsNum = parseInt(ts, 10);
  if (!Number.isFinite(tsNum) || Math.abs(now - tsNum) > 300) {
    return res.status(401).json({ ok: false, error: "STALE_TIMESTAMP" });
  }

  // IMPORTANT: Signature is computed over the *raw* JSON body.
  // For requests without a body (e.g. GET), treat body as empty string.
  let rawBody = "";
  if (req.rawBody) {
    rawBody = req.rawBody.toString("utf-8");
  } else if (req.body && typeof req.body === "object" && Object.keys(req.body).length > 0) {
    rawBody = JSON.stringify(req.body);
  }
  const expected = computeSignature({ secret: config.tagersSharedSecret, timestamp: ts, rawBody });

  if (!timingSafeEqualHex(expected, sig)) {
    return res.status(401).json({ ok: false, error: "INVALID_SIGNATURE" });
  }

  return next();
}
