import type { Hash, Hex } from "viem";
import { decodeExecuteInput } from "@/lib/chain/rationale";

/**
 * The hero's quote of Claude's own reason for a trade (web/components/sections/HeroReason.tsx): the first trade of
 * Maat's agent that the vault allowed on Base mainnet, BUY GOOGLc for $4.64 (4.637004 USDC) on Fri 27 Nov 2026 at
 * 10:15 ET.
 *
 * `input` is that transaction's calldata, copied from Base with `cast tx <txHash> input`: the `execute` intent, the
 * maat:v1 rationale blob Claude's words travel in, and the ERC-8021 suffix. The page shows the blob's `t` as decoded
 * here, so the quote is never typed by hand. test/hero-reason.test.tsx holds every fact below to the committed
 * snapshot of the vault's logs: the Decision of `txHash` is in it, allowed, for this token and amount, and the
 * keccak256 of the blob equals the rationaleHash the vault logged.
 */
export const HERO_REASON_TX = {
  txHash: "0xff1f5a3bb87c5bb4dba236565f24e68146c3b0981d4942be965c21950b53c503" as Hash,
  blockNumber: 63_010_831,
  /** Unix seconds of the block: Fri 27 Nov 2026 15:15:41 UTC. */
  timestamp: 1_795_792_541,
  symbol: "GOOGLc",
  /** USDC, 6 decimals, as the Decision logged it: $4.637004, which the site shows as $4.64. */
  amount: 4_637_004n,
  input: "0x4ad3993fca1a95cee8835f737d7409e85f7e314a7114c45f85c602a47379644a2b4177280000000000000000000000000000000000000000000000000000000000000000000000000000000000000000b2000000000000000000002d0ba3164cc74f58b7000000000000000000000000000000000000000000000000000000000046c14c0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000095696cf56c271cd3c34db96f578e1dec94da7cb802b39e64d13067c542fe8f876d6161743a76313a7b2262223a36333031303739332c2263223a2262386339313461373232613865393662393166623637646165316566326666366231303132373566222c226a223a22307834353436626430396666633462643839656461663930313935303565333831646334366631333539363866313637306438383931323935373732623861386430222c226d223a22636c617564652d736f6e6e65742d352d35222c2272223a22313739353739323533343237362d3437656131333263222c2273223a5b5b224e56444163222c223336383933343838313437343139313035313939222c313739353739323333302c2d34305d2c5b22474f4f474c63222c223336383933343838313437343139313034323537222c313739353739313734312c34375d2c5b224141504c63222c223336383933343838313437343139313033383738222c313739353739303335392c31305d5d2c2274223a22474f4f474c6320697320617420302520616761696e737420612032332e3325207461726765742c2061206472696674206f66202d32332e3370702c207768696368206973206265796f6e6420746865203570702062616e642e205468652073697a652069732077697468696e207370656e6461626c65206361736820616e6420746865207065722d7472616465206c696d69742e227d62635f77376935766a64760b0080218021802180218021802180218021" as Hex,
} as const;

export interface HeroReason {
  /** Claude's words, the blob's `t`, exactly as the transaction carries them. */
  text: string;
  /** The model the blob names as the writer of `t`. */
  model: string;
  /** keccak256 of the blob's bytes: the rationaleHash the vault logged for this Decision. */
  blobHash: Hash;
}

/** Decodes the recorded calldata; throws when it holds no valid maat:v1 blob, so a bad copy fails the build. */
export function heroReason(input: Hex = HERO_REASON_TX.input): HeroReason {
  const call = decodeExecuteInput(input);
  if (call === null || call.blob.status !== "v1" || call.blobHash === null || call.blob.fields.m === undefined) {
    throw new Error("content/hero-reason.ts: the recorded input carries no maat:v1 blob written by a model");
  }
  return { text: call.blob.fields.t, model: call.blob.fields.m, blobHash: call.blobHash };
}
