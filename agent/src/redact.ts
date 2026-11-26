/** Env names whose values are secrets, or may carry one: an RPC URL can hold an API key in its path. */
const SECRET_NAME = /KEY|SECRET|TOKEN|PASSWORD|PRIVATE|RPC_URL/i;
/** Shorter values are too likely to occur in ordinary text to be replaced wherever they appear. */
const MIN_SECRET_CHARS = 8;
/** A round's error line is cut to this many characters after redaction. */
export const MAX_LINE_CHARS = 300;

/** The parts of a URL that can hold a key: user info, path segments and query values. */
function urlParts(v: string): string[] {
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return [];
  }
  const parts = [u.username, u.password, ...u.pathname.split("/"), ...[...u.searchParams.values()]];
  return parts.flatMap((p) => {
    let decoded = p;
    try {
      decoded = decodeURIComponent(p);
    } catch {
      // keep the raw part
    }
    return [...new Set([p, decoded])];
  });
}

/**
 * The values of the env vars whose names mark them as secret, longest first. A URL value adds its key-holding
 * parts, so an error that quotes only the key of an RPC URL is redacted too.
 */
export function secretValues(env: NodeJS.ProcessEnv = process.env): string[] {
  const values = Object.entries(env)
    .filter(([name, v]) => SECRET_NAME.test(name) && typeof v === "string")
    .flatMap(([, v]) => [v as string, ...urlParts(v as string)])
    .filter((v) => v.length >= MIN_SECRET_CHARS);
  return [...new Set(values)].sort((a, b) => b.length - a.length);
}

/**
 * `text` with every secret value, URL, Anthropic key, bearer token and long opaque token replaced. 0x-prefixed hex
 * (addresses, tx hashes, intent ids) is public chain data and stays.
 */
export function redact(text: string, secrets: readonly string[] = secretValues()): string {
  let out = text;
  for (const s of secrets) out = out.split(s).join("[redacted]");
  return out
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'`<>()]+/gi, "[url]")
    .replace(/\bsk-ant-[\w-]+/g, "[redacted]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/(?<![\w-])(?!0x[0-9a-fA-F]+(?![\w-]))[\w-]{40,}/g, "[redacted]");
}

/**
 * One line for a log or a journal row: the first non-empty line of the error's message, redacted and cut to
 * MAX_LINE_CHARS. viem puts the request URL, which may carry an API key, and the request body on the lines below it.
 */
export function oneLine(e: unknown, secrets: readonly string[] = secretValues()): string {
  const text = e instanceof Error ? e.message : String(e);
  const first = text.split(/\r?\n/).find((l) => l.trim().length > 0)?.trim() ?? "";
  const line = redact(first, secrets);
  return line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS - 3)}...` : line;
}
