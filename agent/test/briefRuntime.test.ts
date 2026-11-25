import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEPLOYMENTS_FILE, inboxSetup } from "../src/briefs/inbox.js";
import { loadConfig } from "../src/config.js";
import { buildRuntime, startLine } from "../src/runtime.js";
import { INBOX, INBOX_DEPLOY_TX } from "./fakes/fakeInbox.js";

const env = async () => ({
  BASE_RPC_URL: "http://127.0.0.1:1",
  MAAT_VAULT: "0x1111111111111111111111111111111111111111",
  MAAT_EXECUTOR: "0x2222222222222222222222222222222222222222",
  MAAT_EXPENSE_PAYEE: "0x3333333333333333333333333333333333333333",
  MAAT_DATA_DIR: await mkdtemp(join(tmpdir(), "maat-rt-briefs-")),
});
const noProposer = { propose: async () => ({ ok: false as const, error: "unused", costUsd6: 0n }) };
const table = (row: string) => `| Network | Contract | Address | Tx | Date |\n| --- | --- | --- | --- | --- |\n${row}\n`;

describe("inboxSetup: the MaatInbox the agent starts with", () => {
  it("finds none in the repo's deployments/README.md today, so briefs are off", () => {
    expect(existsSync(DEPLOYMENTS_FILE)).toBe(true);
    expect(inboxSetup()).toEqual({ record: null, line: "maat agent: briefs=off: deployments/README.md records no MaatInbox, so no inbox log is read" });
  });

  it("reads a recorded inbox, and turns briefs off, naming the problem, for a row it cannot read", async () => {
    const dir = await mkdtemp(join(tmpdir(), "maat-deploy-"));
    const file = join(dir, "README.md");
    await writeFile(file, table(`| Base mainnet | MaatInbox | \`${INBOX}\` | ${INBOX_DEPLOY_TX} | 2026-11-28 |`));
    expect(inboxSetup(file).record).toEqual({ inbox: INBOX, deployTx: INBOX_DEPLOY_TX });
    expect(inboxSetup(file).line).toMatch(/^maat agent: briefs=on: MaatInbox /);
    await writeFile(file, table("| Base mainnet | MaatInbox | 0x1234 | | 2026-11-28 |"));
    expect(inboxSetup(file)).toEqual({ record: null, line: 'maat agent: briefs=off: deployments/README.md: MaatInbox address "0x1234" is not an address, so no inbox log is read' });
  });
});

describe("buildRuntime and the start line", () => {
  it("leaves briefs out of the runtime with no recorded inbox, and the start line says briefs=off", async () => {
    const cfg = loadConfig(await env());
    const deps = await buildRuntime(cfg, { proposer: noProposer });
    expect(deps).not.toHaveProperty("briefs");
    expect(startLine(cfg, deps)).toBe(
      `maat agent: mode=dry-run vault=${cfg.vault} executor=${cfg.executor} data=${cfg.dataDir} credit=off llm-cap=$0.75/day bill-min=$0.10 briefs=off`,
    );
    expect(await buildRuntime(cfg, { proposer: noProposer, inbox: null })).not.toHaveProperty("briefs");
    expect(await buildRuntime(cfg, { proposer: noProposer, inbox: { inbox: INBOX, deployTx: null } })).not.toHaveProperty("briefs");
  });

  it("reads briefs from a recorded inbox through the runtime's own client, and the start line says briefs=on", async () => {
    const cfg = loadConfig(await env());
    const deps = await buildRuntime(cfg, { proposer: noProposer, inbox: { inbox: INBOX, deployTx: INBOX_DEPLOY_TX } });
    expect(deps.briefs).toEqual({ inbox: INBOX, deployTx: INBOX_DEPLOY_TX, client: deps.stateClient });
    expect(startLine(cfg, deps)).toMatch(/ briefs=on$/);
  });
});
