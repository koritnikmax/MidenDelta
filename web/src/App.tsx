import { useAccount, useConnect, useDisconnect } from "wagmi";
import { formatUnits } from "viem";
import VaultApp from "./VaultApp";
import Performance from "./Performance";
import { useVaultState, fmtUsd } from "./useVault";
import { ADDR, explorer } from "./wagmi";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id="coin" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6b8cff" />
          <stop offset="1" stopColor="#1d3a66" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="15" fill="url(#coin)" />
      <circle cx="16" cy="16" r="12.5" fill="none" stroke="rgba(255,255,255,.25)" strokeDasharray="1.5 1.5" />
      <path d="M16 7.5 L24.5 23.5 H7.5 Z" fill="none" stroke="#eef2fa" strokeWidth="2.4" strokeLinejoin="round" />
    </svg>
  );
}

function WalletButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  if (isConnected && address)
    return (
      <button className="btn ghost" onClick={() => disconnect()} title="Disconnect">
        {short(address)}
      </button>
    );
  return (
    <button className="btn light" onClick={() => connectors[0] && connect({ connector: connectors[0] })}>
      Connect wallet
    </button>
  );
}

function Hero() {
  const vs = useVaultState();
  const capPct = vs.totalAssets !== undefined && vs.cap ? Number((vs.totalAssets * 10000n) / vs.cap) / 100 : 0;
  return (
    <header className="hero">
      <div className="wrap hero-grid">
        <div>
          <div className="eyebrow">MidenDelta · On-chain asset management</div>
          <h1>
            Building the <em>next-gen</em> hedge fund
          </h1>
          <p className="lead">
            Institutional investment strategies wrapped as liquid vault tokens. Mint with USDC, trade freely, redeem at NAV, all on-chain, with
            no management fee.
          </p>
          <div className="hero-ctas">
            <a href="#app"><button className="btn">Mint MDELTA</button></a>
            <a href="#performance"><button className="btn ghost">View performance</button></a>
          </div>
          <div className="tags">
            <span>Decentralized</span>
            <span>Accessible</span>
            <span>On-chain</span>
          </div>
        </div>

        <div className="glass">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div style={{ fontWeight: 600 }}>
              <span className="live-dot" />
              Cash & Carry Vault
            </div>
            <span className="pill">HyperEVM testnet</span>
          </div>
          <div className="stat-grid">
            <div className="stat">
              <div className="k">NAV per MDELTA</div>
              <div className="v num">{vs.pps ? Number(formatUnits(vs.pps, 18)).toFixed(4) : "–"}<small>USDC</small></div>
            </div>
            <div className="stat">
              <div className="k">Total value locked</div>
              <div className="v num">{fmtUsd(vs.totalAssets, 0)}<small>USDC</small></div>
            </div>
            <div className="stat">
              <div className="k">Live funding (ETH, annualised)</div>
              <div className="v num">{vs.liveFundingApr !== undefined && vs.lastFundingAt ? `${vs.liveFundingApr.toFixed(2)}%` : "–"}</div>
            </div>
            <div className="stat">
              <div className="k">Hedge ratio</div>
              <div className="v num">{vs.hedgeRatioBps !== undefined ? `${(Number(vs.hedgeRatioBps) / 100).toFixed(1)}%` : "–"}<small>delta ≈ 0</small></div>
            </div>
          </div>
          <div style={{ marginTop: 22 }}>
            <div className="row" style={{ color: "#8ea0c2", padding: 0 }}>
              <span>Guarded vault cap</span>
              <span className="num">{fmtUsd(vs.totalAssets, 0)} / {fmtUsd(vs.cap, 0)}</span>
            </div>
            <div className="bar"><i style={{ width: `${Math.max(capPct, 0.6)}%` }} /></div>
          </div>
          {!vs.ok && !vs.loading && (
            <div className="notice" style={{ marginTop: 16 }}>Can't reach HyperEVM testnet right now. Showing cached data.</div>
          )}
        </div>
      </div>
    </header>
  );
}

