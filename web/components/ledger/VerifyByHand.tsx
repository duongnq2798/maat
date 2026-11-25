import type { Address, Hash } from "viem";

/**
 * Five read-only `cast` commands that check the vault without this page, with the output each printed on 2026-11-25
 * (cast from Foundry 1.9.0, against https://base-rpc.publicnode.com). The commands and outputs are those of the
 * verify-by-hand guide; long hashes and the owner's address are shortened with an ellipsis, as there.
 */
export interface VerifyTargets {
  vault: Address;
  deployTx: Hash;
  calendar: Address;
}

/** The Decision blocks and the default rationale text the commands read (deployments/README.md, agent/scripts/first-decision.ts). */
const DECISION_BLOCKS = ["61700601", "61745836"] as const;
const OWNER_TEXT = "Owner-sent first decision: BUY 5 USD of NVDAc";

interface Step {
  title: string;
  body: string;
  command: string;
  output: string;
}

function steps(t: VerifyTargets): Step[] {
  return [
    {
      title: "Check which contract the recorded deploy created",
      body: "The deployments table records the MandateVault deploy transaction. Its receipt names the contract it created: the address in VAULT.",
      command: `cast receipt ${t.deployTx} contractAddress --rpc-url "$RPC"`,
      output: t.vault,
    },
    {
      title: "Read the owner, the executor and the mandate",
      body: "The first line is the owner, fixed when the vault was created; the second is the executor, the one address whose execute calls the vault accepts. On 2026-11-25 both were the owner's wallet; once the owner hands the executor role to the agent, the second line prints the new address. The other fourteen lines are the mandate, one field per line.",
      command: [
        "MANDATE='(uint8,uint16,uint16,uint32,uint32,uint32,uint128,uint128,address,address,address,uint64,uint64,uint32)'",
        'for f in "owner()(address)" "executor()(address)" "mandate()$MANDATE"; do cast call "$VAULT" "$f" --rpc-url "$RPC"; done',
      ].join("\n"),
      output: [
        "0x3c3a66f7…1D6a",
        "0x3c3a66f7…1D6a",
        "0",
        "100",
        "150",
        "90000 [9e4]",
        "86400 [8.64e4]",
        "1800",
        "50000000 [5e7]",
        "100000000 [1e8]",
        "0x9bfe055323101245a644AF162287C4C38708aDB1",
        "0x3265EEBEf5ad3c1CE41874Addf18CA207Be35Bfa",
        "0x45dEA6BBeD30c120794115FeC8b01C346564aB2C",
        "1500000000000000000 [1.5e18]",
        "2000000000000000000 [2e18]",
        "28800 [2.88e4]",
      ].join("\n"),
    },
    {
      title: "Read the two Decisions",
      body: "The vault's Decision logs in the blocks of its two mainnet Decisions: a BUY refused with reason 6 (MARKET_CLOSED), then the same BUY allowed with reason 0 (OK), both with the same rationaleHash.",
      command: [
        "DECISION='Decision(bytes32 indexed intentId, uint8 action, address indexed token, uint256 amount, bool allowed, uint8 reason, bytes32 rationaleHash)'",
        `for b in ${DECISION_BLOCKS.join(" ")}; do`,
        '  cast logs --rpc-url "$RPC" --address "$VAULT" --from-block "$b" --to-block "$b" "$DECISION" | grep -A 9 transactionHash',
        "done",
      ].join("\n"),
      output: [
        "  transactionHash: 0xdfdb6739…6c3b",
        "  transactionIndex: 14",
        "  decoded:",
        "  \tintentId: 0xdc06ec8e…243c",
        "  \taction: 0",
        "  \ttoken: 0xb20000000000000000000078ee7ce2fE4908108C",
        "  \tamount: 5000000 [5e6]",
        "  \tallowed: false",
        "  \treason: 6",
        "  \trationaleHash: 0x0baa4c52…57f6",
        "  transactionHash: 0x61622340…23c8",
        "  transactionIndex: 9",
        "  decoded:",
        "  \tintentId: 0x475efb77…ee3d",
        "  \taction: 0",
        "  \ttoken: 0xb20000000000000000000078ee7ce2fE4908108C",
        "  \tamount: 5000000 [5e6]",
        "  \tallowed: true",
        "  \treason: 0",
        "  \trationaleHash: 0x0baa4c52…57f6",
      ].join("\n"),
    },
    {
      title: "Ask the calendar at each Decision's block",
      body: "The market-hours check asks the calendar whether the session is open at the block's timestamp. Asked again at each Decision's block, it was closed for the first (09:28 in New York, before the open) and open for the second.",
      command: [
        `for b in ${DECISION_BLOCKS.join(" ")}; do`,
        '  t=$(cast block "$b" --field timestamp --rpc-url "$RPC")',
        '  echo "block $b, timestamp $t, open: $(cast call "$CALENDAR" "isOpen(uint256,uint8)(bool)" "$t" 0 --block "$b" --rpc-url "$RPC")"',
        "done",
      ].join("\n"),
      output: ["block 61700601, timestamp 1795530495, open: false", "block 61745836, timestamp 1795539542, open: true"].join("\n"),
    },
    {
      title: "Hash the rationale text",
      body: "The chain holds only the hash of a rationale. Both owner-sent buys committed to the default text of agent/scripts/first-decision.ts; its keccak256 is the rationaleHash of both Decisions. printf '%s' and single quotes hash the text exactly, with no newline.",
      command: `printf '%s' '${OWNER_TEXT}' | cast keccak`,
      output: "0x0baa4c52…57f6",
    },
  ];
}

