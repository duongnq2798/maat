/**
 * Each team wallet's sent transactions, in nonce order, for the /proof counting rule (inbox spec §5): ETH funding
 * leaves no log, so the team trace (web/app/(site)/proof/team.ts) reads the ETH and the tokens a team wallet sent from
 * these transactions, and checks the list against the wallet's nonce at the block it counts to. A wallet that sent more
 * transactions than its entry holds leaves /proof incomplete until they are added here. A wallet with no entry has
 * sent none.
 *
 * `node scripts/recount.mjs --rpc https://mainnet.base.org --sends <wallet>` prints a wallet's entry; the owner adds it
 * in a pull request.
 *
 * Plain data with no import, so that `node scripts/recount.mjs` reads this file with Node's own type stripping.
 */
export interface SentTransactions {
  /** 0x and 40 hex digits. */
  wallet: string;
  /** Transaction hashes, nonce 0 first. */
  txs: readonly string[];
}

// The agent executor, 0x9bC6E49d42e0659f3ef667B09B67506B348e115A, had sent none by block 62,201,878 (`--sends` from
// https://mainnet.base.org on 2026-11-26), so it has no entry yet.
export const PROOF_SENDS: readonly SentTransactions[] = [
  // The owner: 9 transactions sent by block 62,201,650, printed by `--sends` from https://mainnet.base.org on
  // 2026-11-26. Nonces 0 to 3 are the four deploys in deployments/README.md.
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
    ],
  },
];
