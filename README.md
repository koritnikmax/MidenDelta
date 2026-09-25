# MidenDelta

A regulated fund with on-chain units and on-chain execution. Vault 01 is a delta-neutral ETH cash and carry on
Hyperliquid, for professional and semi-professional investors only. This repository holds the testnet prototype on
**HyperEVM testnet (chain 998)**, following the compliance-first spec (Liechtenstein AIF, ERC-3643 units, ERC-7540 dealing).

```
contracts/   Solidity (Foundry): fund unit, identity registry, epoch vault, NAV oracle, strategy manager, venue adapter, tests
keeper/      TypeScript: deploy, keeper bot (epochs + hedge), status, end-to-end check, big-blocks toggle
web/         Vite + React: testnet demo (subscribe / redeem) and the internal ops dashboard
site/        Static marketing site (home, investors, team, performance), published with the demo under /demo/
```

## Contracts

| Contract | Standard | Job |
|---|---|---|
| `MidenShareToken` | ERC-3643-style, ERC-20 compatible | The fund's unit register. Only the vault mints and burns, only to verified identities. Phase 1: peer transfers off; the administrator moves units with `forcedTransfer`. Agent tools: freeze, recovery, pause. |
| `IdentityRegistry` | ERC-3643-style | Wallet → identity with country, investor category (professional / semi-professional), KYC expiry, subscription date. US and sanctioned countries blocked. |
| `EligibilityCompliance` | ERC-3643-style module | Built and tested, off in Phase 1: EUR 200k anti-splitting for new semi-professionals, minimum holding, same-identity pass-through. Valued at administrator EUR NAV, aggregated per identity. |
| `MidenVault` | ERC-7540 (async ERC-4626) | Request → epoch close → administrator NAV → settle → claim. Synchronous previews revert. |
| `NavOracle` | custom | Administrator NAV per unit in USD and EUR, one per epoch, with a sanity bound. |
| `LiquidityManager` | custom | Redemption gate (pro-rata, no seniority), anti-dilution levy on net outflow, optional early-redemption fee. |
| `StrategyManager` | custom | Leverage cap (3x), buffer, hedge band, margin floor, venue cap, order size, markets. The keeper's only path to the venue; withdrawals only to depositary allow-list. |
| `IHedgeVenueAdapter` | interface | Venue-specific calls behind one interface: Hyperliquid today, more venues later. |
| `SimulatedHyperliquidAdapter` | testnet only | Simulates the spot leg and perp short, driven by real Hyperliquid price and funding. |
| `FundTimelock` | OZ TimelockController | Holds admin on every contract. |
| `TestnetOnboarding` | testnet only | Self-registration as a test professional investor for the demo. |

Roles: `DEFAULT_ADMIN` (AIFM multisig via timelock), `AGENT` (administrator), `NAV_SIGNER` (administrator),
`KEEPER` (execution only: cannot withdraw, change parameters or unpause), `GUARDIAN` (kill switch).
On testnet the deployer stands in for all of them. Every value marked `[CONFIRM]` in the code is a parameter pending counsel / AIFM sign-off.

Not built yet: the production `HyperliquidAdapter` (CoreWriter + read precompiles with state verification), depositary
co-signing, the seed share class, US hooks.

## Run it (Terminal on your Mac; needs Node 18+ and, for contracts, Foundry)

```bash
cd ~/Documents/MidenDelta/contracts
forge test                                   # 23 tests covering the spec's acceptance criteria
forge build && node script/export-abi.mjs    # refresh ABIs/bytecode for keeper and web after contract changes

cd ../keeper
npm install
npm run status            # keeper wallet: HYPE balance and HyperCore account
npm run deploy            # deploys everything, enables/disables big blocks itself, hands admin to the timelock
npm run keeper            # epochs + hedge every 5 min (Ctrl-C to stop); --once for a single cycle
npm run e2e               # investor round trip (run the keeper alongside)

cd ../web
npm install
npm run dev               # demo on http://localhost:5173
npm run build:ops         # internal ops dashboard -> web/ops-dist/ops.html (never published)
```

The deployer needs testnet HYPE on HyperEVM **and** an account on HyperCore (send it ~1 test USDC there once),
otherwise big blocks can't be enabled. Its private key is in `keeper/.env` and is test-only.

## Unaudited testnet prototype

The contracts have not been audited. Before mainnet: formal verification and a tier-1 audit, the CoreWriter adapter,
the AIFM's multisig and timelock, the depositary set-up, and legal sign-off on every `[CONFIRM]` parameter.