function Code({ label, children, tone }: { label: string; children: string; tone: "command" | "output" }) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      data-scroll-x
      className={`overflow-x-auto rounded-2xl p-4 ${tone === "command" ? "bg-ink text-line" : "border border-line bg-surface-soft text-ink-body"}`}
    >
      <pre className="m-0 whitespace-pre font-mono text-[12.5px] leading-[1.7]">{children}</pre>
    </div>
  );
}

/** The "Verify it by hand" panel: five read-only cast commands, each with the output it printed. */
export function VerifyByHand({ targets }: { targets: VerifyTargets }) {
  const list = steps(targets);
  return (
    <section id="verify" aria-labelledby="verify-title" className="border-t border-line">
      <div className="wrap flex flex-col gap-8 py-16 md:py-24">
        <div className="flex max-w-[760px] flex-col gap-3">
          <span className="eyebrow">Only cast, read-only</span>
          <h2 id="verify-title" className="text-2xl font-semibold tracking-[-0.02em] text-ink">
            Verify it by hand
          </h2>
          <p className="text-[15px] leading-relaxed text-ink-body">
            Five commands check the vault without this page. None needs a key, a wallet or an account, and none sends a
            transaction. Each output below was printed on 2026-11-25 by cast from Foundry 1.9.0 against
            base-rpc.publicnode.com; long hashes and the owner&apos;s address are shortened, and your terminal prints them
            in full. The commands are written for bash (Git Bash on Windows).
          </p>
          <p className="text-[15px] leading-relaxed text-ink-body">
            For a Decision whose calldata carries a maat:v1 blob, Basescan shows the words too: open the transaction, then
            its input data, and view it as UTF-8.
          </p>
        </div>
        <Code label="Set the RPC and the addresses" tone="command">
          {[`export RPC=https://base-rpc.publicnode.com`, `export VAULT=${targets.vault}      # MandateVault`, `export CALENDAR=${targets.calendar}   # MarketCalendar`].join("\n")}
        </Code>
        <ol aria-label="Five read-only commands" className="m-0 flex list-none flex-col gap-8 p-0">
          {list.map((s, i) => (
            <li key={s.title} className="flex min-w-0 flex-col gap-3">
              <h3 className="text-base font-semibold text-ink">
                <span className="font-mono text-ink-2">{i + 1}.</span> {s.title}
              </h3>
              <p className="max-w-[760px] text-sm leading-relaxed text-ink-body">{s.body}</p>
              <Code label={`Command ${i + 1}`} tone="command">
                {s.command}
              </Code>
              <Code label={`Output of command ${i + 1}`} tone="output">
                {s.output}
              </Code>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
