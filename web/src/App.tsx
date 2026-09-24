import { useAccount, useDisconnect } from "wagmi";
import { useWallet } from "./useWallet";
import { formatUnits } from "viem";
import VaultApp from "./VaultApp";
import { useVaultState, fmtUsd } from "./useVault";
import { ADDR } from "./wagmi";

const NOT_DEPLOYED = /^0x0+$/.test(ADDR.vault);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

// Filigree delta inscribed in an open circle that touches all three corners: delta zero.
function Logo({ size = 30 }: { size?: number }) {
  const corners = [[0, -44], [38.105, 22], [-38.105, 22]];
  return (
    <svg width={size} height={size} viewBox="-50 -50 100 100" fill="none" stroke="#ffffff" strokeLinejoin="miter" aria-hidden>
      <circle r="44" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
      <path d="M0,-44 L38.105,22 L-38.105,22 Z" strokeWidth="1.7" vectorEffect="non-scaling-stroke" />
      <path d="M0,-33 L28.579,16.5 L-28.579,16.5 Z" strokeWidth="0.75" opacity={0.55} vectorEffect="non-scaling-stroke" />
      {corners.map(([x, y]) => <circle key={x} cx={x} cy={y} r="3.2" fill="#ffffff" stroke="none" />)}
    </svg>
  );
}

function WalletButton() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { connectWallet, isPending, error, clearError } = useWallet();
  if (isConnected && address)
    return (
      <button className="btn ghost" onClick={() => disconnect()} title="Disconnect">
        {short(address)}
      </button>
    );
  return (
    <div style={{ position: "relative" }}>
      <button className="btn light" onClick={connectWallet} disabled={isPending}>
        {isPending ? "Check your wallet…" : "Connect wallet"}
      </button>
      {error && (
        <div className="notice err" style={{ position: "absolute", right: 0, top: 52, width: 300, zIndex: 30 }} onClick={clearError}>
          {error}
        </div>
      )}
    </div>
  );
}

function Hero() {
  const vs = useVaultState();
  const capPct = vs.totalAssets !== undefined && vs.cap ? Number((vs.totalAssets * 10000n) / vs.cap) / 100 : 0;
  return (
    <header className="hero">
      <div className="wrap hero-grid">
        <div>
          <div className="eyebrow">On-chain asset management</div>
          <h1>
            Building the next-gen hedge fund
          </h1>
          <p className="lead">
            Institutional investment strategies wrapped as liquid vault tokens. Mint with USDC, trade freely, redeem at NAV, all on-chain, with
            no management fee.
          </p>
          <div className="hero-ctas">
            <a href="#app"><button className="btn">Mint MDELTA</button></a>
            <a href="../performance.html"><button className="btn ghost">View performance</button></a>
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
            <div className="row" style={{ color: "var(--muted)", padding: 0, borderBottom: 0 }}>
              <span>Guarded vault cap</span>
              <span className="num">{fmtUsd(vs.totalAssets, 0)} / {fmtUsd(vs.cap, 0)}</span>
            </div>
            <div className="bar"><i style={{ width: `${Math.max(capPct, 0.6)}%` }} /></div>
          </div>
          {NOT_DEPLOYED && (
            <div className="notice info" style={{ marginTop: 16 }}>Contracts are being deployed to HyperEVM testnet. Minting opens shortly.</div>
          )}
          {!NOT_DEPLOYED && !vs.ok && !vs.loading && (
            <div className="notice" style={{ marginTop: 16 }}>Can't reach HyperEVM testnet right now. Showing cached data.</div>
          )}
        </div>
      </div>
    </header>
  );
}

export default function App() {
  return (
    <>
      <nav className="nav">
        <div className="wrap">
          <a className="brand" href="../" title="Back to the MidenDelta homepage"><Logo /> MidenDelta</a>
          <span className="pill">Testnet</span>
          <div style={{ marginLeft: "auto" }}>
            <WalletButton />
          </div>
        </div>
      </nav>
      <Hero />
      <VaultApp />
    </>
  );
}
