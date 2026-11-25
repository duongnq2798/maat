# maat:v1 Rationale Blob and Journal Chain. Design Spec

- **Date:** 2026-11-25
- **Status:** written for Move 2 of the 2026-11-25 win plan ("Decisions that verify themselves"), which the owner
  approved on 2026-11-25 with decision D6 (a public, append-only `agent-journal` branch)
- **Built from it:** the agent encoder (`feat/rationale-calldata`), the web decoder (`feat/ledger-agent-trail`) and
  the journal publisher (`feat/journal-publisher`), each without further coordination. Every rule below is meant to
  be checked by a unit test; §5 gives the vectors
- **Related:** `agent/src/intent.ts`, `agent/src/exec/{builderCode,sender}.ts`, `agent/src/ledger/journal.ts`,
  `web/lib/chain/rationale.ts`, `contracts/src/Types.sol`, and two pieces that come from other branches: `closedNote`
  in `agent/src/refusals.ts` (from `fix/refusal-log-per-session`) and `agent/src/gitCommit.ts` (from
  `feat/agent-guardrails`)

---

## 1. Calldata

```
offset    bytes   content
0         4       selector 0x4ad3993f = execute((bytes32,uint8,address,uint256,uint256,address,bytes32))
4         224     Intent: 7 static words (contracts/src/Types.sol: id, action, token, amount, minOut, payee, rationaleHash)
196       32        of which Intent.rationaleHash, the 7th word
228       n_b     blob, "maat:v1:{...}", 0 to 1,024 bytes
228+n_b   n_s     ERC-8021 schema-0 suffix
```

`Intent` is a static struct, so `execute(Intent)` calldata is always 228 bytes. The suffix is what
`agent/src/exec/builderCode.ts` builds with ox `Attribution.toDataSuffix({ codes })`: `codes` (ASCII, comma-joined,
`n_c` bytes) ‖ `n_c` (1 byte) ‖ `0x00` (schema id) ‖ `0x80218021802180218021802180218021` (16 bytes), so
`n_s = n_c + 18`.

**Decoder.** Given the input `D` (length `L`) of a transaction whose `to` is the vault:

1. Require `L >= 228` and `D[0:4] == 0x4ad3993f`. Otherwise the transaction is not a direct `execute` call: no blob,
   no suffix.
2. If `L >= 246`, `D[L-16:L]` is the 16-byte marker and `D[L-17] == 0x00`: `n_c = D[L-18]`, `S = L - 18 - n_c`. If
   `S >= 228`, the suffix is `D[S:L]` and its codes are `ascii(D[S:L-18]).split(",")`. In every other case `S = L` (no
   suffix recognized; schema ids 1 and 2 are not decoded in v1).
3. The blob region is `B = D[228:S]`. Empty: status `none`. Starts with the 8 bytes `maat:v1:`: validate it (§2.6).
   Anything else: status `foreign` (show its length, decode nothing).
4. Hash tick, only when `B` is non-empty: `keccak256(B) == D[196:228]`. The vault emits this word unchanged as the
   `Decision` log's `rationaleHash` (`MandateVault.sol:112`). For status `none` the tick is
   `verifyRationale(text from the rationales export, D[196:228])` instead, as for the two owner Decisions below:
   `keccak256` of no bytes (`0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470`) commits to no text.

A decoder never finds the end of the blob by parsing JSON or searching for `}`: the end is the start of the suffix.
ox `Attribution.fromData(D)` reads from the end, so it returns the same codes with a blob present (§5.6).

