/**
 * The owner's switch for /ask. The page sends briefs and shows the feed only when this is true and deployments/README.md
 * records the Base mainnet MaatInbox and the vault. Recording the inbox for the agent does not open the page by itself:
 * the owner turns this on in its own pull request once the /proof counting rule has been live for 24 hours (inbox spec
 * §5). The build serves it at /data/ask.json, which the page reads at runtime.
 */
export const ASK_OPEN: boolean = false;
