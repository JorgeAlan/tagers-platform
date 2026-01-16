// Small fetch helper with a hard timeout.
//
// Why: when external services (Chatwoot / WordPress / etc.) hang,
// we must fail fast and keep a good customer experience (never "silence").

import { config } from "../config.js";

export async function fetchWithTimeout(url, options = {}, timeoutMs = null) {
  const ms = Number.isFinite(Number(timeoutMs)) ? Number(timeoutMs) : (config.httpTimeoutMs || 25000);

  // If timeout is disabled (<=0), behave like normal fetch.
  if (!ms || ms <= 0) {
    return fetch(url, options);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    try {
      controller.abort(new Error(`HTTP request timed out after ${ms}ms`));
    } catch {
      controller.abort();
    }
  }, ms);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
