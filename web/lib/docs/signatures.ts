import type { SolContract, SolError, SolEvent, SolFunction, SolParam, SolSurface } from "./sol-surface";

const param = (p: SolParam) => [p.type, p.indexed ? "indexed" : "", p.name].filter(Boolean).join(" ");
const list = (ps: readonly SolParam[]) => ps.map(param).join(", ");

/** `function queueMandate(Mandate m) external returns (bytes32 changeHash)`, as a reader would write it. */
export function functionSignature(f: SolFunction): string {
  const mut = f.mutability === "nonpayable" ? "" : ` ${f.mutability}`;
  const ret = f.returns.length > 0 ? ` returns (${list(f.returns)})` : "";
  return `function ${f.name}(${list(f.params)}) ${f.visibility}${mut}${ret}`;
}

export function eventSignature(e: SolEvent): string {
  return `event ${e.name}(${list(e.params)})`;
}

export function errorSignature(e: SolError): string {
  return `error ${e.name}(${list(e.params)})`;
}

/** Who may call it, for a chip: "Owner only", "Executor only", "Active pool only" (a camelCase role is split into words) or "Anyone". */
export function accessLabel(access: string): string {
  if (access === "anyone") return "Anyone";
  const words = access.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} only`;
}

export function findContract(surface: SolSurface, name: string): SolContract {
  const c = surface.contracts.find((k) => k.name === name);
  if (!c) throw new Error(`contract ${name} is not in content/generated/contracts.json (run npm run docs:gen)`);
  return c;
}

/** One item of a contract by name; throws so a typo in an MDX entry fails the build, and so does a name that matches two. */
export function findItem<K extends "functions" | "events" | "errors">(
  surface: SolSurface,
  contract: string,
  kind: K,
  name: string,
): SolContract[K][number] {
  const items = findContract(surface, contract)[kind].filter((x) => x.name === name);
  const [item] = items;
  if (!item) throw new Error(`${contract} has no ${kind.slice(0, -1)} named ${name}`);
  if (items.length > 1) throw new Error(`${contract} has more than one ${kind.slice(0, -1)} named ${name}`);
  return item as SolContract[K][number];
}
