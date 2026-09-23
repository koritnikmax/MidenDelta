# MidenDelta: testnet prototype

This is the Cash & Carry vault token (MDELTA) on **HyperEVM testnet (chain 998)**, with a homepage for minting and redeeming.

```
contracts/   Solidity (Foundry): MidenDeltaVault (ERC-20/4626 + ERC-8113), SimulatedStrategy, MockUSDC, 20 tests
keeper/      TypeScript: big-blocks toggle, deploy, keeper bot, status, end-to-end smoke test
web/         Vite + React + wagmi homepage, built as a single self-contained index.html
```

## What the contracts do

| Pitch-deck item | Implementation |
|---|---|
| ERC-20 + ERC-4626 vault, mint/redeem at live NAV | `deposit(assets, receiver)`, `redeem(assets, receiver)`, `redeemAll`, `convertToShares/Assets(…, seriesId)`, `totalAssets(seriesId)` |
| **ERC-8113 fair performance fee** | Series 0 is the lead series, i.e. the tradable MDELTA token. A deposit made while the lead is below its high-water mark goes into an outstanding series with its own high-water mark. When the lead sets a new high, all series are consolidated into lead shares (lazily per user). Redemptions are asset-based and taken FIFO: lead first, then the lowest series id. |
| 0% base fee, 19.5% performance fee | Charged per series on gains above that series' high-water mark, paid to the treasury as MDELTA |
| $1,000 minimum, guarded $10M cap | `minDeposit`, `depositCap` (admin-adjustable) |
| Liquidity buffer of about 5% of NAV | `bufferBps = 500`. The keeper's `rebalance()` keeps it idle and deploys the rest. |
| Dynamic exit fees | Only net outflow pays (netted against same-hour inflows). Rate = 3% × min(1, (queue depth / 20% of NAV)²). The fee stays in NAV for remaining holders. |
| Pro-rata partial fills | O(1) cumulative fill index. Every open request is filled by the same percentage, and the remainder rolls forward. |
| createOrder / executeOrder / reinvestFunding / adjustPosition | `SimulatedStrategy` splits capital 90.91% spot / 9.09% margin for a 10× short, then compounds real Hyperliquid ETH funding every hour |
| KYC whitelist (ERC-3643-style) | Built in and **off** by default: `setWhitelistEnabled(true)` and `setWhitelisted([...], true)` |

Milestone 2 replaces `SimulatedStrategy` with a `CoreWriterStrategy` behind the same `IStrategy` interface (`vault.setStrategy`).

## Run it (from your Mac's Terminal; needs Node 18+)

```bash
cd ~/Documents/MidenDelta/keeper
npm install
npm run status            # shows the keeper wallet + HYPE balance
npm run big-blocks        # one-time: lets the deployer use 30M-gas blocks (vault is ~4.5M gas)
npm run deploy            # deploys MockUSDC + vault + strategy, writes addresses for the website
npm run e2e               # optional smoke test: faucet → mint → funding → redeem → queue → claim
npm run keeper            # hourly keeper (Ctrl-C to stop). Demo speed-up: npm run keeper -- --demo-hours 24 --interval 60

cd ../web
npm install
npm run dev               # open http://localhost:5173 in the browser that has MetaMask
npm run build             # dist/index.html: one file, deployable to Vercel/Netlify
```

The keeper wallet's private key is in `keeper/.env`. It is a **test-only** key, so never send real funds to it.

MetaMask network: HyperEVM Testnet · RPC `https://rpc.hyperliquid-testnet.xyz/evm` · chain id `998` · symbol `HYPE`. The site asks to add it automatically.

## Contracts: build and test

```bash
cd contracts
forge install OpenZeppelin/openzeppelin-contracts@v5.1.0 foundry-rs/forge-std --no-git
forge test -vv
```

## Website hosting

Every push to `main` builds `web/` and publishes it to GitHub Pages (`.github/workflows/pages.yml`).
Turn it on once under **Settings → Pages → Source: GitHub Actions**.

## Unaudited testnet prototype

The contracts have not been audited. Before mainnet you need at least: formal verification plus a tier-1 audit, an oracle/NAV design for the CoreWriter strategy, a timelock or multisig on the admin roles, and a legal review (Reg D 506(c) / 3(c)(7), CFTC CPO).
