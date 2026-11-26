# Maat's lexicon

The words Maat uses in public: one line per slot, the names of who does what, the words that replace retired ones, and
the two lines that tell where the name comes from. Copy on the site, in the docs, in the README, in the film and in
posts uses these lines word for word. [`web/test/lexicon.test.ts`](../../web/test/lexicon.test.ts) holds this page to
its lines and fails on every retired variant in the repository's public copy.

## The lines

| Slot | Line | Where it is used |
| --- | --- | --- |
| Positioning | "The AI agent that knows when not to trade." | The landing's H1, the site's title (`SITE.title`), the README's H3, `og.png` and the film's title card |
| Mechanism | "Claude proposes. The vault decides." | The landing's How it works heading, the README, the docs' What is Maat, the /ask link preview and the film's title card |
| Invitation | "Try to talk Maat's agent into a bad trade. The vault has the last word." | /ask's lead and its link preview (`ASK_INVITATION`), and the film's brief beat |
| Sign-off | "Every trade is weighed." | The site's footer (`SITE.tagline`), every Weighing card and the film's end card |
| Verdict grammar | "Refused · Market closed (MARKET_CLOSED)" | Every verdict: the plain label, then the reason code exactly as onchain, in parentheses. An allowed one reads "Allowed · All checks passed (OK)" |

The positioning line names the product as a whole. In a sentence, the AI itself is always "Maat's agent".

**Voice rules for the sign-off.** In the text of a post, "Every trade is weighed." appears at most once a week, as a
sign-off, never as a claim. On a card it appears every time, as a fixed part of the frame.

Each line is used as written: no paraphrase, no second motto. "No session, no trade." stays as the one line of its family;
a line for another reason code waits until that code has fired on Base mainnet.

## The names

| Name | Means | Never |
| --- | --- | --- |
| Maat | The project, the vault and the mandate: the standard and the scale | The AI |
| Maat's agent | The AI that proposes trades, which is Claude | "Maat" alone |
| Claude | The model Maat's agent runs on, named in plain text | Tagged on X |
| the vault | `MandateVault` on Base, which checks every intent against the mandate and records its verdict | "the contract decides" |
| the operator | The owner, sending an intent to the vault by hand | "the agent" |
| outside wallet | A wallet that is not the team's, counted under the published rule, zero included | "user", for a team or red-team wallet |

## The words

- **"held without an update"** instead of "frozen", for a feed or its price in public copy, as the Gap Index's charts
  print a window's hours: "<hours> h held without an update". Where a label has little room, "held" alone: "the held
  answer", "feed held".
- **"Maat's agent replied"** instead of "Maat replied", for a reply to a brief.
- **"Claude proposes"** instead of "the LLM proposes", "the AI proposes" or "the model proposes".
- **"the vault decides"** instead of "the contract decides" or "the mandate decides". The mandate is what the vault
  checks against; the vault is what decides.

## The name

The long version, told once, in words. Wherever it appears, it links its source.

> In the Egyptian Book of the Dead, a heart is weighed against a feather that stands for Ma'at: what is right. A heart that does not balance does not pass. Maat weighs every trade its AI agent proposes against a written mandate, and the chain records the verdict either way.

Source: the British Museum's text on the [Page from the Book of the Dead of Hunefer](https://artsandculture.google.com/asset/page-from-the-book-of-the-dead-of-hunefer/-gFGdB-pjqRpeg),
on Google Arts & Culture. "What is right" is its wording for what the feather means in this context.

The short version, for a single line:

> Named for Ma'at, whose feather every heart was weighed against. Here the feather is the mandate.

The long version is the first section of the docs' [What is Maat](../../web/content/docs/get-started/what-is-maat.mdx).
The short version is the line under the README's H3 and on the film's end card.

The myth is told in words only: no illustration, no papyrus, no hieroglyphs, no gold, no drawn gods, and never "divine".
The mark and the Balance carry the scale; nothing else is drawn for it.

## Retired variants

The test fails on each of these in public copy. Each has one replacement.

| Retired | Say instead |
| --- | --- |
| "The LLM proposes. The contract decides." | "Claude proposes. The vault decides." |
| "LLM proposes, contract decides." | "Claude proposes. The vault decides." |
| "The model may advise. The contract decides." | "Claude proposes. The vault decides." |
| "The agent proposes. The mandate decides." | "Claude proposes. The vault decides." |
| "the agent proposes, the contract decides" | "Claude proposes. The vault decides." |
| "Claude proposes every trade and an onchain mandate decides" | "Claude proposes. The vault decides." |
| "the contract decides", "the mandate decides" | "the vault decides" |
| "the LLM proposes", "the AI proposes", "the model proposes" | "Claude proposes" |
| "Maat is an AI agent", "Maat is a treasury agent", "Maat, the treasury agent", "Maat's AI" | "Maat's agent", with Maat as the project and the vault |
| "You are Maat," in the agent's prompt | "You are Maat's agent," |
| "Maat replied" | "Maat's agent replied" |
| "frozen", for a feed or its price | "held without an update" |
| "divine", for Ma'at | "what is right" |

## What the test reads

The scan covers the public copy: `README.md`, Markdown under `docs/`, and everything under `web/content/`,
`web/components/`, `web/app/` and `skills/`, plus `film/captions.json`, `ops/journal/README.md` and `agent/README.md`.
It reads prose only:

- **Markdown and MDX:** the text, including the frontmatter and the alt, title and aria-label values of tags. It skips
  fenced code, inline code, link targets and HTML comments, because code quotes a file word for word: the docs pages'
  excerpts are tested against their source files.
- **TypeScript and JavaScript:** JSX text, string literals and template literals, parsed with the parser Vite ships. It
  skips comments and identifiers, and a string that is one lowercase token, such as a `data-part` value, a key or a slug,
  since those are code.
- **JSON:** string values, not keys, with the same one-token rule.

It never reads `contracts/`, whose NatSpec is deployed and cannot change, or `web/content/generated/`, which
`npm run docs:gen` copies from it and from the agent. It skips the dated specs and plans under `docs/superpowers/`,
each named for the day it records and kept in that day's words, and this page, which quotes the retired variants on
purpose.

Two lists in the test skip files that other open work owns:

- `PENDING_AGENT_R3` names the files of the scope that PR #78 (`feat/agent-voice`) changes: `agent/README.md`, How a
  decision is made and the threat model. The list goes when #78 merges. A test fails once the agent's system prompt
  says "You are Maat's agent" while the list is still there.
- `PENDING_CULTURE_LANES` names files of the `feat/now-market-clock` and `feat/landing-verdict-first` branches that hold
  a retired variant. A test fails once a listed file is clean.
