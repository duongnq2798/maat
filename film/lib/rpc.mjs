// Read-only JSON-RPC for the tx cards: a receipt and its block's time. A receipt holds no calldata, so nothing the
// film reads carries the Builder Code or a rationale blob.

export const RPCS = Object.freeze(["https://mainnet.base.org", "https://base-rpc.publicnode.com"]);

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
  const errors = [];
  for (const url of rpcs) {
    try {
      const receipt = await call(url, "eth_getTransactionReceipt", [hash]);
      if (!receipt) throw new Error("no receipt (not mined, or not on Base mainnet)");
      const block = await call(url, "eth_getBlockByNumber", [receipt.blockNumber, false]);
      return { receipt: trimReceipt(receipt), block: { number: block.number, timestamp: block.timestamp } };
    } catch (e) {
      errors.push(`${new URL(url).host}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error(`could not read ${hash}: ${errors.join("; ")}`);
}
