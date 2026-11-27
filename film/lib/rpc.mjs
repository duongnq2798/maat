// Read-only JSON-RPC for the tx cards: a receipt and its block's time, and for beat 7's verdict the Decision's calldata
// (a receipt holds none; the calldata carries the maat:v1 blob that names the brief) and the vault's owner(). Nothing
// here signs or sends anything.

export const RPCS = Object.freeze(["https://mainnet.base.org", "https://base-rpc.publicnode.com"]);

/** The selector of owner(), which MandateVault keeps immutable. */
export const OWNER_SELECTOR = "0x8da5cb5b";

async function call(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${method} answered HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message ?? "error"}`);
  return body.result;
}

/** `read(url)` from the first RPC that answers; throws naming `what` and each RPC's error when none can. */
async function firstAnswer(rpcs, what, read) {
  const errors = [];
  for (const url of rpcs) {
    try {
      return await read(url);
    } catch (e) {
      errors.push(`${new URL(url).host}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error(`could not read ${what}: ${errors.join("; ")}`);
}

/** The fields lib/tx.mjs reads, and no other. */
export function trimReceipt(r) {
  return {
    transactionHash: r.transactionHash,
    blockNumber: r.blockNumber,
    status: r.status,
    from: r.from,
    to: r.to,
    gasUsed: r.gasUsed,
    logs: r.logs.map((l) => ({ address: l.address, topics: l.topics, data: l.data, logIndex: l.logIndex })),
  };
}

/** { receipt, block } for a mined tx, from the first RPC that answers; throws when none can. */
export async function fetchTx(hash, rpcs = RPCS) {
  return firstAnswer(rpcs, hash, async (url) => {
    const receipt = await call(url, "eth_getTransactionReceipt", [hash]);
    if (!receipt) throw new Error("no receipt (not mined, or not on Base mainnet)");
    const block = await call(url, "eth_getBlockByNumber", [receipt.blockNumber, false]);
    return { receipt: trimReceipt(receipt), block: { number: block.number, timestamp: block.timestamp } };
  });
}

/** The calldata of a mined tx, from the first RPC that answers; throws when none can. */
export async function fetchInput(hash, rpcs = RPCS) {
  return firstAnswer(rpcs, `the calldata of ${hash}`, async (url) => {
    const tx = await call(url, "eth_getTransactionByHash", [hash]);
    if (!tx) throw new Error("no transaction (not mined, or not on Base mainnet)");
    if (String(tx.hash).toLowerCase() !== hash.toLowerCase()) throw new Error(`the node answered another transaction, ${tx.hash}`);
    return tx.input;
  });
}

/** The vault's owner(), lowercased, with eth_call at the latest block (it is immutable). */
export async function fetchOwner(vault, rpcs = RPCS) {
  return firstAnswer(rpcs, `owner() of ${vault}`, async (url) => {
    const word = await call(url, "eth_call", [{ to: vault, data: OWNER_SELECTOR }, "latest"]);
    if (!/^0x[0-9a-fA-F]{64}$/.test(String(word))) throw new Error(`owner() answered ${word}`);
    return `0x${word.slice(-40)}`.toLowerCase();
  });
}
