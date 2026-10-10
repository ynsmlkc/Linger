# Linger

> Terminal-native ad marketplace that turns AI coding wait states into revenue — paid out in USDC on Solana.

While Claude Code is thinking, a single clearly-disclosed sponsored line appears. Verified impressions accrue to the developer's balance and settle in USDC on Solana. No bank account, no country restrictions.

**Status: pre-alpha, devnet only.** The backend, ledger, wallet login and payout code are implemented and unit-tested. Nothing is deployed, and the Solana payment rail has **not yet been run against devnet** (see [Verification status](#verification-status)). No real money has moved.

The plan of record is [`ROADMAP.md`](ROADMAP.md).

---

## Why Solana

Per-impression amounts are tiny — a fraction of a cent. On traditional rails the fixed cost of a payout (transfer fee, FX spread, compliance overhead) routinely exceeds the payout itself, which forces platforms into high thresholds, monthly batches, and a short list of supported countries. Developers in Turkey, Latin America, South Asia and Africa generate value they cannot collect.

A Solana transfer costs 5,000 lamports (0.000005 SOL) per signature plus an optional priority fee, and USDC is a first-class SPL token that every major wallet already shows. A $1 payout threshold is economically sane.

One cost to be aware of: a recipient's USDC token account (ATA) must exist before they can receive USDC, and the *sender* opens it — about 0.002 SOL of rent per new recipient. That is paid once per publisher and is tracked as an open question in the roadmap.

## What has been measured

**Ad surface** — Claude Code exposes official extension points (`statusLine`, `spinnerVerbs`). No patching of the host application, no output interception. This measurement is independent of the chain and still holds. Throwaway probes live in [`spikes/`](spikes/).

| Question | Result |
|---|---|
| Does the line refresh while the model is working? | Yes — 100% of qualifying windows, ~34 refreshes each |
| How much of the wait is actually long enough to sell? | 50% of turns exceed 10s; p50 37s, p90 322s |
| What does the client cost? | ~13,700 invocations/day/session; shim round-trip 22ms |

An early version of the measurement defined the wait window as tool execution time. That was wrong — tools finish in under a second and the inventory looked like zero. The wait a user actually experiences is the model thinking, which lives in the gaps *between* hooks. The correction is documented in ADR-001.

**Payment rail** — *not yet measured on Solana.* The failure modes that shaped the design (one bad destination drops a whole batch, a failed transaction still lands and still costs a fee, retries must re-send identical bytes) are encoded in the code and covered by unit tests against a mock rail. The devnet integration test that proves them on a real cluster is written but has not been run; see [`spikes/README.md`](spikes/README.md).

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
| Unit tests (protocol, payments, server, CLI) | ✅ pass |
| Bundled server boots; wallet login round-trip with a real ed25519 signature | ✅ checked locally |
| Anchor vault program: build + 15 litesvm tests | ✅ pass |
| `SolanaRail` against a real Solana cluster (`test:devnet`) | ✅ 6/6 pass on devnet (2026-09-23): ATA creation, multi-payout, idempotent resend, frozen destination, expired blockhash |
| Deposit watcher (`SolanaDepositSource`) against a real deposit | ⏳ **not tested** — unit-tested against a fake source only |
| Browser login page with a real Phantom / Solflare / Backpack | ⏳ **not tested** |
| Vault program wired into the server | ❌ not started (server uses a hot-wallet treasury) |
| Deployed backend | ❌ none |

## Status

- [x] Assumptions measured — ad surface
- [x] `protocol` — money, sanitizer, schemas, injectable clock
- [x] Daemon — turn state machine, unix socket, shim, disk queue
- [x] Backend — ad serving, impression ingest, ledger, campaigns, withdrawals
- [x] Wallet sign-in — message signature (Phantom / Solflare / Backpack)
- [x] Payments code — `SolanaRail`, address policy, payout job, deposit watcher
- [ ] Payments proven on devnet
- [ ] Vault program integrated

Mainnet, click attribution, and adapters beyond Claude Code are explicitly out of scope for now. See [`ROADMAP.md`](ROADMAP.md).
