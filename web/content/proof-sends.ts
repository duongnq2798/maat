/**
 * The team sends the /proof team trace cannot find from logs (inbox spec §5), each wallet's in nonce order. ETH funding
 * leaves no log, so the trace (web/app/(site)/proof/team.ts) reads the ETH and the tokens a team wallet sent from the
 * wallet's sends, and checks them against its nonce at the block it counts to. It finds from logs every send that left
 * a vault log other than RevenueReceived (each execute and each owner-only call that did not revert, a syncMultiplier
 * that recorded a change, and the vault's own deploy) or a Brief of MaatInbox that names the wallet. The rest go here:
 * other contract deploys, MaatInbox's included, plain ETH and token transfers, approvals, calls to other contracts, a
 * notifyRevenue (anyone can make the vault emit RevenueReceived, so the trace does not read those logs), a
 * syncMultiplier that logged nothing, and reverted transactions. While a wallet has sent one that is in neither,
 * /proof is incomplete. A hash here that the logs also give counts once. A wallet with no entry has sent none that the
 * logs do not give.
 *
 * `node scripts/recount.mjs --sends <wallet> --rpc https://mainnet.base.org --logs-rpc https://base-rpc.publicnode.com`
 * prints the entry a wallet needs, with only the sends the logs do not give; the owner adds it in a pull request.
 *
 * Plain data with no import, so that `node scripts/recount.mjs` reads this file with Node's own type stripping.
 */
export interface SentTransactions {
  /** 0x and 40 hex digits. */
  wallet: string;
  /** Transaction hashes, lowest nonce first. */
  txs: readonly string[];
}

// The agent executor, 0x9bC6E49d42e0659f3ef667B09B67506B348e115A, had sent 1 transaction by block 62,793,789 (`--sends`):
// the execute of 2026-11-27 02:14 UTC. Each execute it sends that does not revert leaves a Decision log of the vault, as
// that one did, so it has no entry. A syncMultiplier it sends leaves a MultiplierChangeDetected log when it records a
// change; the agent halts on one that does not (agent/src/loop/runOnce.ts), and that send goes here.
export const PROOF_SENDS: readonly SentTransactions[] = [
  // The owner: 9 transactions sent by block 62,201,650, printed by `--sends` from https://mainnet.base.org on
  // 2026-11-26, before the trace read the vault's logs. Nonces 0 to 3 are the four deploys in deployments/README.md.
  // At block 62,244,712 `--sends` gives 4 of them (nonces 3, 6, 7 and 8) from the vault's logs and needs the other 5;
  // the 4 stay listed and count once. On 2026-11-27 `--sends` at block 62,793,624 gives 11 transactions: nonce 9, the
  // setExecutor, left an ExecutorSet log; nonce 10, the MaatInbox deploy, left none and is added last.
  {
    wallet: "0x3c3a66f713dae7e4a03bbd81db79ff65f42c1d6a",
    txs: [
      "0x35f260151b987f6d05b63b1d90539edeaf4f7edf348155201049fea94fd337e6",
      "0x3f2b3ef236ade3ed1fa0b3ab2282ecddda340b2376137b7b438bb9c270127b39",
      "0xe79ef5ab90c0055ba218d6c0d2f271e30a128ba23e02f915ff527fde77818957",
      "0xf5a532fe5d8b2ddf7fce312f524537e614f4988b425972dd1098f3d56631c9c1",
      "0xe2f381a226b68974722c3d82d03470c6b19f9bb1679afee0b9c4f7302ffa2532",
      "0xa22853629f4d151b0ed274d8cdc734c93fb323127a473abd83c26c142fe0e647",
      "0x3e0aa478853b7172e955dd1245ed17c047f925d2817806b8429095f268edb309",
      "0xdfdb6739912a73542d90129bd7269a939dc8b2d47a869f56d9ab5e3a02e86c3b",
      "0x61622340a151c73c3f2b3bc910292a3e3136bd4aa7ecd55a92f59914953a23c8",
      "0x61b7f0b44ae01a6fbb34e0e7c35d53c2ffd1228fbc3f0b3dd020741826850db4",
    ],
  },
];
