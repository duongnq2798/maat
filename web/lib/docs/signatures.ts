import { headingId } from "./links";
import type { SolContract, SolError, SolEvent, SolFunction, SolParam, SolSurface } from "./sol-surface";

/** A piece of a signature: plain text, or a parameter's type, which a page can link to the type's entry. */
export interface SignaturePart {
  readonly text: string;
  readonly type?: true;
}

const param = (p: SolParam): SignaturePart[] => [{ text: p.type, type: true }, { text: `${p.indexed ? " indexed" : ""}${p.name ? ` ${p.name}` : ""}` }];
const list = (ps: readonly SolParam[]): SignaturePart[] => ps.flatMap((p, i) => (i === 0 ? param(p) : [{ text: ", " }, ...param(p)]));
const join = (parts: readonly SignaturePart[]) => parts.map((p) => p.text).join("");

/** The pieces of functionSignature, each parameter's and return value's type apart. */
export function functionSignatureParts(f: SolFunction): SignaturePart[] {
  const mut = f.mutability === "nonpayable" ? "" : ` ${f.mutability}`;
  const ret = f.returns.length > 0 ? [{ text: " returns (" }, ...list(f.returns), { text: ")" }] : [];
  return [{ text: `function ${f.name}(` }, ...list(f.params), { text: `) ${f.visibility}${mut}` }, ...ret];
}

/** `function queueMandate(Mandate m) external returns (bytes32 changeHash)`, as a reader would write it. */
export function functionSignature(f: SolFunction): string {
  return join(functionSignatureParts(f));
}

export function eventSignatureParts(e: SolEvent): SignaturePart[] {
  return [{ text: `event ${e.name}(` }, ...list(e.params), { text: ")" }];
}

export function eventSignature(e: SolEvent): string {
  return join(eventSignatureParts(e));
}

export function errorSignatureParts(e: SolError): SignaturePart[] {
  return [{ text: `error ${e.name}(` }, ...list(e.params), { text: ")" }];
}

export function errorSignature(e: SolError): string {
  return join(errorSignatureParts(e));
}

/** The Types page entry of a struct or an enum from contracts/src/Types.sol, or null for any other type. */
export function typeHref(surface: SolSurface, type: string): string | null {
  return [...surface.structs, ...surface.enums].some((t) => t.name === type) ? `/docs/reference/types#${headingId(type)}` : null;
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

/** A group of a function index, as a page writes it: the name of the page's section, then its functions in page order. */
export type FunctionGroup = readonly [name: string, functions: readonly string[]];

/**
 * Each group with its functions. Every function of the contract must be in exactly one group, and every name must be
 * one of its functions, so an index that drifts from the contract fails the build.
 */
export function functionGroups(
  surface: SolSurface,
  contract: string,
  groups: readonly FunctionGroup[],
): { name: string; functions: SolFunction[] }[] {
  const out = groups.map(([name, names]) => ({ name, functions: names.map((n) => findItem(surface, contract, "functions", n)) }));
  const listed = groups.flatMap(([, names]) => names);
  const where = `<FunctionIndex contract="${contract}" /> groups`;
  const twice = [...new Set(listed.filter((n, i) => listed.indexOf(n) !== i))];
  if (twice.length > 0) throw new Error(`${where} list ${twice.join(", ")} more than once`);
  const missing = findContract(surface, contract)
    .functions.map((f) => f.name)
    .filter((n) => !listed.includes(n));
  if (missing.length > 0) throw new Error(`${where} leave out ${missing.join(", ")}`);
  return out;
}
