import { describe, expect, it } from "vitest";
import { main } from "../scripts/probe-fork.js";

const VAULT = "0x1111111111111111111111111111111111111111";

describe("scripts/probe-fork.ts", () => {
  it("refuses an RPC that is not on this machine, and bad arguments, with exit code 2 before any request", async () => {
    const run = async (argv: string[]) => {
      const out: string[] = [];
      return { code: await main(argv, (s) => out.push(s)), out };
    };
    expect(await run(["--rpc", "https://mainnet.base.org", "--vault", VAULT])).toEqual({
      code: 2,
      out: ["probe-fork: --rpc https://mainnet.base.org is not on this machine; the rehearsal only sends to a local anvil fork"],
    });
    expect(await run([])).toEqual({ code: 2, out: ["probe-fork: --vault <VAULT_ADDRESS> is required"] });
    expect((await run(["--vault", VAULT, "--at", "soon"])).code).toBe(2);
    expect((await run(["--vault", VAULT, "--unknown"])).code).toBe(2);
  });
});
