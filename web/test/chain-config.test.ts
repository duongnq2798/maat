// @vitest-environment node
import { describe, expect, it } from "vitest";
import { deploymentConfig, deploymentsFile, SCAN_FLOOR_BLOCK } from "@/lib/chain/config";
import { docsData } from "@/lib/docs/generated";

const row = (contract: string, address = "", tx = "", network = "Base mainnet") => ({ network, contract, address, tx, date: "" });
const VAULT_LOWER = "0xb20000000000000000000078ee7ce2fe4908108c";
const VAULT = "0xb20000000000000000000078ee7ce2fE4908108C";
const TX = `0x${"ab".repeat(32)}`;
// The Base mainnet MandateVault and its deploy tx, as deployments/README.md records them.
const RECORDED = {
  vault: "0x3F956072d18ddD20d5eFb74e9CCabf8Deade699b",
  deployTx: "0xf5a532fe5d8b2ddf7fce312f524537e614f4988b425972dd1098f3d56631c9c1",
};

describe("deploymentConfig", () => {
  it("reads the vault and its deploy tx from the committed table", () => {
    expect(deploymentConfig(docsData.deployments)).toEqual(RECORDED);
  });

  it("is null while the MandateVault row has no address, or the table has no such row", () => {
    expect(deploymentConfig([row("MarketCalendar"), row("MandateVault")])).toBeNull();
    expect(deploymentConfig([])).toBeNull();
  });

  it("returns the checksummed vault and its deploy tx", () => {
    expect(deploymentConfig([row("MandateVault", VAULT_LOWER, TX)])).toEqual({ vault: VAULT, deployTx: TX });
  });

  it("keeps the address when the tx cell is empty, so the scan starts at the floor block", () => {
    expect(deploymentConfig([row("MandateVault", VAULT_LOWER)])).toEqual({ vault: VAULT, deployTx: null });
  });

  it("throws on a malformed address or tx, so the build fails instead of the page", () => {
    expect(() => deploymentConfig([row("MandateVault", "0x1234")])).toThrow(/MandateVault address/);
    expect(() => deploymentConfig([row("MandateVault", VAULT_LOWER, "0xzz")])).toThrow(/MandateVault tx/);
  });

  it("ignores other contracts and other networks", () => {
    expect(deploymentConfig([row("MarketCalendar", VAULT_LOWER)])).toBeNull();
    expect(deploymentConfig([row("MandateVault", VAULT_LOWER, TX, "Base Sepolia")])).toBeNull();
  });
});

describe("deploymentsFile", () => {
  it("publishes the whole committed table with the recorded vault", () => {
    const f = deploymentsFile(docsData.deployments);
    expect(f).toMatchObject({ network: "Base mainnet", chainId: 8453, ...RECORDED });
    expect(f.contracts).toEqual(docsData.deployments);
  });

  it("publishes null vault fields for a table with no vault address", () => {
    const rows = [row("MandateVault")];
    expect(deploymentsFile(rows)).toEqual({ network: "Base mainnet", chainId: 8453, vault: null, deployTx: null, contracts: rows });
  });

  it("fills the vault fields from the MandateVault row", () => {
    expect(deploymentsFile([row("MandateVault", VAULT_LOWER, TX)])).toMatchObject({ vault: VAULT, deployTx: TX });
  });
});

describe("SCAN_FLOOR_BLOCK", () => {
  it("is the measured Base block of 2026-11-20T01:17:11Z, before any Maat contract existed", () => {
    expect(SCAN_FLOOR_BLOCK).toBe(59_735_280n);
  });
});
