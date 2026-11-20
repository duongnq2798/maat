/** Basescan pages for what the live reader names, React-free so server and client components can both link them. */
export const basescanBlock = (n: bigint) => `https://basescan.org/block/${n}`;
export const basescanAddress = (address: string) => `https://basescan.org/address/${address}`;