function Funds() {
  const vs = useVaultState();
  return (
    <section id="vaults">
      <div className="wrap">
        <div className="sec-head">
          <div className="eyebrow dark">Blockchain vaults as funds</div>
          <h2>One protocol, a growing shelf of strategies</h2>
          <p>
            Each MidenDelta fund is an automated, on-chain vault with its own token. Cash & carry arbitrage is the first. More strategies are on
            the way, each with the same zero base fee and transparent on-chain accounting.
          </p>
        </div>
        <div className="funds">
          <div className="card dark fund">
            <span className="badge live">Live · Fund 01</span>
            <h3>MidenDelta Cash & Carry</h3>
            <p>
              Spot ETH long plus a 10× perpetual short on Hyperliquid. The position is delta-neutral, so the fund earns the funding rate without
              betting on price. Funding is paid every hour and reinvested automatically.
            </p>
            <div className="kpis">
              <div><div className="v">≈12.24%</div><div className="k">Net target APR</div></div>
              <div><div className="v">14.12</div><div className="k">Hist. Sharpe</div></div>
              <div><div className="v num">{vs.pps ? Number(formatUnits(vs.pps, 18)).toFixed(4) : "–"}</div><div className="k">NAV / token</div></div>
            </div>
            <a href="#app"><button className="btn" style={{ marginTop: 6 }}>Mint MDELTA →</button></a>
          </div>
          <div className="card fund soon">
            <span className="badge soon">Coming soon · Fund 02</span>
            <h3>Funding Rotation</h3>
            <p>
              Scans every Hyperliquid perp above a market-cap threshold and rotates capital to the best risk-adjusted carry. The spot leg is made
              productive through staking.
            </p>
            <div className="phase">Phase 2 · Year one</div>
          </div>
          <div className="card fund soon">
            <span className="badge soon">Coming soon · Fund 03+</span>
            <h3>More automated strategies</h3>
            <p>
              New on-chain funds and vaults, collateral integrations with Morpho and Aave, and MidenUSD, the protocol's native stablecoin for
              paying out redemptions.
            </p>
            <div className="phase">Phase 3 · Year two onward</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function How() {
  return (
    <section className="how" id="how">
      <div className="wrap">
        <div className="sec-head">
          <div className="eyebrow">Under the hood</div>
          <h2>How the token is minted, traded and kept priced to the vault</h2>
          <p>MDELTA is an ERC-20 / ERC-4626-style vault share, with ERC-8113 series accounting so performance fees are fair.</p>
        </div>

        <div className="formula">
          Spot ETH Long <span>+</span> Perpetual Short <span>=</span> Delta 0
        </div>

        <div className="three">
          <div className="card">
            <div className="eyebrow">Zero directional risk</div>
            <h4>MidenDelta token</h4>
            <p>Mint and redeem directly against the live NAV. Deposit USDC on HyperEVM and receive your share of the vault.</p>
          </div>
          <div className="card">
            <div className="eyebrow">0.91× capital efficiency</div>
            <h4>Vault / treasury</h4>
            <p>90.91% of capital buys spot ETH and 9.09% margins a 10× perpetual short. A keeper bot monitors and rebalances the hedge.</p>
          </div>
          <div className="card">
            <div className="eyebrow">Compounding effect</div>
            <h4>Accumulating yield</h4>
            <p>Hourly funding in USDC is reinvested into the strategy, so the NAV per token compounds. There are no rebasing or claim steps.</p>
          </div>
        </div>

        <div className="lifecycle">
          <div className="card">
            <div className="eyebrow">Position lifecycle · HyperEVM</div>
            <div className="steps">
              <div><b className="fn">createOrder()</b><span>Open the 10× short with USDC as collateral and buy spot ETH on Hyperliquid</span></div>
              <div><b className="fn">executeOrder()</b><span>CoreWriter acts as the bridge between HyperEVM and HyperCore</span></div>
              <div><b className="fn">reinvestFunding()</b><span>Funding is paid hourly in USDC and reinvested automatically</span></div>
              <div><b className="fn">adjustPosition()</b><span>The keeper rebalances when the hedge ratio drifts past its threshold</span></div>
            </div>
          </div>
          <div className="card">
            <div className="eyebrow">Fair fees · ERC-8113 series accounting</div>
            <div className="steps">
              <div><b>0% base fee · 19.5% performance fee</b><span>Charged only on gains above a high-water mark</span></div>
              <div><b>Series instead of free-riding</b><span>A deposit made while the vault is below its high-water mark gets its own series and pays fees only on gains from its entry price. Existing holders never pay to recover their own losses.</span></div>
              <div><b>Consolidation</b><span>When the lead series sets a new high, all series merge back into one fungible, tradable MDELTA token</span></div>
              <div><b>FIFO, asset-based redemptions</b><span>Redemptions draw from the lead series first, then from the oldest series</span></div>
            </div>
          </div>
        </div>

        <div className="three" style={{ marginTop: 20 }}>
          <div className="card">
            <div className="eyebrow">Security</div>
            <h4>Liquidity buffer</h4>
            <p>About 5% of NAV is kept as unencumbered USDC and paid out in the same block, so small exits don't force the positions to readjust.</p>
          </div>
          <div className="card">
            <div className="eyebrow">Security</div>
            <h4>Dynamic exit fees</h4>
            <p>Only net outflow pays, at a rate that rises convexly with queue depth. The fees go back into NAV and benefit long-term holders.</p>
          </div>
          <div className="card">
            <div className="eyebrow">Security</div>
            <h4>Pro-rata partial fills</h4>
            <p>Redemptions above unwind capacity are filled at the same percentage for everyone. The rest rolls forward, so exiting first gives no advantage.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer>
      <div className="wrap">
        <div className="cols">
          <div>
            <div className="brand" style={{ color: "#fff" }}><Logo size={26} /> MidenDelta</div>
            <p style={{ marginTop: 10 }}>The first decentralized, on-chain and accessible hedge fund.</p>
          </div>
          <div className="addr mono">
            <span>Vault (MDELTA)</span><a href={explorer(ADDR.vault)} target="_blank" rel="noreferrer">{short(ADDR.vault)} ↗</a>
            <span>Strategy</span><a href={explorer(ADDR.strategy)} target="_blank" rel="noreferrer">{short(ADDR.strategy)} ↗</a>
            <span>Test USDC</span><a href={explorer(ADDR.usdc)} target="_blank" rel="noreferrer">{short(ADDR.usdc)} ↗</a>
          </div>
        </div>
        <p className="disclaimer">
          Testnet prototype. MDELTA on HyperEVM testnet is backed by test USDC with no monetary value, and the strategy is simulated using real
          Hyperliquid ETH funding rates. The contracts are unaudited. Nothing on this site is an offer to sell or a solicitation to buy
          securities. A production launch is intended for KYC-verified eligible investors only, through an ERC-3643-style transfer whitelist.
        </p>
      </div>
    </footer>
  );
}

export default function App() {
  return (
    <>
      <nav className="nav">
        <div className="wrap">
          <a className="brand" href="#"><Logo /> MidenDelta</a>
          <span className="pill">Testnet</span>
          <div className="nav-links">
            <a href="#vaults">Funds</a>
            <a href="#performance">Performance</a>
            <a href="#how">How it works</a>
            <a href="#app">Mint / Redeem</a>
          </div>
          <WalletButton />
        </div>
      </nav>
      <Hero />
      <Funds />
      <VaultApp />
      <Performance />
      <How />
      <Footer />
    </>
  );
}
