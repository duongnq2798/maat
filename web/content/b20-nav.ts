/**
 * The B20 tokens that have a NAV: Coinbase's keyless list (GET https://api.coinbase.com/v1/tokenized-stocks, read
 * 2026-11-20) returns 378 tokens and gives `nav_price` for exactly these 13; the NAV is the answer of the Chainlink
 * feed "Coinbase X" on Base. Verified on Base mainnet on 2026-11-20 (block ~60,013,066): B20 factory
 * 0xb20f000000000000000000000000000000000000 isB20(token) is true; each proxy's description() is "Coinbase X"
 * ("Coinbase ANT / USD" for ANT) with 8 decimals; each pool is the Aerodrome Slipstream USDC pool with tick spacing 10
 * from factory 0x9CB220581b91b0C83223012FE69688b92aD07a76, token0() = USDC, token1() = the token, observe([1800, 0])
 * answers. There is no COINc token, so Chainlink's "Coinbase COIN" feed has nothing to price here.
 */
export type Hex = `0x${string}`;

export interface NavToken {
  readonly symbol: string;
  /** The underlying company, as Coinbase's list names it. */
  readonly name: string;
  readonly token: Hex;
  /** Chainlink proxy, 8 decimals. */
  readonly feed: Hex;
  /** Aerodrome Slipstream pool, token0 = USDC (6 decimals), token1 = the token (8 decimals). */
  readonly pool: Hex;
}

export const MULTICALL3: Hex = "0xcA11bde05977b3631167028862bE2a173976CA11";
export const USDC_DECIMALS = 6;
export const B20_DECIMALS = 8;

export const NAV_TOKENS: readonly NavToken[] = [
  { symbol: "AAPLc", name: "Apple Inc.", token: "0xb200000000000000000000C2e324d24d7eEcd1fb", feed: "0x787f13dEa48Db0897CbCDD985de77809D837F988", pool: "0xF5FCB9CDAFcE67d50AfEf298F88E709d2B946BA6" },
  { symbol: "AMZNc", name: "Amazon.com Inc.", token: "0xb200000000000000000000d9192b6B456483C2E8", feed: "0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295", pool: "0x532e0F46d1e528507FC9454d5847C231f23bDDf6" },
  { symbol: "ANTc", name: "Anthropic, PBC", token: "0xb20000000000000000000016e38FD364d271Ba28", feed: "0xeEDc7412E991a3F2BD693eb2aC7fB0F27d4660dA", pool: "0x599C4225FE90214795a0be228D20d7680f8CED15" },
  { symbol: "CRCLc", name: "Circle Internet Group Inc.", token: "0xB20000000000000000000019f6E7C675b73C2e4D", feed: "0x0231cF2635D1E17bB5c2462cc7504Ba1fBd61f33", pool: "0x294666AD6a415E8C33Af801225c04079BB4f1133" },
  { symbol: "GOOGLc", name: "Alphabet Inc.", token: "0xb2000000000000000000002D0BA3164cc74f58B7", feed: "0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2", pool: "0x16c70F04C3080a127486Cdf5a4C33c066bBF47C3" },
  { symbol: "INTCc", name: "Intel Corporation", token: "0xB2000000000000000000004AFF16039bA04bdFBc", feed: "0xAB657C39bac0D5886250D70849e2E3E008F2EECB", pool: "0x3D384288fA79B51De882B06B617aB7989CcAd4f3" },
  { symbol: "METAc", name: "Meta Platforms Inc.", token: "0xb2000000000000000000008bC8786B856E61707C", feed: "0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D", pool: "0xd072410fa13D242e1d53721Bcf7AF02e3455DC96" },
  { symbol: "MSFTc", name: "Microsoft Corporation", token: "0xB200000000000000000000Ab99cFa739E253872B", feed: "0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c", pool: "0x2740C0faAb738F6e346e545fDE02aEF9B1A01ee7" },
  { symbol: "MSTRc", name: "Strategy Inc.", token: "0xb2000000000000000000004884b426556b92883d", feed: "0xB3cE282CD188b35DA0E38D8Bc7d58e33173D202a", pool: "0x66DCd42E6314B287110922AE36cB2a8bdEECc153" },
  { symbol: "NVDAc", name: "NVIDIA Corporation", token: "0xb20000000000000000000078ee7ce2fE4908108C", feed: "0x04689a41629776563E6822F76f2e57D148d28513", pool: "0xF668e21993f0ACd7ab00BB1cFbAeD0df28A3C8EC" },
  { symbol: "SNDKc", name: "Sandisk Corporation", token: "0xb200000000000000000000397293Cb8cda9a10c5", feed: "0x388b0dC46C0Fb05A74BeE0994fa5b02c6Fcca2eA", pool: "0x2836e062a3fe75943a7F4A552E2365b98E414E75" },
  { symbol: "SPCXc", name: "Space Exploration Technologies Corp.", token: "0xb2000000000000000000007b9fcbd005511aCBd5", feed: "0x6A634B235903C4ad6376892180d6fF8612e3Fa68", pool: "0x880dB7Dda4407D99508574E680d067D1164B3cFE" },
  { symbol: "TSLAc", name: "Tesla Inc.", token: "0xb2000000000000000000001e800a7f5189430cD0", feed: "0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4", pool: "0x7A33000372f3F028f074182CCb9d16cBEEfBF920" },
];
