// The optional healthcheck ping: after each round that pushed or found nothing new, the publisher sends one GET to
// MAAT_HEALTHCHECK_URL, so a monitor such as healthchecks.io notices when the rounds stop. The URL is treated as a
// secret, since such a URL is its own token: nothing here ever prints it, not even inside an error, and a failed ping
// never stops the publisher.

export const HEALTHCHECK_ENV = "MAAT_HEALTHCHECK_URL";
export const HEALTHCHECK_TIMEOUT_MS = 10_000;

/**
 * The round statuses that ping: "pushed" and "up-to-date". A "waiting" round (no journal, or no chained row yet)
 * publishes nothing the branch can show, so it does not ping and the monitor goes late, as it should.
 */
export const HEALTHY_STATUSES = /** @type {ReadonlySet<string>} */ (new Set(["pushed", "up-to-date"]));

/**
 * Whether `raw` is an absolute http or https URL. Never throws, and never quotes `raw`.
 * @param {string} raw
 */
export function isHttpUrl(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Sends one GET to `url` and says how it went: null when the answer was a 2xx, else a short reason that never holds
 * the URL (an HTTP status, a timeout, or an error code such as ENOTFOUND). Never throws.
 * @param {string} url
 * @param {{ fetch?: typeof globalThis.fetch, timeoutMs?: number, signal?: AbortSignal }} [o]
 * @returns {Promise<string | null>}
 */
export async function pingHealthcheck(url, o = {}) {
  const doFetch = o.fetch ?? globalThis.fetch;
  const timeoutMs = o.timeoutMs ?? HEALTHCHECK_TIMEOUT_MS;
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = o.signal === undefined ? timeout : AbortSignal.any([o.signal, timeout]);
  try {
    const res = await doFetch(url, { method: "GET", signal, headers: { "user-agent": "maat-journal-publisher" } });
    await res.body?.cancel().catch(() => {});
    return res.ok ? null : `HTTP ${res.status}`;
  } catch (e) {
    if (timeout.aborted) return `no answer within ${timeoutMs % 1000 === 0 ? `${timeoutMs / 1000} s` : `${timeoutMs} ms`}`;
    if (o.signal?.aborted) return "stopped by Ctrl-C";
    return errorCode(e) ?? "network error";
  }
}

/**
 * The error's code, or its cause's (undici puts the socket error there), when it is a bare code such as ENOTFOUND or
 * ECONNREFUSED: a code cannot carry the URL, while a message can.
 * @param {unknown} e
 * @returns {string | null}
 */
function errorCode(e) {
  for (const x of [e, /** @type {{ cause?: unknown }} */ (e)?.cause]) {
    const code = /** @type {{ code?: unknown }} */ (x)?.code;
    if (typeof code === "string" && /^[A-Z][A-Z0-9_]{1,40}$/.test(code)) return code;
  }
  return null;
}
