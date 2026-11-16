/**
 * The public surface of the Solidity sources: contracts, their external and public functions (including the
 * getters Solidity generates for public state), events, errors, enums and structs. Built for this repo's
 * forge-fmt formatted sources, and cross-checked against the agent's compiled ABI by test/docs-gen.test.ts.
 */

export interface SolParam {
  readonly type: string;
  readonly name: string;
  readonly indexed?: boolean;
}

export type Mutability = "nonpayable" | "payable" | "view" | "pure";

export interface SolFunction {
  readonly name: string;
  /** "function" for declared functions, "getter" for public state variables and constants. */
  readonly kind: "function" | "getter";
  /** As declared; getters are always public. */
  readonly visibility: "external" | "public";
  readonly params: readonly SolParam[];
  readonly returns: readonly SolParam[];
  readonly mutability: Mutability;
  /** Who may call it: "anyone", or the role a modifier or first-line check enforces ("owner", "executor", "vault"). */
  readonly access: string;
  readonly notice: string;
}

export interface SolEvent {
  readonly name: string;
  readonly params: readonly SolParam[];
  readonly notice: string;
}

export interface SolError {
  readonly name: string;
  readonly params: readonly SolParam[];
  readonly notice: string;
}

export interface SolEnum {
  readonly name: string;
  readonly file: string;
  readonly members: readonly string[];
}

export interface SolStruct {
  readonly name: string;
  readonly file: string;
  readonly fields: readonly SolParam[];
  readonly notice: string;
}

export interface SolContract {
  readonly name: string;
  readonly kind: "contract" | "interface" | "library";
  /** Repo-relative path of the defining file. */
  readonly file: string;
  readonly notice: string;
  readonly functions: readonly SolFunction[];
  readonly events: readonly SolEvent[];
  readonly errors: readonly SolError[];
}

export interface SolSurface {
  readonly contracts: readonly SolContract[];
  readonly enums: readonly SolEnum[];
  readonly structs: readonly SolStruct[];
}

export interface SolSource {
  /** Repo-relative path, e.g. "contracts/src/MandateVault.sol". */
  readonly file: string;
  readonly text: string;
}

/** Same length as the input, comments replaced by spaces, so offsets still line up with the original. */
function blankComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));
}

/**
 * The `///` lines directly above `offset`, joined with spaces. `@dev`, `@param` and `@return` lines are dropped
 * and the `@notice` and `@title` tags are stripped. Block comments are not read: this repo's sources have none.
 */
function natspecAbove(original: string, offset: number): string {
  const lines = original.slice(0, offset).split("\n");
  lines.pop(); // the declaration's own line
  const doc: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = (lines[i] ?? "").trim();
    if (!line.startsWith("///")) break;
    doc.unshift(line.slice(3).trim());
  }
  return doc
    .filter((l) => !l.startsWith("@dev") && !l.startsWith("@param") && !l.startsWith("@return"))
    .map((l) => l.replace(/^@(notice|title)\s+/, ""))
    .join(" ")
    .trim();
}

/** Index of the bracket that closes the one at `open`. */
function matching(src: string, open: number, pair: "()" | "{}"): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === pair[0]) depth++;
    else if (src[i] === pair[1] && --depth === 0) return i;
  }
  throw new Error(`unbalanced ${pair} at offset ${open}`);
}

