import { FACTS } from "@/content/facts";

type Entries = typeof FACTS;
type EntryName = keyof Entries & string;
type Scalar = string | number | boolean;

/** The fields of a fact whose value is a plain object, and only those that hold one number, string or boolean. */
type FieldName<V> = V extends readonly unknown[]
  ? never
  : V extends object
    ? { [F in keyof V & string]: V[F] extends Scalar ? F : never }[keyof V & string]
    : never;

/**
 * A key into FACTS (spec 2026-11-23 section 10.2): `<entry>`, or `<entry>.<field>` for a field of an entry whose value
 * is a plain object, for example "timelockHours" or "mandate.maxPremiumBps".
 */
export type FactKey = { [E in EntryName]: E | `${E}.${FieldName<Entries[E]["value"]>}` }[EntryName];

export interface ResolvedFact {
  value: unknown;
  /** The entry's source: a field shares the source of its entry. */
  source: string;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * What a key names: FACTS[entry].value, or one field of it, with FACTS[entry].source. It takes any string, so the
 * SOURCES key can resolve a data-fact read back from the page; it throws on a key FACTS does not have.
 */
export function resolveFact(key: string): ResolvedFact {
  const dot = key.indexOf(".");
  const entry = dot === -1 ? key : key.slice(0, dot);
  if (!Object.hasOwn(FACTS, entry)) throw new Error(`no fact ${JSON.stringify(entry)} in content/facts.ts`);
  const fact = FACTS[entry as EntryName];
  if (dot === -1) return { value: fact.value, source: fact.source };
  const field = key.slice(dot + 1);
  const value: unknown = fact.value;
  if (!isPlainObject(value) || !Object.hasOwn(value, field)) {
    throw new Error(`no field ${JSON.stringify(field)} in FACTS.${entry}`);
  }
  const fieldValue = value[field];
  if (typeof fieldValue === "object" || fieldValue === undefined) {
    throw new Error(`FACTS.${entry}.${field} is not one number, string or boolean`);
  }
  return { value: fieldValue, source: fact.source };
}

/** The data-fact value for one or more keys: space-separated, each one known and none repeated. */
export function factAttr(keys: FactKey | readonly FactKey[]): string {
  const list: readonly string[] = typeof keys === "string" ? [keys] : keys;
  if (list.length === 0) throw new Error("data-fact needs at least one key");
  if (new Set(list).size !== list.length) throw new Error(`a fact key is repeated: ${list.join(" ")}`);
  for (const k of list) resolveFact(k);
  return list.join(" ");
}

/** The elements a figure may already sit in. */
export type FigTag = "span" | "strong" | "b" | "dd" | "dt" | "td" | "p" | "div" | "li";

export interface FigProps {
  /** The fact, or the facts, the whole string comes from. */
  k: FactKey | readonly FactKey[];
  /** The element that holds the whole string; Fig adds no element of its own inside it. */
  as?: FigTag;
  /** The whole string, written from FACTS by the caller, for example "24h" or "100 bps". */
  children: string | number;
  className?: string;
}

/**
 * Marks the element that already holds a whole string with data-fact (spec section 10.2), and adds nothing inside it,
 * so a test that matches the string still matches. The SOURCES captions come later, on the client, from resolveFact.
 */
export function Fig({ k, as: Tag = "span", children, className }: FigProps) {
  return (
    <Tag data-fact={factAttr(k)} className={className}>
      {children}
    </Tag>
  );
}
