# Linger

> Terminal-native ad marketplace that turns AI coding wait states into revenue — paid out in USDC on Solana.

While Claude Code is thinking, a single clearly-disclosed sponsored line appears. Verified impressions accrue to the developer's balance and settle in USDC on Solana. No bank account, no country restrictions.

**Status: live on Solana devnet.** No real money has moved — every amount is devnet USDC.

- **Site & API:** https://lingerserver-production.up.railway.app
- **CLI:** [`lingersh`](https://www.npmjs.com/package/lingersh) on npm

```bash
npm i -g lingersh && linger init --spinner   # install the status line + daemon
linger login                                 # connect a wallet (Phantom / Solflare / Backpack)
linger balance                               # what you've earned
```

Advertisers sign in at [`/advertisers/app`](https://lingerserver-production.up.railway.app/advertisers/app), deposit devnet USDC and launch a campaign. Developers see what they earned at [`/app`](https://lingerserver-production.up.railway.app/app) and can withdraw any amount, at any time. See [Verification status](#verification-status) for exactly what has and hasn't been exercised.

The plan of record is [`ROADMAP.md`](ROADMAP.md).

---

## Where it works

Ads are shown, and impressions counted, **only in Claude Code running in a terminal** — including the integrated terminal of VS Code, Cursor or JetBrains. Billing rests entirely on the `statusLine`, and Claude Code's documentation does not say that the VS Code / JetBrains extension panels or the desktop app render a custom `statusLine`, so Linger shows nothing and counts nothing there. `linger doctor` says this too.

On Windows, Claude Code runs the `statusLine` and hook commands through Git Bash, or through PowerShell when Git for Windows is not installed. Linger writes commands that work in both (and in `cmd`): the program is never quoted, and paths use forward slashes. `linger doctor` runs the installed commands in every available shell and shows which one Claude Code uses; `linger doctor --fix` rewrites installs made by older versions.

## Why Solana

Per-impression amounts are tiny — a fraction of a cent. On traditional rails the fixed cost of a payout (transfer fee, FX spread, compliance overhead) routinely exceeds the payout itself, which forces platforms into high thresholds, monthly batches, and a short list of supported countries. Developers in Turkey, Latin America, South Asia and Africa generate value they cannot collect.

A Solana transfer costs 5,000 lamports (0.000005 SOL) per signature plus an optional priority fee, and USDC is a first-class SPL token that every major wallet already shows. That makes it possible to drop the payout threshold entirely: a developer can withdraw any amount the moment it is verified.

One cost to be aware of: a recipient's USDC token account (ATA) must exist before they can receive USDC, and the *sender* opens it — about 0.002 SOL of rent per new recipient. The platform pays it once per publisher; with no threshold, a first withdrawal of a few cents costs the platform more than it sends. That is a deliberate choice for now and is tracked as an open question in the roadmap.

## What has been measured

**Ad surface** — Claude Code exposes official extension points (`statusLine`, `spinnerVerbs`). No patching of the host application, no output interception. This measurement is independent of the chain and still holds. Throwaway probes live in [`spikes/`](spikes/).

| Question | Result |
|---|---|
| Does the line refresh while the model is working? | Yes — 100% of qualifying windows, ~34 refreshes each |
| How much of the wait is actually long enough to sell? | 50% of turns exceed 10s; p50 37s, p90 322s |
| What does the client cost? | ~13,700 invocations/day/session; shim round-trip 22ms |

An early version of the measurement defined the wait window as tool execution time. That was wrong — tools finish in under a second and the inventory looked like zero. The wait a user actually experiences is the model thinking, which lives in the gaps *between* hooks. The correction is documented in ADR-001.

**Payment rail** — the failure modes that shaped the design (one bad destination drops a whole batch, a failed transaction still lands and still costs a fee, retries must re-send identical bytes) are encoded in the code, covered by unit tests against a mock rail, and proven on devnet by `test:devnet` (6/6, see below).

## Architecture

```
Claude Code
    │  hooks: UserPromptSubmit → Stop
    ▼
statusLine shim ──22ms──> lingerd ──> turn state machine
    │                        │            │
    └──── ✶ Sponsor … ───────┘       disk queue
                                          │
                                          ▼
                                   Linger backend ──> Solana (USDC / SPL)
```

The daemon holds the ad in memory so the shim never touches the network. If the daemon is down, unreachable, or unsure, the shim prints **nothing** — never an error, never a stale line. Fail closed.

**Identity is a wallet.** Publishers and advertisers sign in by signing a plain-text message with Phantom, Solflare or Backpack (`signMessage`, verified with ed25519). The message is not a transaction and cannot be submitted to the network. The publisher id *is* the wallet address.

## Design principles

**Disclosure is not optional.** Every surface, including the spinner verb, starts with `✶`. An ad is never formatted to look like the tool's own output.

**Ad copy is hostile input.** A creative containing control characters is an attack attempt, not sloppy input — it is rejected, not sanitized and served. 20 attack vectors are covered by tests, from OSC 52 clipboard writes to bidi override.

**Only what is measured is billed.** The ad is shown only during an active turn plus a short grace period. Idle time is not shown and not counted, even though it could be.

**Money is integers.** Amounts are branded `bigint` micro-USDC (1e-6 — the USDC mint's own precision, so ledger amounts and on-chain amounts are the same number). Floats are banned. The ledger is double-entry and every reversal is a negation of the original entries, never a recomputation.

**Settled means finalized.** A payout is only "paid" when the transaction has no error *and* is finalized. A submitted transaction, or one that landed and failed, is not paid.

## Repo layout

```
ROADMAP.md              the plan: milestones, exit criteria, open questions
STITCH-BRIEF.md         frontend brief (for a UI design tool)
PROJECT.md              living design document — ADRs, data model, open questions
packages/protocol/      shared types, money, sanitizer, schemas
packages/payments/      SolanaRail, address policy, wallet sign-in, payout job
packages/server/        HTTP API, ledger, ad selection, deposits, withdrawals
packages/cli/           daemon, unix socket, shim, disk queue, `linger` command
contracts/vault/        Anchor program (escrow vault) — not wired into the server yet
scripts/                devnet faucet pool, end-to-end test campaign
spikes/                 throwaway probes
```

## Development

```bash
pnpm install
pnpm test        # unit tests across all packages
pnpm typecheck
```

Requires Node 22+ and pnpm. The Anchor program needs Rust, the Solana CLI and Anchor:

```bash
cd contracts/vault
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
anchor build && cargo test
```

Run the server locally (in-memory database, devnet):

```bash
pnpm --filter @linger/server build
PORT=8787 node packages/server/dist/server.mjs
```

See [`.env.example`](.env.example) for every variable.

## Verification status

| Area | Status |
|---|---|
| Unit tests (protocol, payments, server, CLI) | ✅ pass — 700+ tests |
| `SolanaRail` against a real Solana cluster (`test:devnet`) | ✅ 6/6 pass on devnet (2026-09-23): ATA creation, multi-payout, idempotent resend, frozen destination, expired blockhash |
| Anchor vault program: build + 15 litesvm tests | ✅ pass |
| Deployed backend (Railway, devnet, persistent SQLite volume) | ✅ live |
| CLI published to npm, clean global install | ✅ `lingersh` |
| Wallet login with a real Phantom wallet (CLI + web) | ✅ checked on the live server |
| Advertiser deposit credited by the deposit watcher → campaign served → impressions verified after the hold | ✅ checked on the live server |
| Developer withdrawal on the live server | ⏳ code path unit-tested and on-chain rail proven; not yet exercised end-to-end on the deployment |
| Vault program wired into the server | ❌ not started (server uses a hot-wallet treasury) |

## Status

- [x] Assumptions measured — ad surface
- [x] `protocol` — money, sanitizer, schemas, injectable clock
- [x] Daemon — turn state machine, unix socket, shim, disk queue
- [x] Backend — ad serving, impression ingest, ledger, campaigns, withdrawals
- [x] Wallet sign-in — message signature (Phantom / Solflare / Backpack)
- [x] Payments code — `SolanaRail`, address policy, payout job, deposit watcher
- [x] Payments proven on devnet
- [x] Deployed (devnet) and CLI on npm
- [ ] Vault program integrated

Mainnet, click attribution, and adapters beyond Claude Code are explicitly out of scope for now. See [`ROADMAP.md`](ROADMAP.md).