/** Split on commas that are not inside parentheses (mapping types contain none here, but tuples might). */
function splitTop(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

const LOCATIONS = new Set(["memory", "calldata", "storage"]);

function params(list: string): SolParam[] {
  return splitTop(list).map((p) => {
    const words = p.split(/\s+/).filter((w) => !LOCATIONS.has(w));
    const indexed = words.includes("indexed");
    const rest = words.filter((w) => w !== "indexed");
    const type = rest[0] ?? "";
    const name = rest.length > 1 ? (rest[rest.length - 1] ?? "") : "";
    return indexed ? { type, name, indexed } : { type, name };
  });
}

interface Decl {
  /** Text before the body or the terminating semicolon, whitespace collapsed. */
  readonly head: string;
  /** Body text between braces, if the declaration has one. */
  readonly body?: string;
  readonly offset: number;
}

/** Top-level declarations inside a contract body (or a whole file): whatever ends in `;` or a `{...}` block. */
function declarations(code: string, start: number, end: number): Decl[] {
  const out: Decl[] = [];
  let headStart = start;
  for (let i = start; i < end; i++) {
    const ch = code[i];
    if (ch === "{") {
      const close = matching(code, i, "{}");
      out.push({ head: code.slice(headStart, i), body: code.slice(i + 1, close), offset: headStart });
      i = close;
      headStart = close + 1;
    } else if (ch === ";") {
      out.push({ head: code.slice(headStart, i), offset: headStart });
      headStart = i + 1;
    }
  }
  return out.map((d) => {
    const lead = d.head.length - d.head.trimStart().length;
    return { ...d, head: d.head.replace(/\s+/g, " ").trim(), offset: d.offset + lead };
  });
}

const VISIBILITY = new Set(["external", "public", "internal", "private"]);
const MUTABILITY = new Set(["view", "pure", "payable"]);
const NOT_MODIFIERS = new Set([...VISIBILITY, ...MUTABILITY, "virtual", "override", "returns"]);

/**
 * Role named by a modifier such as onlyOwner, or by a first statement `if (msg.sender != owner) revert ...`.
 * The guard may also reject the zero address (`|| msg.sender == address(0)`), which still means one caller;
 * `&&` would mean any of several callers, so it is never read as a role. One leading underscore is dropped
 * from the name (`_activePool` is the role `activePool`).
 */
function accessOf(modifiers: readonly string[], body: string | undefined): string {
  const only = modifiers.find((m) => /^only[A-Z]/.test(m));
  if (only) return only.slice(4, 5).toLowerCase() + only.slice(5);
  const first = /^\s*if\s*\(\s*msg\.sender\s*!=\s*(\w+)\s*(?:\)|\|\|)/.exec(body ?? "");
  return first?.[1]?.replace(/^_/, "") ?? "anyone";
}

function parseFunction(d: Decl, notice: string): SolFunction | undefined {
  const m = /^function (\w+)\s*\(/.exec(d.head);
  if (!m?.[1]) return undefined;
  const open = d.head.indexOf("(");
  const close = matching(d.head, open, "()");
  const tail = d.head.slice(close + 1);
  const retAt = tail.search(/\breturns\s*\(/);
  const words = (retAt >= 0 ? tail.slice(0, retAt) : tail).split(/\s+/).filter(Boolean);
  const visibility = words.find((w) => VISIBILITY.has(w));
  if (visibility !== "external" && visibility !== "public") return undefined;
  let returns: SolParam[] = [];
  if (retAt >= 0) {
    const rOpen = tail.indexOf("(", retAt);
    returns = params(tail.slice(rOpen + 1, matching(tail, rOpen, "()")));
  }
  const modifiers = words.filter((w) => !NOT_MODIFIERS.has(w) && /^\w+$/.test(w));
  return {
    name: m[1],
    kind: "function",
    visibility,
    params: params(d.head.slice(open + 1, close)),
    returns,
    mutability: (words.find((w) => MUTABILITY.has(w)) as Mutability | undefined) ?? "nonpayable",
    access: accessOf(modifiers, d.body),
    notice,
  };
}

/** `mapping(address => mapping(uint256 day => uint256))` → keys [address, uint256], value uint256. */
function unwrapMapping(type: string): { keys: SolParam[]; value: string } {
  const keys: SolParam[] = [];
  let t = type.trim();
  while (t.startsWith("mapping")) {
    const open = t.indexOf("(");
    const inner = t.slice(open + 1, matching(t, open, "()"));
    const arrow = inner.indexOf("=>");
    const [keyType = "", keyName = ""] = inner.slice(0, arrow).trim().split(/\s+/);
    keys.push({ type: keyType, name: keyName });
    t = inner.slice(arrow + 2).trim();
    // A named value (`=> uint256 amount`) keeps only its type.
    if (!t.startsWith("mapping")) t = t.split(/\s+/)[0] ?? t;
  }
  return { keys, value: t };
}

function parseGetter(d: Decl, notice: string): SolFunction | undefined {
  if (d.body !== undefined || !/\bpublic\b/.test(d.head)) return undefined;
  if (/^(function|event|error|modifier|constructor|using|struct|enum)\b/.test(d.head)) return undefined;
  // The initializer's `=`, not the `=>` of a mapping type.
  const lhs = d.head.split(/=(?!>)/)[0]?.trim() ?? "";
  const nameMatch = /(\w+)$/.exec(lhs);
  if (!nameMatch?.[1]) return undefined;
  const typePart = lhs
    .slice(0, lhs.length - nameMatch[1].length)
    .replace(/\b(public|constant|immutable)\b/g, "")
    .trim();
  const { keys, value } = unwrapMapping(typePart);
  const arrays = value.match(/\[\]/g)?.length ?? 0;
  const indexParams = Array.from({ length: arrays }, () => ({ type: "uint256", name: "" }));
  return {
    name: nameMatch[1],
    kind: "getter",
    visibility: "public",
    params: [...keys, ...indexParams],
    returns: [{ type: value.replace(/\[\]/g, ""), name: "" }],
    // Solidity reports getters of constants as view too.
    mutability: "view",
    access: "anyone",
    notice,
  };
}

function parseSignature(d: Decl, keyword: "event" | "error", notice: string) {
  const m = new RegExp(`^${keyword} (\\w+)\\s*\\(`).exec(d.head);
  if (!m?.[1]) return undefined;
  const open = d.head.indexOf("(");
  return { name: m[1], params: params(d.head.slice(open + 1, matching(d.head, open, "()"))), notice };
}

interface RawContract extends SolContract {
  readonly bases: readonly string[];
  readonly libraries: readonly string[];
}

function parseFile(src: SolSource, enums: SolEnum[], structs: SolStruct[]): RawContract[] {
  const code = blankComments(src.text);
  const out: RawContract[] = [];
  const collectTypes = (decls: Decl[]) => {
    for (const d of decls) {
      const e = /^enum (\w+)$/.exec(d.head);
      if (e?.[1] && d.body !== undefined) {
        enums.push({ name: e[1], file: src.file, members: d.body.split(",").map((s) => s.trim()).filter(Boolean) });
      }
      const s = /^struct (\w+)$/.exec(d.head);
      if (s?.[1] && d.body !== undefined) {
        const fields = declarations(d.body, 0, d.body.length)
          .map((f) => params(f.head)[0])
          .filter((p): p is SolParam => p !== undefined);
        structs.push({ name: s[1], file: src.file, fields, notice: natspecAbove(src.text, d.offset) });
      }
    }
  };
  const fileDecls = declarations(code, 0, code.length);
  collectTypes(fileDecls);
  for (const d of fileDecls) {
    const m = /^(?:abstract )?(contract|interface|library) (\w+)(?: is (.+))?$/.exec(d.head);
    if (!m?.[1] || !m[2] || d.body === undefined) continue;
    const bodyStart = code.indexOf("{", d.offset) + 1;
    const decls = declarations(code, bodyStart, bodyStart + d.body.length);
    if (m[1] !== "library") collectTypes(decls);
    const notice = (d2: Decl) => natspecAbove(src.text, d2.offset);
    const functions: SolFunction[] = [];
    const events: SolEvent[] = [];
    const errors: SolError[] = [];
    const libraries: string[] = [];
    for (const x of decls) {
      const fn = parseFunction(x, notice(x)) ?? parseGetter(x, notice(x));
      if (fn) functions.push(fn);
      const ev = parseSignature(x, "event", notice(x));
      if (ev) events.push(ev);
      const er = parseSignature(x, "error", notice(x));
      if (er) errors.push(er);
      const lib = /^using (\w+) for /.exec(x.head);
      if (lib?.[1]) libraries.push(lib[1]);
    }
    out.push({
      name: m[2],
      kind: m[1] as SolContract["kind"],
      file: src.file,
      notice: natspecAbove(src.text, d.offset),
      functions,
      events,
      errors,
      bases: m[3] ? m[3].split(",").map((b) => b.trim()) : [],
      libraries,
    });
  }
  return out;
}

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, "en");

/**
 * Parse every source, then give each contract what the ABI would show: the events, errors and functions of
 * the interfaces it inherits, and the errors of the libraries it attaches with `using`. Library internals and
 * internal functions are left out. Output is sorted by name so it is stable across edits that only reorder.
 */
export function buildSurface(sources: readonly SolSource[]): SolSurface {
  const enums: SolEnum[] = [];
  const structs: SolStruct[] = [];
  const raw = sources.flatMap((s) => parseFile(s, enums, structs));
  const find = (name: string) => raw.find((c) => c.name === name);

  const resolve = (c: RawContract, seen = new Set<string>()): Omit<SolContract, "name" | "kind" | "file" | "notice"> => {
    const functions = new Map(c.functions.map((f) => [f.name, f]));
    const events = new Map(c.events.map((e) => [e.name, e]));
    const errors = new Map(c.errors.map((e) => [e.name, e]));
    for (const baseName of c.bases) {
      const base = find(baseName);
      if (!base || seen.has(baseName)) continue;
      const r = resolve(base, new Set([...seen, baseName]));
      // The derived contract's own declaration (with its access and notice) wins over the interface's.
      for (const f of r.functions) if (!functions.has(f.name)) functions.set(f.name, f);
      for (const e of r.events) if (!events.has(e.name)) events.set(e.name, e);
      for (const e of r.errors) if (!errors.has(e.name)) errors.set(e.name, e);
    }
    for (const libName of c.libraries) {
      for (const e of find(libName)?.errors ?? []) if (!errors.has(e.name)) errors.set(e.name, e);
    }
    return {
      functions: [...functions.values()].sort(byName),
      events: [...events.values()].sort(byName),
      errors: [...errors.values()].sort(byName),
    };
  };

  // Solidity's getter for a struct-valued variable returns the struct's members, not the struct, and leaves out
  // the members that are arrays or mappings. A declared function that returns a struct keeps returning the struct.
  const isOmitted = (p: SolParam) => p.type.includes("[") || p.type.startsWith("mapping");
  const expandGetter = (f: SolFunction): SolFunction => {
    const only = f.returns.length === 1 ? f.returns[0] : undefined;
    const struct = f.kind === "getter" && only ? structs.find((s) => s.name === only.type) : undefined;
    return struct ? { ...f, returns: struct.fields.filter((p) => !isOmitted(p)) } : f;
  };

  const contracts = raw
    .filter((c) => c.kind !== "library")
    .map((c) => {
      const r = resolve(c);
      return { name: c.name, kind: c.kind, file: c.file, notice: c.notice, ...r, functions: r.functions.map(expandGetter) };
    })
    .sort(byName);
  return { contracts, enums: enums.sort(byName), structs: structs.sort(byName) };
}
