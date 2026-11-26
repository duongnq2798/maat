// Vectors from the maat:v1 spec (docs/superpowers/specs/2026-11-25-maat-v1-rationale-blob-design.md, §5), copied
// byte for byte. The publisher's own keccak256, canon, sanitizer and projection must reproduce them.

export const GENESIS = `0x${"0".repeat(64)}`;

/** §5 V1: the agent's blob for a 5 USD NVDAc buy, 438 bytes. */
export const V1_BLOB =
  'maat:v1:{"b":61745836,"c":"0123456789abcdef0123456789abcdef01234567","j":"0x892d2dce569c783139f62dec297729642d35ff7e88bccd9d21dcb2defe2b84ff","m":"claude-sonnet-5-5","r":"1795539542000-a1b2c3d4","s":[["NVDAc","36893488147419105055",1795539382,19],["GOOGLc","36893488147419104206",1795536312,15],["AAPLc","36893488147419103860",1795535458,23]],"t":"Fixture rationale: NVDAc is under its target weight and the feed is fresh, so buy 5 USD."}';
export const V1_HASH = "0xbc7e8a953617d15492fcb18bacbcacc9db09d8138a717810f4786fceefc1d27d";

/** §1: keccak256 of the default text of agent/scripts/first-decision.ts, the rationaleHash of both owner Decisions. */
export const OWNER_TEXT = "Owner-sent first decision: BUY 5 USD of NVDAc";
export const OWNER_HASH = "0x0baa4c52e17e7acc5c7cc851e57a9df523c70b5a1530d77055bb2401370f57f6";

/** §5.7: the two published lines and their hashes. */
export const JOURNAL_LINES = [
  '{"block":"61745836","commit":"0123456789abcdef0123456789abcdef01234567","costUsd6":"4210","day":"20781","hash":"0x892d2dce569c783139f62dec297729642d35ff7e88bccd9d21dcb2defe2b84ff","kind":"run","mode":"dry-run","ok":true,"prev":"0x0000000000000000000000000000000000000000000000000000000000000000","proposals":1,"runId":"1795539542000-a1b2c3d4","suggestions":1,"summary":"One buy proposed.","ts":"2026-11-24T16:59:04.512Z"}',
  '{"action":"BUY","amountUsd6":"5000000","blob":"maat:v1:{\\"b\\":61745836,\\"c\\":\\"0123456789abcdef0123456789abcdef01234567\\",\\"j\\":\\"0x892d2dce569c783139f62dec297729642d35ff7e88bccd9d21dcb2defe2b84ff\\",\\"m\\":\\"claude-sonnet-5-5\\",\\"r\\":\\"1795539542000-a1b2c3d4\\",\\"s\\":[[\\"NVDAc\\",\\"36893488147419105055\\",1795539382,19],[\\"GOOGLc\\",\\"36893488147419104206\\",1795536312,15],[\\"AAPLc\\",\\"36893488147419103860\\",1795535458,23]],\\"t\\":\\"Fixture rationale: NVDAc is under its target weight and the feed is fresh, so buy 5 USD.\\"}","commit":"0123456789abcdef0123456789abcdef01234567","gate":"dry-run: would execute","hash":"0x3a54dfb09811088c8f2ffdecf4666c6e34f721a7e4166f1a6557dc3133ec4f8c","index":0,"intentId":"0x5ab74fda7322b60dc25dc1ca3f0902cd67e72203319f46b70fd789b4604773d8","kind":"intent","prev":"0x892d2dce569c783139f62dec297729642d35ff7e88bccd9d21dcb2defe2b84ff","preview":"OK","rationaleHash":"0xbc7e8a953617d15492fcb18bacbcacc9db09d8138a717810f4786fceefc1d27d","runId":"1795539542000-a1b2c3d4","symbol":"NVDAc","ts":"2026-11-24T16:59:09.007Z"}',
];
export const JOURNAL_HASHES = [
  "0x892d2dce569c783139f62dec297729642d35ff7e88bccd9d21dcb2defe2b84ff",
  "0x3a54dfb09811088c8f2ffdecf4666c6e34f721a7e4166f1a6557dc3133ec4f8c",
];

/**
 * The two agent journal rows behind the §5.7 lines, as the agent keeps them on disk: every field plus prev and hash,
 * including the fields the projection never exports (the raw model text, a note, an unknown field).
 */
export const LOCAL_ROWS = [
  {
    ts: "2026-11-24T16:59:04.512Z",
    commit: "0123456789abcdef0123456789abcdef01234567",
    kind: "run",
    runId: "1795539542000-a1b2c3d4",
    block: "61745836",
    day: "20781",
    mode: "dry-run",
    ok: true,
    summary: "One buy proposed.",
    costUsd6: "4210",
    suggestions: 1,
    proposals: 1,
    prev: GENESIS,
    hash: JOURNAL_HASHES[0],
  },
  {
    ts: "2026-11-24T16:59:09.007Z",
    commit: "0123456789abcdef0123456789abcdef01234567",
    kind: "intent",
    runId: "1795539542000-a1b2c3d4",
    index: 0,
    intentId: "0x5ab74fda7322b60dc25dc1ca3f0902cd67e72203319f46b70fd789b4604773d8",
    action: "BUY",
    symbol: "NVDAc",
    amountUsd6: "5000000",
    rationale: "NVDAc is under its target weight; see https://example.com/notes for the feed.",
    rationaleHash: V1_HASH,
    blob: V1_BLOB,
    preview: "OK",
    gate: "dry-run: would execute",
    note: "kept local",
    extra: "not in the allowlist",
    prev: JOURNAL_HASHES[0],
    hash: JOURNAL_HASHES[1],
  },
];
