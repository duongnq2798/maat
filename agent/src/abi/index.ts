export {
  mandateVaultAbi,
  creditAdapterAbi,
  marketCalendarAbi,
  b20AssetAbi,
  aggregatorV3Abi,
  erc20Abi,
} from "./generated.js";

/**
 * The two views of ICLPool (contracts/src/interfaces/IExternal.sol) PriceLib.twapPrice reads, which the agent reads
 * too for the TWAP premium in each maat:v1 blob. Written by hand: ICLPool is not among the ABIs gen-abis.ts exports.
 * gen-abis.ts also exports maatInboxAbi, which the web docs publish; the agent does not import it from here.
 */
export const clPoolAbi = [
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  {
    type: "function",
    name: "observe",
    stateMutability: "view",
    inputs: [{ name: "secondsAgos", type: "uint32[]" }],
    outputs: [
      { name: "tickCumulatives", type: "int56[]" },
      { name: "secondsPerLiquidityCumulativeX128s", type: "uint160[]" },
    ],
  },
] as const;
