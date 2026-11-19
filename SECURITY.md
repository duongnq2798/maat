# Security policy

How to report a security problem in Maat privately, and what to expect after you report it.

## Supported versions

The `main` branch, and the contracts at the addresses listed in [`deployments/`](deployments/) once they are
listed there. The contracts are unaudited.

## Scope

A report can cover `contracts/src`, `contracts/script`, `agent/src` and `web/`, and the contracts at the
addresses listed in [`deployments/`](deployments/). A bug in a third party's code (Base, Chainlink,
Aerodrome, Aave V4, the B20 tokens, CDP or USDC) goes to that party. If it changes what the Maat vault or
agent does, report the Maat side here.

## How to report

Use GitHub's private report form: on the repository's
[Security and quality](https://github.com/duongnq2798/maat/security) tab, click **Report a vulnerability**,
fill in the form and submit it. The form needs a GitHub account, and the report goes privately to the
repository's maintainers.

Without a GitHub account, send a direct message to [@maatonbase on X](https://x.com/maatonbase), say that you
have found a security problem, and ask for a private channel. Send the details only after that channel is
agreed.

The website's [Report a vulnerability](https://maatonbase.xyz/docs/security/report-a-vulnerability) page
says the same, and lists what to include in a report.

Never open a public issue or a public pull request, and never post the details in a public reply.

Never include a real private key, seed phrase or API key, yours or anyone's. A report never needs one.

## What to expect

- **No bounty.** Maat has no bug bounty.
- **Credit on request.** Say how you want to be named, or that you want none.
- **No promised response time.** This file promises no response time and no date for a fix.

## Continuous integration

Every pull request and every push to `main` runs a secret scan, with redacted logs, over the full history of
every branch, each merge's own changes, and every commit message.