**The two owner Decisions on chain** (read on 2026-11-25 with `cast tx <hash> input`, `cast call` on
https://base-rpc.publicnode.com):

| Tx | Block | Input |
|---|---|---|
| `0xdfdb6739912a73542d90129bd7269a939dc8b2d47a869f56d9ab5e3a02e86c3b` (MARKET_CLOSED) | 61,700,601 | 257 bytes = 4 + 224 + a 29-byte suffix holding one 11-byte code |
| `0x61622340a151c73c3f2b3bc910292a3e3136bd4aa7ecd55a92f59914953a23c8` (OK) | 61,745,836 | same layout; only the intent id differs |

Both have no blob (`S = 228`, status `none`). Their `rationaleHash` is
`0x0baa4c52e17e7acc5c7cc851e57a9df523c70b5a1530d77055bb2401370f57f6`, which is `keccak256` of the default text of
`agent/scripts/first-decision.ts`, `Owner-sent first decision: BUY 5 USD of NVDAc`. Their `tx.from` is
`0x3c3a66f713DAE7e4A03Bbd81dB79FF65F42C1D6a`, which was both `owner()` and `executor()` at both blocks. The web keeps
verifying their text as it does today, from the rationales export (`verifyRationale` in `web/lib/chain/rationale.ts`).

**Agent side.** `GuardedSender` stays the only path to a send. It sends `encodeExecute(intent) ‖ blob ‖ suffix`: a
`blob` field on `TxRequest`, checked in `GuardedSender` (prefix, at most 1,024 bytes, printable ASCII, `keccak256(blob)`
equal to the `rationaleHash` word of `data`) and appended before the suffix. Gas is estimated on the full calldata
(the plan puts a 1,024-byte blob at about 16k gas). viem 2.57.16 `decodeFunctionData` accepts the trailing blob
(checked with the §5 script), so the existing decode check still passes, but the blob checks above are explicit.

## 2. The blob

### 2.1 Fields

| Key | Type | Rule |
|---|---|---|
| `b` | integer | Block number of the `VaultState` the intent was built from (`s.blockNumber`) |
| `c` | string | The agent's git commit: the value of `gitCommit()` (`agent/src/gitCommit.ts`), the same value `Journal.append` stamps as each journal row's `commit`. `^(?:[0-9a-f]{40}(?:-dirty)?\|unknown)$`: the 40-hex HEAD of a clean checkout, that HEAD followed by `-dirty` when tracked files under `agent/` differ from it, or `unknown` when git cannot tell. A decoder shows `-dirty` and `unknown` as they are, since then `c` does not pin the code that ran |
| `j` | string | Journal head: the `hash` of the last row in the journal when the blob is built (§3.3); `GENESIS` if there is none. `0x` and 64 lowercase hex |
| `k` | string, optional | Absent: `t` is the model's text. `"probe"`: a fixed-time probe, and `t` starts with `PROBE v1, not a Claude proposal`. `"bill"`: the agent's PAY_EXPENSE, and `t` is its code-written `Compute bill: ...` line. In all three cases, a MARKET_CLOSED log-refusal ends `t` with the closed-market note (§2.5) |
| `m` | string | The model that wrote `t` (the one that answered, after any fallback), `^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$`, and matches neither `URL_RE` nor `KEY_RE` (§2.3); the encoder refuses to build a blob otherwise. A Bedrock-style id such as `us.anthropic.claude-sonnet-5-5` fits the pattern but matches `URL_RE`. Required when `k` is absent, forbidden when `k` is present |
| `q` | array of integers, optional | `MaatInbox` brief ids the intent adopts: 1 to 3 strictly ascending safe integers, `>= 0`. Only with `k` absent. `t` is then the agent's templated text, not free model text |
| `r` | string | The run id, `^[A-Za-z0-9._:-]{1,64}$` (the `runOnce` form `<Date.now()>-<8 hex>` fits), and matches neither `URL_RE` nor `KEY_RE` (§2.3); the encoder refuses to build a blob otherwise |
| `s` | array | One entry per vault token, in `tokens()` order at block `b`: `[sym, roundId, updatedAt, premiumBps]`. At most 16 entries |
| `t` | string | `sanitize(text, 600)` (§2.3), or `sanitize(text, 600 - n.length) + n` on a MARKET_CLOSED log-refusal (§2.5); 1 to 600 characters |

No other key is allowed. An absent optional key is omitted, never `null`. `b` is a safe integer `>= 0`. In an `s`
entry:

- `sym`: the symbol from `BASKET` in `agent/src/addresses.ts` (`^[A-Za-z0-9]{1,16}$`), else the token's lowercase
  `0x` address.
- `roundId`: the `latestRoundData` round id as a decimal string (`^(0|[1-9][0-9]{0,24})$`), since a uint80 exceeds
  2^53 (the NVDAc feed read `36893488147419105055` at block 61,745,836); `null` when the call failed.
- `updatedAt`: the round's `updatedAt` in seconds, a safe integer `>= 0`; `null` when the call failed.
- `premiumBps`: a safe integer, `sign(twap - answer) * PriceLib.premiumBps(twap, answer)`, where `twap` is
  `PriceLib.twapPrice(pool, token, mandate.twapWindow)` at block `b` (the bigint port is `web/lib/live/price.ts`). Its
  absolute value is the number the vault compares with `maxPremiumBps`; positive means the pool is above the feed.
  `null` when the answer fails the `PriceLib.readFeed` rule (answer `<= 0`, `updatedAt` 0 or later than the block)
  or the TWAP is unavailable.

### 2.2 Canonical serialization

```js
function canon(v) {
  if (v === null || typeof v === "string" || typeof v === "boolean") return JSON.stringify(v);
  if (typeof v === "number") { if (!Number.isSafeInteger(v)) throw new Error("integers only"); return JSON.stringify(v); }
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
}
blob = "maat:v1:" + canon({ b, c, j, k, m, q, r, s, t });
```

Keys sort to `b, c, j, k, m, q, r, s, t` (text last, so Basescan's UTF-8 view ends with the words). No whitespace.
Numbers are base-10 integers with no exponent, fraction or plus sign. Strings hold printable ASCII only, so the only
escapes are `\"` and `\\`. The blob's byte length is its character length. The journal (§3) uses the same `canon`.

### 2.3 Sanitizer

`sanitize(text, max)`:

1. By code point: `U+0020-U+007E` kept. Mapped: `U+2018 U+2019 U+201A U+2032` to `'`; `U+201C U+201D U+201E U+2033`
   to `"`; `U+2010-U+2015 U+2212` to `-`; `U+2026` to `...`; `U+2192` to `->`; `U+2190` to `<-`; `U+2248` to `~`;
   `U+00D7` to `x`. To one space: `U+0000-U+001F` (tab, CR and LF included), `U+007F-U+009F`, `U+00A0`,
   `U+2000-U+200A`, `U+2028`, `U+2029`, `U+202F`, `U+205F`, `U+3000`. Every other code point is dropped.
2. Replace, in this order: `URL_RE` by `[url]`, `HEX_RE` by `[hex]`, `KEY_RE` by `[key]`, `LONG_RE` by `[key]`.
3. Collapse runs of spaces to one space; trim both ends.
4. If empty: `(no text)`.
5. If longer than `max`: the longest cut that is at most `max` characters. The cuts of a text are, longest first,
   each prefix that ends just before one of its spaces followed by ` ...`, and last `...` alone.

```js
const URL_RE  = /\b[a-z][a-z0-9+.-]*:\/\/\S*|\bwww\.\S*|\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b(?:\/\S*)?/gi;
const HEX_RE  = /\b(?:0x)?[0-9a-f]{64,}\b/gi;
const KEY_RE  = /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bxox[abprs]-[A-Za-z0-9-]{10,}|\bAKIA[0-9A-Z]{16}\b|-----BEGIN[A-Z ]*-----/g;
const LONG_RE = /[A-Za-z0-9+\/_-]{40,}={0,2}/g;
```

`URL_RE` is deliberately broad: a bare `name.tld` is stripped too, so `NVDAc.price` becomes `[url]` (§5.8). The same
four patterns are the publisher's deny list (§3.5). A cut ends on a whole word followed by a space, so it cannot
create a match the uncut text did not have (a cut in the middle of a word could turn `www` into `www...`); a
sanitized field therefore never stops the publisher.

### 2.4 Byte cap

The blob is at most 1,024 bytes, prefix included. When `canon` gives more:

1. `t` becomes the longest of its cuts (§2.3 step 5) with which the blob fits. Cuts fall on spaces and a `"` or `\`
   costs 2 bytes, so a capped blob can be a few bytes under 1,024. A `t` that ends with the closed-market note `n`
   (§2.5) is cut only before `n`: its cuts are those of the part before `n`, each followed by `n`. With `k`, only the
   cuts that keep the start `t` must have (§2.1, `k`) count, such as `Compute bill: ...`.
2. If the shortest cut (`...`, or `...` followed by `n`; with `k`, the shortest cut that keeps the start) still does
   not fit, drop `s` entries from the end until it does.

With every other field at its maximum (`c` with `-dirty`) and `t = "..."`, the blob is 372 bytes with `s` empty and
623 bytes with 3 symbol entries (701 if every entry falls back to its address). The longest `n` adds 59 bytes. So
step 2 can only run with 6 or more tokens (8 or more when every entry is named by symbol), with or without `n`.

### 2.5 Hash

`Intent.rationaleHash = keccak256(blob bytes)`. The blob is ASCII, so this is exactly `rationaleHash(blob)` in
`agent/src/intent.ts` (`keccak256(toBytes(text))`), and the web's `verifyRationale(blob, hash)` returns `verified`
with no change. `buildIntent` hashes the blob, not `p.rationale`. The vault's checks never read `rationaleHash`, so
the preview does not depend on the blob.

**Closed-market note.** When the gate sends a MARKET_CLOSED refusal to be logged onchain, the agent adds the closed
phase to the text after the preview. Without a blob it appends ` (market closed, <closedNote(s)>)` to the plain
rationale and re-hashes that (`agent/src/loop/runOnce.ts`, from `fix/refusal-log-per-session`). With a blob, that
re-hash is replaced by this rule:

- `n = " (market closed, " + closedNote(s) + ")"`. Every `closedNote` value is code-written printable ASCII that none
  of the four §2.3 patterns matches. The longest, `NYSE holiday: Independence Day (observed)`, makes `n` 59 characters.
  When `closedNote(s)` is null (no calendar, or the calendar does not say closed), there is no note and no rebuild.
- `t = sanitize(text, 600 - n.length) + n`, where `text` is the text `t` would hold without the note (§2.1), whatever
  `k` is. §2.4 step 1 cuts only the part before `n`.
- After the preview the agent rebuilds the blob with this `t`, keeps every other field (`j` included), sets
  `rationaleHash` to its `keccak256`, and sends that intent. The `intent` and `sent` rows carry the rebuilt blob and
  hash.

Sanitizing the joined text instead would cut the note away first, since the model may write 600 characters
(`MAX_RATIONALE_CHARS` in `agent/src/llm/schema.ts`). V6 and V7 (§5) are the vectors.

### 2.6 Decoder validation

Status `v1` when all hold: at most 1,024 bytes; every byte in `0x20-0x7E`; the text after `maat:v1:` parses to a
JSON object; it has only the §2.1 keys, each with its type and rule (for `c` the `gitCommit()` pattern, and for `m`
and `r` matching neither `URL_RE` nor `KEY_RE`); and `"maat:v1:" + canon(parsed)` equals the bytes (this rejects
key order, whitespace and duplicate keys). Otherwise status `invalid`. The blob's hash tick (§1 step 4) is shown for
`v1`, `invalid` and `foreign`, since it covers bytes, not format. Decoders do not re-run the sanitizer on `t`.

## 3. Hash-chained journal

### 3.1 Row hash

Every row the agent appends to `journal.jsonl` gets `prev` and `hash`:

- `P = project(row)`, the public projection (§3.2).
- `prev`: the previous row's `hash`; for the first chained row,
  `GENESIS = 0x0000000000000000000000000000000000000000000000000000000000000000`.
- `hash = keccak256(utf8(canon({ ...P, prev })))`.

The local line keeps every field plus `prev` and `hash`; the published line is `canon({ ...P, prev, hash })`. The hash
covers the projection, not the private fields, so a browser can recompute it from the public line. The `Journal`
class keeps the last hash in memory and must read it back from the last line at start. A journal written before this
change has rows without `hash`: the chain starts at the first row that has one, and every later row must have one.
A local line that does not parse as a JSON object is a write a crash cut short: it carries no row, the agent starts a
fresh line after it, and every reader of the local journal passes over it. The next row's `prev` still names the last
whole row, so a row removed behind such a line still breaks the chain.

### 3.2 Projection: the publisher's allowlist

Every kind: `ts`, `kind`, `runId`, `commit`, `prev`, `hash`. `commit` is the value of `gitCommit()`
(`agent/src/gitCommit.ts`), stamped by `Journal.append`: the same forms as `c` (§2.1). Rows written before that
change have none.

| Kind | Further fields |
|---|---|
| `run` | `block`, `day`, `mode`, `ok`, `costUsd6`, `suggestions`, `proposals`, `summary` (as `sanitize(summary, 600)`; absent when the row's `summary` is empty after sanitizer steps 1-3 (§2.3), as one of only spaces, emoji or other dropped characters is, never `(no text)`), `capped` (`true` when the row's `error` starts with `llm cap: `: the daily LLM cap stopped the round before Claude was called; else absent) |
| `intent` | `index`, `intentId`, `action`, `symbol`, `amountUsd6`, `rationaleHash`, `blob`, `preview`, `gate`, `txHash`, `gasUsed`, `decision` |
| `sent` | `index`, `intentId`, `action`, `symbol`, `amountUsd6`, `rationaleHash`, `blob`, `preview`, `gate`, `txHash`, `gas` |
| `reconcile` | `intentId`, `action`, `txHash`, `outcome`, `decision` |
| `mismatch` | `intentId`, `preview`, `decision` |
| `housekeeping` | `call`, `token`, `txHash`, `gas`, `gasUsed` |
| `skip` | `index`, `symbol`, `action` |
| `probe` | `at`, `expected`, `outcome` (one MAAT_PROBES instant: `at` as `YYYY-MM-DDTHH:MM:SSZ`, `expected` `OK` or `MARKET_CLOSED` when the calendar was read, `outcome` one of `sent`, `dry-run`, `skipped`, `halted`, `missed`, `capped`) |
| `error` and any other kind | none |

Never exported: `rationale` (the raw model text; its clean form is `t` inside `blob`), `previewError`, `error` (a
`run` row's only trace of it is `capped`), `message`, `note`, and every field not listed. A field absent on the row
is absent in `P`. Values keep their on-disk JSON types (bigints are decimal strings). The branch that adds a new row
kind (probes, briefs) adds its fields to this table; until then the kind exports the common fields only.

### 3.3 What `j` anchors

`j` is the `hash` of the last row in the journal when the blob is built, so it precedes the intent's own `intent` and
`sent` rows. A Decision with a blob commits, at its block time, to every journal row up to `j`: rewriting any of them
changes the hash `j` names.

### 3.4 The `agent-journal` branch

- Repository `duongnq2798/maat`, branch `agent-journal`. Never merged into `main`, never force-pushed; one commit
  per push, about every 15 minutes (D6), pushed from the owner's PC with the owner's git login.
- `journal/YYYY-MM-DD.jsonl`: published lines, one canonical JSON object per line, each ending in LF, in journal
  order. The file is the UTC date of the row's `ts`, but never earlier than the previous row's file. Lines are only
  ever appended.
- `journal/index.json`, rewritten on each push as `canon({ days, head, rows, v: 1 })`: the day files in order, the last
  published `hash` and the line count. It is for discovery only; verifiers do not trust it.
- Read from `https://raw.githubusercontent.com/duongnq2798/maat/agent-journal/journal/<file>`.

### 3.5 Publisher rules

- It reads the local journal, takes the chained rows after the last published line, projects them, recomputes each
  `hash` and checks every `prev` link, passing over a line a crash cut short (§3.1). On any mismatch it stops and
  pushes nothing.
- Deny check before each commit: the whole line against `URL_RE` and `KEY_RE`; free-text values (`summary`, and `t`
  decoded from `blob`) also against `HEX_RE` and `LONG_RE`. A hit stops the publisher; it never skips a line, since a
  gap would break the chain. The agent sanitizes the same fields with the same patterns, so a hit is a bug.
- A line once published is never changed. Pushes are plain `git push`, never `--force`.
- Only the fields in §3.2 leave the PC, so no key, `.env` value, RPC endpoint or provider error text can reach a line.

### 3.6 Browser verifier

1. Fetch `index.json`, then every day file in order.
2. For each line: parse it; check that the line equals `canon(parsed)`; recompute `hash` from `parsed` without
   `hash`; check `prev` against the previous line's `hash` (`GENESIS` for the very first line).
3. Report the rows verified, the head hash, and the first failing file and line number, if any.
4. For a Decision with a `v1` blob, find the `sent` or `reconcile` row whose `txHash` is the transaction's hash. None:
   `pending` (the publisher has not caught up). Found: `anchored` if `j` is the `hash` of an earlier row, or `j` is
   `GENESIS` and no chained row precedes the found row, and, for a `sent` row, its `blob` equals the onchain blob;
   otherwise `broken`.

## 4. Sender labels

`owner` is immutable on the deployed vault (`MandateVault.sol:30`), and `execute` reverts unless `msg.sender` is the
executor (`MandateVault.sol:103`). So the `tx.from` of a direct `execute` call is the executor at that moment, and
the label depends on whether that executor was the owner. First match wins:

| Label | Rule |
|---|---|
| owner, by hand | `tx.from == owner()` |
| probe | blob status `v1` and `k == "probe"` |
| brief-driven | blob status `v1` and `q` present |
| agent | every other Decision: an executor that is not the owner, with a `v1` blob (`k` absent or `"bill"`), no blob, or a blob that is `invalid` or `foreign` |

The web shows the blob status next to the label. Both owner Decisions above are "owner, by hand", and so is any
Decision the owner sends while still the executor, whatever its calldata carries.

## 5. Test vectors

Computed on 2026-11-25 by a node script (viem 2.57.16 and ox 1.8.13 from `agent/node_modules`) that implements §1-§3
as written. Shared inputs:

- Fixtures: `c = "0123456789abcdef0123456789abcdef01234567"`, `r = "1795539542000-a1b2c3d4"`, and every `t`.
- `j = 0x892d2dce569c783139f62dec297729642d35ff7e88bccd9d21dcb2defe2b84ff`, the `hash` of the fixture `run` row in §5.7.
- `b = 61745836` and `s` are real reads at block 61,745,836 (`tokens()`, `tokenConfig`, `latestRoundData`, the
  pool's `observe([1800, 0])`, with `twapWindow` 1800 from `mandate()`):
  `[["NVDAc","36893488147419105055",1795539382,19],["GOOGLc","36893488147419104206",1795536312,15],["AAPLc","36893488147419103860",1795535458,23]]`.

| Vector | Other inputs | Bytes | `keccak256(blob)` |
|---|---|---|---|
| V1 agent | `m = "claude-sonnet-5-5"`, `t = "Fixture rationale: NVDAc is under its target weight and the feed is fresh, so buy 5 USD."` | 438 | `0xbc7e8a953617d15492fcb18bacbcacc9db09d8138a717810f4786fceefc1d27d` |
| V2 URL stripped | `m` as V1, `t` = the JS string `"Fixture \u2014 premium check.\nSee https://basescan.org/tx/0xabc and www.example.com/x for context; vault says \u201cno\u201d."` | 426 | `0xa884246bbe0534ed0e343a7c2cf7f1b4641ef319aeb6df7c3ccd00afb75506f8` |
| V3 byte cap | `m` as V1, `t = "Fixture text: " + 'He said "no" and "wait". '.repeat(30)` (764 characters; cut at a space to at most 600, then again by the byte cap, to 584) | 1024 | `0x9accf0868e9e52563b653d19c68a2292f9d520bd69478e4b539ca47039a1ae93` |
| V4 probe | `k = "probe"`, no `m`, `r = "probe-2026-11-27T17:58:00Z"`, `t = "PROBE v1, not a Claude proposal. Expected OK before the 13:00 ET early close."` | 419 | `0x86a5af724c86d1a661cbc504d6f7df361bb0a926ca1a466acf9c3fc85d3aa4b0` |
| V5 brief-driven | `m` as V1, `q = [7]`, `t = "Brief 7 asked for a 5 USD NVDAc buy; adopted inside the mandate."` | 422 | `0x1912e906089e9d2abfadd10dc0e6d73f1d22986666aeb0dc4a600eca9e9ca7ab` |
| V6 closed market | `m` and model text as V1, logged as a MARKET_CLOSED refusal on the NYSE holiday 2026-11-26, so `n = " (market closed, NYSE holiday: Thanksgiving)"` (44 characters, §2.5). The preview ran with V1's hash | 482 | `0x8711ec8454ee9a5dc132c4e1dc1c2b161e66d3ac4686d8ba786eb4866910417f` |
| V7 closed market, cut | `m` as V1, `n` as V6, model text `"Fixture text: " + "NVDAc is under its target. ".repeat(21)` (581 characters, 580 after the trim; cut at a space to at most 600 - 44 = 556, to 549, then `n`: 593) | 943 | `0x25c7887f9483b70fd78eb762e9804f8d4b2aa3399ea672b42c95785850ef3abd` |

V1:

```
maat:v1:{"b":61745836,"c":"0123456789abcdef0123456789abcdef01234567","j":"0x892d2dce569c783139f62dec297729642d35ff7e88bccd9d21dcb2defe2b84ff","m":"claude-sonnet-5-5","r":"1795539542000-a1b2c3d4","s":[["NVDAc","36893488147419105055",1795539382,19],["GOOGLc","36893488147419104206",1795536312,15],["AAPLc","36893488147419103860",1795535458,23]],"t":"Fixture rationale: NVDAc is under its target weight and the feed is fresh, so buy 5 USD."}
```

V2 (`t` after the sanitizer):

```
maat:v1:{"b":61745836,"c":"0123456789abcdef0123456789abcdef01234567","j":"0x892d2dce569c783139f62dec297729642d35ff7e88bccd9d21dcb2defe2b84ff","m":"claude-sonnet-5-5","r":"1795539542000-a1b2c3d4","s":[["NVDAc","36893488147419105055",1795539382,19],["GOOGLc","36893488147419104206",1795536312,15],["AAPLc","36893488147419103860",1795535458,23]],"t":"Fixture - premium check. See [url] and [url] for context; vault says \"no\"."}
```

V4 and V5 differ from V1 only in `k`, `m`, `q`, `r` and `t`:

```
maat:v1:{"b":61745836,"c":"0123456789abcdef0123456789abcdef01234567","j":"0x892d2dce569c783139f62dec297729642d35ff7e88bccd9d21dcb2defe2b84ff","k":"probe","r":"probe-2026-11-27T17:58:00Z","s":[["NVDAc","36893488147419105055",1795539382,19],["GOOGLc","36893488147419104206",1795536312,15],["AAPLc","36893488147419103860",1795535458,23]],"t":"PROBE v1, not a Claude proposal. Expected OK before the 13:00 ET early close."}
maat:v1:{"b":61745836,"c":"0123456789abcdef0123456789abcdef01234567","j":"0x892d2dce569c783139f62dec297729642d35ff7e88bccd9d21dcb2defe2b84ff","m":"claude-sonnet-5-5","q":[7],"r":"1795539542000-a1b2c3d4","s":[["NVDAc","36893488147419105055",1795539382,19],["GOOGLc","36893488147419104206",1795536312,15],["AAPLc","36893488147419103860",1795535458,23]],"t":"Brief 7 asked for a 5 USD NVDAc buy; adopted inside the mandate."}
```

V6 differs from V1 only in `t`, which ends with the closed-market note:

```
maat:v1:{"b":61745836,"c":"0123456789abcdef0123456789abcdef01234567","j":"0x892d2dce569c783139f62dec297729642d35ff7e88bccd9d21dcb2defe2b84ff","m":"claude-sonnet-5-5","r":"1795539542000-a1b2c3d4","s":[["NVDAc","36893488147419105055",1795539382,19],["GOOGLc","36893488147419104206",1795536312,15],["AAPLc","36893488147419103860",1795535458,23]],"t":"Fixture rationale: NVDAc is under its target weight and the feed is fresh, so buy 5 USD. (market closed, NYSE holiday: Thanksgiving)"}
```

<details><summary>V3 and V7 text and the hex of every vector</summary>

V3:

```
maat:v1:{"b":61745836,"c":"0123456789abcdef0123456789abcdef01234567","j":"0x892d2dce569c783139f62dec297729642d35ff7e88bccd9d21dcb2defe2b84ff","m":"claude-sonnet-5-5","r":"1795539542000-a1b2c3d4","s":[["NVDAc","36893488147419105055",1795539382,19],["GOOGLc","36893488147419104206",1795536312,15],["AAPLc","36893488147419103860",1795535458,23]],"t":"Fixture text: He said \"no\" and \"wait\". He said \"no\" and \"wait\". He said \"no\" and \"wait\". He said \"no\" and \"wait\". He said \"no\" and \"wait\". He said \"no\" and \"wait\". He said \"no\" and \"wait\". He said \"no\" and \"wait\". He said \"no\" and \"wait\". He said \"no\" and \"wait\". He said \"no\" and \"wait\". He said \"no\" and \"wait\". He said \"no\" and \"wait\". He said \"no\" and \"wait\". He said \"no\" and \"wait\". He said \"no\" and \"wait\". He said \"no\" and \"wait\". He said \"no\" and \"wait\". He said \"no\" and \"wait\". He said \"no\" and \"wait\". He said \"no\" and \"wait\". He said \"no\" and \"wait\". He said \"no\" and ..."}
```

V7:

```
maat:v1:{"b":61745836,"c":"0123456789abcdef0123456789abcdef01234567","j":"0x892d2dce569c783139f62dec297729642d35ff7e88bccd9d21dcb2defe2b84ff","m":"claude-sonnet-5-5","r":"1795539542000-a1b2c3d4","s":[["NVDAc","36893488147419105055",1795539382,19],["GOOGLc","36893488147419104206",1795536312,15],["AAPLc","36893488147419103860",1795535458,23]],"t":"Fixture text: NVDAc is under its target. NVDAc is under its target. NVDAc is under its target. NVDAc is under its target. NVDAc is under its target. NVDAc is under its target. NVDAc is under its target. NVDAc is under its target. NVDAc is under its target. NVDAc is under its target. NVDAc is under its target. NVDAc is under its target. NVDAc is under its target. NVDAc is under its target. NVDAc is under its target. NVDAc is under its target. NVDAc is under its target. NVDAc is under its target. NVDAc is under its target. NVDAc is under its ... (market closed, NYSE holiday: Thanksgiving)"}
```

V1 hex: `0x6d6161743a76313a7b2262223a36313734353833362c2263223a2230313233343536373839616263646566303132333435363738396162636465663031323334353637222c226a223a22307838393264326463653536396337383331333966363264656332393737323936343264333566663765383862636364396432316463623264656665326238346666222c226d223a22636c617564652d736f6e6e65742d352d35222c2272223a22313739353533393534323030302d6131623263336434222c2273223a5b5b224e56444163222c223336383933343838313437343139313035303535222c313739353533393338322c31395d2c5b22474f4f474c63222c223336383933343838313437343139313034323036222c313739353533363331322c31355d2c5b224141504c63222c223336383933343838313437343139313033383630222c313739353533353435382c32335d5d2c2274223a224669787475726520726174696f6e616c653a204e5644416320697320756e64657220697473207461726765742077656967687420616e642074686520666565642069732066726573682c20736f206275792035205553442e227d`

V2 hex: `0x6d6161743a76313a7b2262223a36313734353833362c2263223a2230313233343536373839616263646566303132333435363738396162636465663031323334353637222c226a223a22307838393264326463653536396337383331333966363264656332393737323936343264333566663765383862636364396432316463623264656665326238346666222c226d223a22636c617564652d736f6e6e65742d352d35222c2272223a22313739353533393534323030302d6131623263336434222c2273223a5b5b224e56444163222c223336383933343838313437343139313035303535222c313739353533393338322c31395d2c5b22474f4f474c63222c223336383933343838313437343139313034323036222c313739353533363331322c31355d2c5b224141504c63222c223336383933343838313437343139313033383630222c313739353533353435382c32335d5d2c2274223a2246697874757265202d207072656d69756d20636865636b2e20536565205b75726c5d20616e64205b75726c5d20666f7220636f6e746578743b207661756c742073617973205c226e6f5c222e227d`

V3 hex: `0x6d6161743a76313a7b2262223a36313734353833362c2263223a2230313233343536373839616263646566303132333435363738396162636465663031323334353637222c226a223a22307838393264326463653536396337383331333966363264656332393737323936343264333566663765383862636364396432316463623264656665326238346666222c226d223a22636c617564652d736f6e6e65742d352d35222c2272223a22313739353533393534323030302d6131623263336434222c2273223a5b5b224e56444163222c223336383933343838313437343139313035303535222c313739353533393338322c31395d2c5b22474f4f474c63222c223336383933343838313437343139313034323036222c313739353533363331322c31355d2c5b224141504c63222c223336383933343838313437343139313033383630222c313739353533353435382c32335d5d2c2274223a224669787475726520746578743a2048652073616964205c226e6f5c2220616e64205c22776169745c222e2048652073616964205c226e6f5c2220616e64205c22776169745c222e2048652073616964205c226e6f5c2220616e64205c22776169745c222e2048652073616964205c226e6f5c2220616e64205c22776169745c222e2048652073616964205c226e6f5c2220616e64205c22776169745c222e2048652073616964205c226e6f5c2220616e64205c22776169745c222e2048652073616964205c226e6f5c2220616e64205c22776169745c222e2048652073616964205c226e6f5c2220616e64205c22776169745c222e2048652073616964205c226e6f5c2220616e64205c22776169745c222e2048652073616964205c226e6f5c2220616e64205c22776169745c222e2048652073616964205c226e6f5c2220616e64205c22776169745c222e2048652073616964205c226e6f5c2220616e64205c22776169745c222e2048652073616964205c226e6f5c2220616e64205c22776169745c222e2048652073616964205c226e6f5c2220616e64205c22776169745c222e2048652073616964205c226e6f5c2220616e64205c22776169745c222e2048652073616964205c226e6f5c2220616e64205c22776169745c222e2048652073616964205c226e6f5c2220616e64205c22776169745c222e2048652073616964205c226e6f5c2220616e64205c22776169745c222e2048652073616964205c226e6f5c2220616e64205c22776169745c222e2048652073616964205c226e6f5c2220616e64205c22776169745c222e2048652073616964205c226e6f5c2220616e64205c22776169745c222e2048652073616964205c226e6f5c2220616e64205c22776169745c222e2048652073616964205c226e6f5c2220616e64202e2e2e227d`

V4 hex: `0x6d6161743a76313a7b2262223a36313734353833362c2263223a2230313233343536373839616263646566303132333435363738396162636465663031323334353637222c226a223a22307838393264326463653536396337383331333966363264656332393737323936343264333566663765383862636364396432316463623264656665326238346666222c226b223a2270726f6265222c2272223a2270726f62652d323032362d31312d32375431373a35383a30305a222c2273223a5b5b224e56444163222c223336383933343838313437343139313035303535222c313739353533393338322c31395d2c5b22474f4f474c63222c223336383933343838313437343139313034323036222c313739353533363331322c31355d2c5b224141504c63222c223336383933343838313437343139313033383630222c313739353533353435382c32335d5d2c2274223a2250524f42452076312c206e6f74206120436c617564652070726f706f73616c2e204578706563746564204f4b206265666f7265207468652031333a3030204554206561726c7920636c6f73652e227d`

V5 hex: `0x6d6161743a76313a7b2262223a36313734353833362c2263223a2230313233343536373839616263646566303132333435363738396162636465663031323334353637222c226a223a22307838393264326463653536396337383331333966363264656332393737323936343264333566663765383862636364396432316463623264656665326238346666222c226d223a22636c617564652d736f6e6e65742d352d35222c2271223a5b375d2c2272223a22313739353533393534323030302d6131623263336434222c2273223a5b5b224e56444163222c223336383933343838313437343139313035303535222c313739353533393338322c31395d2c5b22474f4f474c63222c223336383933343838313437343139313034323036222c313739353533363331322c31355d2c5b224141504c63222c223336383933343838313437343139313033383630222c313739353533353435382c32335d5d2c2274223a22427269656620372061736b656420666f722061203520555344204e56444163206275793b2061646f7074656420696e7369646520746865206d616e646174652e227d`

V6 hex: `0x6d6161743a76313a7b2262223a36313734353833362c2263223a2230313233343536373839616263646566303132333435363738396162636465663031323334353637222c226a223a22307838393264326463653536396337383331333966363264656332393737323936343264333566663765383862636364396432316463623264656665326238346666222c226d223a22636c617564652d736f6e6e65742d352d35222c2272223a22313739353533393534323030302d6131623263336434222c2273223a5b5b224e56444163222c223336383933343838313437343139313035303535222c313739353533393338322c31395d2c5b22474f4f474c63222c223336383933343838313437343139313034323036222c313739353533363331322c31355d2c5b224141504c63222c223336383933343838313437343139313033383630222c313739353533353435382c32335d5d2c2274223a224669787475726520726174696f6e616c653a204e5644416320697320756e64657220697473207461726765742077656967687420616e642074686520666565642069732066726573682c20736f206275792035205553442e20286d61726b657420636c6f7365642c204e59534520686f6c696461793a205468616e6b73676976696e6729227d`

V7 hex: `0x6d6161743a76313a7b2262223a36313734353833362c2263223a2230313233343536373839616263646566303132333435363738396162636465663031323334353637222c226a223a22307838393264326463653536396337383331333966363264656332393737323936343264333566663765383862636364396432316463623264656665326238346666222c226d223a22636c617564652d736f6e6e65742d352d35222c2272223a22313739353533393534323030302d6131623263336434222c2273223a5b5b224e56444163222c223336383933343838313437343139313035303535222c313739353533393338322c31395d2c5b22474f4f474c63222c223336383933343838313437343139313034323036222c313739353533363331322c31355d2c5b224141504c63222c223336383933343838313437343139313033383630222c313739353533353435382c32335d5d2c2274223a224669787475726520746578743a204e5644416320697320756e64657220697473207461726765742e204e5644416320697320756e64657220697473207461726765742e204e5644416320697320756e64657220697473207461726765742e204e5644416320697320756e64657220697473207461726765742e204e5644416320697320756e64657220697473207461726765742e204e5644416320697320756e64657220697473207461726765742e204e5644416320697320756e64657220697473207461726765742e204e5644416320697320756e64657220697473207461726765742e204e5644416320697320756e64657220697473207461726765742e204e5644416320697320756e64657220697473207461726765742e204e5644416320697320756e64657220697473207461726765742e204e5644416320697320756e64657220697473207461726765742e204e5644416320697320756e64657220697473207461726765742e204e5644416320697320756e64657220697473207461726765742e204e5644416320697320756e64657220697473207461726765742e204e5644416320697320756e64657220697473207461726765742e204e5644416320697320756e64657220697473207461726765742e204e5644416320697320756e64657220697473207461726765742e204e5644416320697320756e64657220697473207461726765742e204e5644416320697320756e64657220697473202e2e2e20286d61726b657420636c6f7365642c204e59534520686f6c696461793a205468616e6b73676976696e6729227d`

</details>

### 5.6 Calldata

`encodeExecute({ id: keccak256("spec-example"), action: 0, token: NVDAc, amount: 5000000, minOut: 0, payee: 0x0,
rationaleHash: keccak256(V1) })` ‖ V1 ‖ `Attribution.toDataSuffix({ codes: ["fake_code"] })` is 228 + 438 + 27 = 693
bytes. The decoder finds `S = 666`, the blob equal to V1 and a true hash tick, and `Attribution.fromData` returns
`["fake_code"]`.

### 5.7 Journal

Two published lines (the second carries V1, whose `j` is the first line's `hash`):

```
{"block":"61745836","commit":"0123456789abcdef0123456789abcdef01234567","costUsd6":"4210","day":"20781","hash":"0x892d2dce569c783139f62dec297729642d35ff7e88bccd9d21dcb2defe2b84ff","kind":"run","mode":"dry-run","ok":true,"prev":"0x0000000000000000000000000000000000000000000000000000000000000000","proposals":1,"runId":"1795539542000-a1b2c3d4","suggestions":1,"summary":"One buy proposed.","ts":"2026-11-24T16:59:04.512Z"}
{"action":"BUY","amountUsd6":"5000000","blob":"maat:v1:{\"b\":61745836,\"c\":\"0123456789abcdef0123456789abcdef01234567\",\"j\":\"0x892d2dce569c783139f62dec297729642d35ff7e88bccd9d21dcb2defe2b84ff\",\"m\":\"claude-sonnet-5-5\",\"r\":\"1795539542000-a1b2c3d4\",\"s\":[[\"NVDAc\",\"36893488147419105055\",1795539382,19],[\"GOOGLc\",\"36893488147419104206\",1795536312,15],[\"AAPLc\",\"36893488147419103860\",1795535458,23]],\"t\":\"Fixture rationale: NVDAc is under its target weight and the feed is fresh, so buy 5 USD.\"}","commit":"0123456789abcdef0123456789abcdef01234567","gate":"dry-run: would execute","hash":"0x3a54dfb09811088c8f2ffdecf4666c6e34f721a7e4166f1a6557dc3133ec4f8c","index":0,"intentId":"0x5ab74fda7322b60dc25dc1ca3f0902cd67e72203319f46b70fd789b4604773d8","kind":"intent","prev":"0x892d2dce569c783139f62dec297729642d35ff7e88bccd9d21dcb2defe2b84ff","preview":"OK","rationaleHash":"0xbc7e8a953617d15492fcb18bacbcacc9db09d8138a717810f4786fceefc1d27d","runId":"1795539542000-a1b2c3d4","symbol":"NVDAc","ts":"2026-11-24T16:59:09.007Z"}
```

`hash` of line 1: `0x892d2dce569c783139f62dec297729642d35ff7e88bccd9d21dcb2defe2b84ff`. `hash` of line 2: `0x3a54dfb09811088c8f2ffdecf4666c6e34f721a7e4166f1a6557dc3133ec4f8c`.

Line 2's `intentId` is `keccak256("spec-example")`, the §5.6 id, not the agent's `intentId(runId, 0)`
(`agent/src/intent.ts`). A test that checks rows against that rule skips this fixture.

### 5.8 Sanitizer

| Input (JS string) | `sanitize(input, 600)` |
|---|---|
| `"a\tb\r\nc"` | `a b c` |
| `"  x  "` | `x` |
| `""` | `(no text)` |
| `"\u{1F680} go"` | `go` |
| `"key 0x" + "ab".repeat(32) + " end"` | `key [hex] end` |
| `"token sk-fake0123456789abcdefXYZ here"` | `token [key] here` |
| `"run " + "A".repeat(45) + " end"` | `run [key] end` |
| `"NVDAc.price and 23.3% and e.g. 1.5bps"` | `[url] and 23.3% and e.g. 1.5bps` |
| `"mailto me at a@b.io"` | `mailto me at a@[url]` |

Cuts: `sanitize("see www and more", 11)` is `see www ...`, with `max` 10 it is `see ...`, and
`sanitize("abcdefghijkl", 8)` is `...`.

## 6. Out of scope

ERC-8021 schema 1 and 2 suffixes; blobs on owner-sent transactions; the fields of the probe and brief row kinds
(added by their branches, §3.2); calls to the vault through another contract. Not measured: how long
raw.githubusercontent.com caches a file, so a page may show an older push.
