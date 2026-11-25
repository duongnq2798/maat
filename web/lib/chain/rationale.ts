import { keccak256, toBytes, type Hash, type Hex } from "viem";
import { z } from "zod";

/** One exported rationale (content/generated/rationales.json, served at /data/rationales.json). */
export interface RationaleEntry {
  intentId: Hex;
  rationaleHash: Hex;
  text: string;
  txHash: Hash | null;
  ts: string;
}

/**
 * Where the page finds rationale text for the intents it shows. The text is never trusted: the page shows the
 * "Hash verified" badge only when verifyRationale says so. v1 reads the static export; a database-backed source can
 * implement the same interface later.
 */
export interface RationaleSource {
  readonly name: string;
  lookup(intentIds: readonly Hex[]): Promise<Map<Hex, string>>;
}

export type RationaleCheck = "verified" | "mismatch" | "missing";

/** keccak256 of the exact UTF-8 bytes, the same hash agent/src/intent.ts rationaleHash() commits onchain. */
export function verifyRationale(text: string | undefined, onchainHash: Hex): RationaleCheck {
  if (text === undefined) return "missing";
  return keccak256(toBytes(text)).toLowerCase() === onchainHash.toLowerCase() ? "verified" : "mismatch";
}

const fileSchema = z.array(z.object({ intentId: z.string(), text: z.string() }).passthrough());

/** Reads the static export once; ids are matched in lowercase. A missing or malformed file finds nothing. */
export function staticRationaleSource(url = "/data/rationales.json", fetchImpl: typeof fetch = (...a) => fetch(...a)): RationaleSource {
  let all: Promise<Map<string, string>> | null = null;
  const load = async () => {
    try {
      const res = await fetchImpl(url, { cache: "no-cache" });
      if (!res.ok) return new Map<string, string>();
      const parsed = fileSchema.safeParse(await res.json());
      return new Map(parsed.success ? parsed.data.map((e) => [e.intentId.toLowerCase(), e.text] as const) : []);
    } catch {
      return new Map<string, string>();
    }
  };
  return {
    name: url,
    async lookup(ids) {
      all ??= load();
      const map = await all;
      const out = new Map<Hex, string>();
      for (const id of ids) {
        const text = map.get(id.toLowerCase());
        if (text !== undefined) out.set(id, text);
      }
      return out;
    },
  };
}
