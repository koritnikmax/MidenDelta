import { useEffect, useMemo, useState, useCallback } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceArea, ReferenceLine, ComposedChart, Bar, Legend, Cell,
} from "recharts";
import { readLive, loadHistory, fmt, REASONS, KEEPER, isDeployed, resolveDeployments, type Live, type Snap, type VaultEvt } from "./data";
import { readMarket, readFunding, readCoreAccount, type Market, type FundingPoint, type CoreAccount } from "./core";
import { ADDR, explorer } from "../wagmi";

const REFRESH_MS = 15_000;
const HEDGE_EFFICIENCY = 10 / 11; // 90.91% of capital earns funding at a 10× short
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const ago = (t: number, now: number) => {
  const s = Math.max(0, now - t);
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172800) return `${(s / 3600).toFixed(1)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};
const until = (ms: number) => {
  const m = Math.max(0, Math.round((ms - Date.now()) / 60000));
  return m < 1 ? "now" : m < 60 ? `in ${m} min` : `in ${(m / 60).toFixed(1)} h`;
};
const tfmt = (t: number) => new Date(t * 1000).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const pct = (x: number, dp = 2) => `${x >= 0 ? "+" : ""}${x.toFixed(dp)}%`;
const usdK = (v: number) => (Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${fmt(v, 0)}`);

// Monochrome chart palette: long = solid white, short = grey dashed, reference = faint.
const C = { long: "#ffffff", short: "#8c8c8c", net: "#ffffff", price: "#6e6e6e", bar: "#d9d9d9", neg: "#e5484d", grid: "#1c1c1c", axis: "#8c8c8c", band: "#ffffff" };
const tip = { contentStyle: { background: "#0c0c0c", border: "1px solid #333", borderRadius: 10, fontFamily: "Geist Mono", fontSize: 12, color: "#f5f5f5" }, labelFormatter: (t: number) => tfmt(t) };
const axis = { tick: { fontSize: 11, fill: C.axis, fontFamily: "Geist Mono" }, axisLine: false, tickLine: false } as const;

type Tone = "ok" | "warn" | "bad" | "info";
function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

export default function OpsApp() {
  const [live, setLive] = useState<Live | null>(null);
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [events, setEvents] = useState<VaultEvt[]>([]);
  const [market, setMarket] = useState<Market | null>(null);
  const [funding, setFunding] = useState<FundingPoint[]>([]);
  const [core, setCore] = useState<CoreAccount | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [updated, setUpdated] = useState<number>(0);
  const [range, setRange] = useState<"24h" | "7d" | "30d" | "all">("7d");
  const [deployed, setDeployed] = useState(isDeployed());

  const refresh = useCallback(async () => {
    const errors: string[] = [];
    const note = (e: any) => errors.push(e?.shortMessage ?? e?.message ?? String(e));
    // HyperCore: always available, even before the contracts exist
    await Promise.all([
      readMarket().then(setMarket, note),
      readFunding(7).then(setFunding, note),
      readCoreAccount(KEEPER).then(setCore, note),
    ]);
    // HyperEVM vault + strategy
    if (!isDeployed()) await resolveDeployments();
    if (isDeployed()) {
      setDeployed(true);
      try {
        const [l, h] = await Promise.all([readLive(), loadHistory((p) => setProgress(p < 100 ? p : null))]);
        setLive(l);
        setSnaps(h.snaps);
        setEvents(h.vaultEvents);
      } catch (e) {
        note(e);
      } finally {
        setProgress(null);
      }
    }
    setErr(errors.length ? errors.join(" · ") : null);
    setUpdated(Math.floor(Date.now() / 1000));
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const now = live?.blockTime ?? Math.floor(Date.now() / 1000);
  const view = useMemo(() => {
    const span = { "24h": 86400, "7d": 604800, "30d": 2592000, all: Infinity }[range];
    return snaps.filter((s) => now - s.t <= span);
  }, [snaps, range, now]);
  const rebalances = useMemo(() => snaps.filter((s) => s.reason === 3), [snaps]);

  const L = live;
  const longUsd = L ? L.spotEth * L.price : 0;
  const shortUsd = L ? L.shortEth * L.price : 0;
  const margin = L ? L.tv - longUsd : 0;
  const netEth = L ? L.spotEth - L.shortEth : 0;
  const effLev = margin > 0 ? shortUsd / margin : 0;
  const liqDist = shortUsd > 0 ? (margin / shortUsd) * 100 : 0; // % ETH rise that wipes short margin
  const liqPrice = L && L.shortEth > 0 ? L.price + margin / L.shortEth : 0;
  const targetMargin = L ? 10000 - L.spotBps : 909;
  const hedgeOk = L ? Math.abs(L.hedgeBps - 10000) <= L.driftBps : true;
  const marginOk = L ? L.marginBps <= (targetMargin * 3) / 2 && L.marginBps >= (targetMargin * 2) / 3 : true;
  const staleSec = L && L.lastFundingAt ? now - L.lastFundingAt : Infinity;
  const bufferTarget = L ? (L.nav * L.bufferBps) / 10000 : 0;
  const freeIdle = L ? L.idle - L.reserved : 0;
  const annualised = L ? L.lastRate * 8760 * 100 : 0;

  const M = market;
  const fundingApr = M ? M.funding * 8760 * 100 : 0;
  const avg7 = funding.length ? funding.reduce((a, b) => a + b.apr, 0) / funding.length : 0;
  const pos7 = funding.length ? (funding.filter((f) => f.rate > 0).length / funding.length) * 100 : 0;
  const hl = M?.venues.find((v) => v.venue === "Hl");
  const gas = core?.evmHype ?? L?.keeperHype ?? 0;
  const coreActive = core ? core.role !== "missing" : true;

  return (
    <div className="ops wrap">
      <Header />

      {/* ------------ status strip ------------ */}
      <div className="status">
        {deployed && (
          <Pill tone={staleSec < 7200 ? "ok" : staleSec < 21600 ? "warn" : "bad"}>
            Keeper {L?.lastFundingAt ? `last ran ${ago(L.lastFundingAt, now)}` : "has not run yet"}
          </Pill>
        )}
        <Pill tone={gas > 0.05 ? "ok" : gas > 0.005 ? "warn" : "bad"}>Gas {gas.toFixed(4)} HYPE</Pill>
        <Pill tone={coreActive ? "ok" : "bad"}>HyperCore account {core ? (coreActive ? core.role : "not activated") : "…"}</Pill>
        {deployed && <Pill tone={hedgeOk ? "ok" : "bad"}>Hedge {L ? (L.hedgeBps / 100).toFixed(2) : "–"}%</Pill>}
        {deployed && <Pill tone={marginOk ? "ok" : "warn"}>Margin {L ? (L.marginBps / 100).toFixed(2) : "–"}%</Pill>}
        {deployed && <Pill tone={L && L.queued > 0 ? "warn" : "ok"}>Queue {L ? fmt(L.queued) : "–"} USDC</Pill>}
        <span className="muted small refresh">
          {progress !== null ? `Loading history ${progress}%` : updated ? `${L ? `Block ${L.block.toLocaleString()}, ` : ""}updated ${ago(updated, Math.floor(Date.now() / 1000))}, every 15 s` : "Loading"}
          <button className="mini" onClick={refresh}>Refresh</button>
        </span>
      </div>
      {err && <div className="alert">Data error: {err}</div>}

      {/* ------------ market (HyperCore mainnet) ------------ */}
      <section className="block">
        <div className="block-h"><h2>Market</h2><span className="src">HyperCore mainnet, ETH-PERP, live</span></div>
        <div className="market">
          <div className="panel">
            <div className="figs">
              <Fig k="Mark price" v={M ? `$${fmt(M.mark)}` : "–"} s={M ? `${pct(((M.mark - M.prevDay) / M.prevDay) * 100)} in 24 h` : ""} />
              <Fig k="Funding now" v={M ? `${(M.funding * 100).toFixed(4)}%` : "–"} s={M ? `per hour, ${fundingApr.toFixed(2)}% APR` : ""} tone={M && M.funding < 0 ? "bad" : undefined} />
              <Fig k="Vault yield at this rate" v={M ? `${(fundingApr * HEDGE_EFFICIENCY).toFixed(2)}%` : "–"} s="APR after the 10× hedge" />
              <Fig k="7-day average" v={funding.length ? `${avg7.toFixed(2)}%` : "–"} s={funding.length ? `APR, ${pos7.toFixed(0)}% of hours positive` : ""} />
            </div>
            <div className="kvgrid">
              <div className="kv"><span>Oracle price</span><b>${M ? fmt(M.oracle) : "–"}</b></div>
              <div className="kv"><span>Premium</span><b>{M ? `${(M.premium * 100).toFixed(4)}%` : "–"}</b></div>
              <div className="kv"><span>Open interest</span><b>{M ? `${fmt(M.openInterest, 0)} ETH (${usdK(M.openInterest * M.mark)})` : "–"}</b></div>
              <div className="kv"><span>24 h volume</span><b>{M ? usdK(M.dayVolume) : "–"}</b></div>
              <div className="kv"><span>Next Hyperliquid funding</span><b>{hl ? `${(hl.rate * 100).toFixed(4)}%/h, ${until(hl.next)}` : "–"}</b></div>
              <div className="kv"><span>Max leverage on venue</span><b>{M ? `${M.maxLeverage}×` : "–"}</b></div>
            </div>
          </div>
          <div className="panel">
            <h4>Predicted funding by venue</h4>
            <div className="muted small" style={{ marginBottom: 12 }}>Normalised to an hourly rate, annualised on the right</div>
            {(M?.venues ?? []).map((v) => (
              <div className="venue" key={v.venue}>
                <span className="vname">{v.venue === "Hl" ? "Hyperliquid" : v.venue === "Bin" ? "Binance" : v.venue}</span>
                <span className="vbar"><i style={{ width: `${Math.min(100, (Math.abs(v.rate) / Math.max(...M!.venues.map((x) => Math.abs(x.rate)), 1e-9)) * 100)}%` }} className={v.rate < 0 ? "neg" : ""} /></span>
                <b className={v.rate < 0 ? "bad" : ""}>{(v.rate * 8760 * 100).toFixed(2)}%</b>
              </div>
            ))}
            {!M?.venues.length && <p className="muted small">Loading venues…</p>}
          </div>
        </div>
        <Chart title="ETH funding, last 7 days" sub="Hourly Hyperliquid funding, annualised. Shorts receive it when positive." wide>
          <ComposedChart data={funding}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={tfmt} {...axis} minTickGap={60} />
            <YAxis {...axis} width={50} tickFormatter={(v) => `${v.toFixed(0)}%`} />
            <ReferenceLine y={0} stroke="#444" />
            <ReferenceLine y={avg7} stroke={C.short} strokeDasharray="4 4" label={{ value: `avg ${avg7.toFixed(1)}%`, position: "insideTopRight", fill: C.axis, fontSize: 11 }} />
            <Tooltip {...tip} formatter={(v: number) => [`${v.toFixed(2)}% APR`, "Funding"]} />
            <Bar isAnimationActive={false} dataKey="apr" name="Funding APR">
              {funding.map((f) => <Cell key={f.t} fill={f.apr < 0 ? C.neg : C.bar} />)}
            </Bar>
          </ComposedChart>
        </Chart>
      </section>

      {/* ------------ keeper (HyperCore testnet + HyperEVM) ------------ */}
      <section className="block">
        <div className="block-h"><h2>Keeper</h2><span className="src">HyperCore testnet and HyperEVM testnet</span></div>
        <div className="panel keeper">
          <div>
            <div className="kv"><span>Address</span><b><a href={explorer(KEEPER)} target="_blank" rel="noreferrer">{short(KEEPER)}</a></b></div>
            <div className="kv"><span>HyperEVM gas</span><b className={gas < 0.005 ? "bad" : ""}>{gas.toFixed(4)} HYPE</b></div>
            <div className="kv"><span>HyperCore account</span><b className={coreActive ? "" : "bad"}>{core ? (coreActive ? core.role : "not activated") : "–"}</b></div>
          </div>
          <div>
            <div className="kv"><span>HyperCore perp account value</span><b>{core ? `$${fmt(core.accountValue)}` : "–"}</b></div>
            <div className="kv"><span>HyperCore spot balances</span><b>{core ? (core.spot.length ? core.spot.map((b) => `${fmt(b.total, 4)} ${b.coin}`).join(", ") : "none") : "–"}</b></div>
            <div className="kv"><span>Open perp positions</span><b>{core ? core.perpPositions : "–"}</b></div>
          </div>
          {core && !coreActive && (
            <p className="note">
              This address has no HyperCore account yet, so large blocks can't be enabled and the vault can't be deployed. Send any small
              amount (for example 1 test USDC) to it on app.hyperliquid-testnet.xyz to activate it.
            </p>
          )}
        </div>
      </section>

      {/* ------------ vault + positions (HyperEVM) ------------ */}
      {!deployed ? (
        <section className="block">
          <div className="block-h"><h2>Vault</h2><span className="src">HyperEVM testnet</span></div>
          <div className="panel">
            <h3><span className="pulse" />Waiting for deployment</h3>
            <p className="muted">
              No MidenDelta contracts on HyperEVM testnet yet. This page checks the GitHub repository every 15 seconds and switches to the
              live positions as soon as the deployed addresses are pushed.
            </p>
          </div>
        </section>
      ) : (
        <>
          <section className="block">
            <div className="block-h"><h2>Positions</h2><span className="src">HyperEVM testnet, SimulatedStrategy</span></div>
            <div className="legs">
              <div className="panel leg">
                <div className="leg-h"><span className="mark fill" />Long leg, spot ETH</div>
                <div className="big">{L ? L.spotEth.toFixed(4) : "–"} <small>ETH</small></div>
                <div className="kv"><span>Market value</span><b>${fmt(longUsd)}</b></div>
                <div className="kv"><span>Share of strategy</span><b>{L && L.tv ? ((longUsd / L.tv) * 100).toFixed(2) : "–"}% <em>target {L ? (L.spotBps / 100).toFixed(2) : "–"}%</em></b></div>
                <div className="kv"><span>ETH mark price</span><b>${L ? fmt(L.price) : "–"}</b></div>
              </div>

              <div className="panel leg">
                <div className="leg-h"><span className="mark hollow" />Short leg, ETH perp ({L?.leverage ?? 10}× target)</div>
                <div className="big">−{L ? L.shortEth.toFixed(4) : "–"} <small>ETH</small></div>
                <div className="kv"><span>Notional</span><b>${fmt(shortUsd)}</b></div>
                <div className="kv"><span>Margin equity incl. unrealised PnL</span><b>${fmt(margin)}</b></div>
                <div className="kv"><span>Effective leverage</span><b className={effLev > (L?.leverage ?? 10) * 1.3 ? "bad" : ""}>{effLev.toFixed(2)}×</b></div>
                <div className="kv"><span>Margin wiped if ETH rises</span><b className={liqDist < 5 ? "bad" : ""}>+{liqDist.toFixed(2)}% to ${fmt(liqPrice)}</b></div>
              </div>

              <div className="panel leg">
                <div className="leg-h"><span className="mark ring" />Net position</div>
                <div className="big">{netEth >= 0 ? "+" : ""}{netEth.toFixed(4)} <small>ETH delta</small></div>
                <div className="kv"><span>Net delta (USD)</span><b className={Math.abs(netEth * (L?.price ?? 0)) > (L?.tv ?? 0) * 0.02 ? "bad" : ""}>{netEth >= 0 ? "+" : "−"}${fmt(Math.abs(netEth * (L?.price ?? 0)))}</b></div>
                <div className="kv"><span>Hedge ratio, short ÷ long</span><b className={hedgeOk ? "" : "bad"}>{L ? (L.hedgeBps / 100).toFixed(2) : "–"}% <em>band ±{L ? (L.driftBps / 100).toFixed(1) : "–"}%</em></b></div>
                <div className="kv"><span>Strategy value</span><b>${L ? fmt(L.tv) : "–"}</b></div>
                <div className="kv"><span>Funding earned, cumulative</span><b>+${L ? fmt(L.cumFunding) : "–"}</b></div>
                <div className="kv"><span>Last funding applied</span><b>{L ? (L.lastRate * 100).toFixed(5) : "–"}%/h, {annualised.toFixed(2)}% APR</b></div>
              </div>
            </div>
          </section>

          <div className="range">
            {(["24h", "7d", "30d", "all"] as const).map((r) => (
              <button key={r} className={r === range ? "on" : ""} onClick={() => setRange(r)}>{r}</button>
            ))}
            <span className="muted small">{view.length} snapshots, {rebalances.length} rebalances in total</span>
          </div>

          {view.length === 0 ? (
            <div className="panel"><p className="muted">No position history in this range yet. The first snapshot appears after the first mint and rebalance.</p></div>
          ) : (
            <div className="charts">
              <Chart title="Long vs short notional" sub="USD. Solid = long, dashed = short; they overlap when fully hedged. Vertical marks = rebalances">
                <LineChart data={view}>
                  <CartesianGrid stroke={C.grid} vertical={false} />
                  <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={tfmt} {...axis} minTickGap={50} />
                  <YAxis {...axis} tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`} width={56} />
                  <Tooltip {...tip} formatter={(v: number, n) => [`$${fmt(v)}`, n]} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {rebalances.filter((r) => view.includes(r)).map((r) => <ReferenceLine key={r.block + "r"} x={r.t} stroke="#3a3a3a" strokeDasharray="3 3" />)}
                  <Line isAnimationActive={false} type="stepAfter" dataKey="longUsd" name="Long (spot)" stroke={C.long} dot={false} strokeWidth={3} strokeOpacity={0.85} />
                  <Line isAnimationActive={false} type="stepAfter" dataKey="shortUsd" name="Short (perp)" stroke={C.short} dot={false} strokeWidth={1.5} strokeDasharray="5 3" />
                </LineChart>
              </Chart>

              <Chart title="Hedge ratio" sub={`Short ÷ long, %. Rebalance band ${L ? 100 - L.driftBps / 100 : 98}–${L ? 100 + L.driftBps / 100 : 102}%`}>
                <LineChart data={view.map((s) => ({ ...s, hr: s.hedgeBps / 100 }))}>
                  <CartesianGrid stroke={C.grid} vertical={false} />
                  <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={tfmt} {...axis} minTickGap={50} />
                  <YAxis {...axis} domain={["auto", "auto"]} tickFormatter={(v) => `${v}%`} width={50} />
                  <ReferenceArea y1={L ? 100 - L.driftBps / 100 : 98} y2={L ? 100 + L.driftBps / 100 : 102} fill={C.band} fillOpacity={0.05} />
                  <ReferenceLine y={100} stroke="#555" />
                  <Tooltip {...tip} formatter={(v: number) => [`${v.toFixed(2)}%`, "Hedge ratio"]} />
                  <Line isAnimationActive={false} type="stepAfter" dataKey="hr" stroke={C.net} dot={false} strokeWidth={2} />
                </LineChart>
              </Chart>

              <Chart title="Short-leg margin" sub={`Margin equity as % of strategy. Target ${(targetMargin / 100).toFixed(2)}%, rebalance outside ${((targetMargin * 2) / 3 / 100).toFixed(1)}–${((targetMargin * 3) / 2 / 100).toFixed(1)}%`}>
                <LineChart data={view.map((s) => ({ ...s, mg: s.marginBps / 100 }))}>
                  <CartesianGrid stroke={C.grid} vertical={false} />
                  <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={tfmt} {...axis} minTickGap={50} />
                  <YAxis {...axis} domain={[0, "auto"]} tickFormatter={(v) => `${v}%`} width={44} />
                  <ReferenceArea y1={(targetMargin * 2) / 3 / 100} y2={(targetMargin * 3) / 2 / 100} fill={C.band} fillOpacity={0.05} />
                  <ReferenceLine y={targetMargin / 100} stroke="#555" />
                  <Tooltip {...tip} formatter={(v: number) => [`${v.toFixed(2)}%`, "Margin"]} />
                  <Line isAnimationActive={false} type="stepAfter" dataKey="mg" stroke={C.net} dot={false} strokeWidth={2} />
                </LineChart>
              </Chart>

              <Chart title="Net delta and ETH price" sub="Net ETH exposure (should stay near 0) against the ETH mark price">
                <ComposedChart data={view}>
                  <CartesianGrid stroke={C.grid} vertical={false} />
                  <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={tfmt} {...axis} minTickGap={50} />
                  <YAxis yAxisId="d" {...axis} width={56} tickFormatter={(v) => `${v.toFixed(4)}`} />
                  <YAxis yAxisId="p" orientation="right" {...axis} width={56} tickFormatter={(v) => `$${Math.round(v)}`} domain={["auto", "auto"]} />
                  <ReferenceLine yAxisId="d" y={0} stroke="#555" />
                  <Tooltip {...tip} formatter={(v: number, n) => [n === "ETH price" ? `$${fmt(v)}` : `${v.toFixed(4)} ETH`, n]} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line isAnimationActive={false} yAxisId="d" type="stepAfter" dataKey="netDeltaEth" name="Net delta" stroke={C.net} dot={false} strokeWidth={2} />
                  <Line isAnimationActive={false} yAxisId="p" type="monotone" dataKey="price" name="ETH price" stroke={C.price} dot={false} strokeWidth={1.5} strokeDasharray="4 2" />
                </ComposedChart>
              </Chart>

              <Chart title="Funding income" sub="USDC per keeper update (bars) and cumulative (line)" wide>
                <ComposedChart data={view.filter((s) => s.reason === 2)}>
                  <CartesianGrid stroke={C.grid} vertical={false} />
                  <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={tfmt} {...axis} minTickGap={50} />
                  <YAxis yAxisId="a" {...axis} width={50} tickFormatter={(v) => `$${v.toFixed(1)}`} />
                  <YAxis yAxisId="b" orientation="right" {...axis} width={60} tickFormatter={(v) => `$${fmt(v, 0)}`} />
                  <Tooltip {...tip} formatter={(v: number, n) => [`$${fmt(v, 4)}`, n]} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar isAnimationActive={false} yAxisId="a" dataKey="fundingPaid" name="Per update" fill={C.short} />
                  <Line isAnimationActive={false} yAxisId="b" type="monotone" dataKey="cumFunding" name="Cumulative" stroke={C.long} dot={false} strokeWidth={2} />
                </ComposedChart>
              </Chart>
            </div>
          )}

          <div className="panel">
            <h3>Position log <span className="muted small">every change to the legs, newest first</span></h3>
            <div className="tablewrap">
              <table>
                <thead>
                  <tr><th>Time</th><th>Action</th><th className="r">ETH px</th><th className="r">Long ETH</th><th className="r">Δ long</th><th className="r">Short ETH</th><th className="r">Δ short</th><th className="r">Hedge</th><th className="r">Margin</th><th className="r">Value</th><th></th></tr>
                </thead>
                <tbody>
                  {[...snaps].reverse().slice(0, 150).map((s, i, arr) => {
                    const prev = arr[i + 1];
                    const dL = prev ? s.spotEth - prev.spotEth : s.spotEth;
                    const dS = prev ? s.shortEth - prev.shortEth : s.shortEth;
                    return (
                      <tr key={s.block + ":" + i} className={s.reason === 3 ? "hl" : ""}>
                        <td>{tfmt(s.t)}</td>
                        <td><span className={`tag r${s.reason}`}>{REASONS[s.reason] ?? s.reason}</span>{s.reason === 2 && s.fundingPaid ? <span className="muted small"> {s.fundingPaid >= 0 ? "+" : ""}{fmt(s.fundingPaid, 4)}</span> : null}</td>
                        <td className="r">{fmt(s.price)}</td>
                        <td className="r">{s.spotEth.toFixed(4)}</td>
                        <td className="r muted">{dL === 0 ? "–" : (dL > 0 ? "+" : "") + dL.toFixed(4)}</td>
                        <td className="r">{s.shortEth.toFixed(4)}</td>
                        <td className="r muted">{dS === 0 ? "–" : (dS > 0 ? "+" : "") + dS.toFixed(4)}</td>
                        <td className="r">{(s.hedgeBps / 100).toFixed(2)}%</td>
                        <td className="r">{(s.marginBps / 100).toFixed(2)}%</td>
                        <td className="r">{fmt(s.tv)}</td>
                        <td><a href={explorer(s.tx, "tx")} target="_blank" rel="noreferrer">tx</a></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {snaps.length === 0 && <p className="muted">No snapshots yet.</p>}
            </div>
          </div>

          <div className="two">
            <div className="panel">
              <h3>Vault and liquidity</h3>
              <div className="kv"><span>NAV, all series</span><b>${L ? fmt(L.nav) : "–"}</b></div>
              <div className="kv"><span>Price per MDELTA / high-water mark</span><b>{L ? L.pps.toFixed(6) : "–"} / {L ? L.hwm.toFixed(6) : "–"}</b></div>
              <div className="kv"><span>MDELTA supply</span><b>{L ? fmt(L.supply, 4) : "–"}</b></div>
              <div className="kv"><span>Deployed in strategy</span><b>${L ? fmt(L.tv) : "–"} ({L && L.nav ? ((L.tv / L.nav) * 100).toFixed(1) : "–"}%)</b></div>
              <div className="kv"><span>Idle buffer, free / target</span><b className={freeIdle < bufferTarget * 0.5 ? "bad" : ""}>${fmt(freeIdle)} / ${fmt(bufferTarget)}</b></div>
              <div className="kv"><span>Redemption queue / reserved for claims</span><b>${L ? fmt(L.queued) : "–"} / ${L ? fmt(L.reserved) : "–"}</b></div>
              <div className="kv"><span>Performance fees ({L ? L.perfFeeBps / 100 : 19.5}%) / exit fees kept in NAV</span><b>${L ? fmt(L.perfFees) : "–"} / ${L ? fmt(L.exitFees) : "–"}</b></div>
              <div className="kv"><span>Outstanding ERC-8113 series</span><b>{L?.outstanding.length ? L.outstanding.map((x) => `#${x}`).join(", ") : "none"}</b></div>
              <div className="kv"><span>Strategy parameters</span><b>{L?.leverage}×, spot {L ? L.spotBps / 100 : "–"}%, drift ±{L ? L.driftBps / 100 : "–"}%, {L?.fundingHours ?? 0} funding hours</b></div>
            </div>
            <div className="panel">
              <h3>Vault activity</h3>
              <div className="feed">
                {events.slice(0, 60).map((e, i) => (
                  <div key={e.tx + i} className="feed-row">
                    <span className={`tag k-${e.kind.replace(/\s/g, "")}`}>{e.kind}</span>
                    <span className="grow">{e.text}</span>
                    <span className="muted small">{e.t ? ago(e.t, now) : `#${e.block}`}</span>
                    <a href={explorer(e.tx, "tx")} target="_blank" rel="noreferrer">tx</a>
                  </div>
                ))}
                {events.length === 0 && <p className="muted">No vault activity yet.</p>}
              </div>
            </div>
          </div>
        </>
      )}

      <footer className="muted small">
        Internal, not linked from the public site.{" "}
        {deployed && (
          <>
            Vault <a href={explorer(ADDR.vault)} target="_blank" rel="noreferrer">{short(ADDR.vault)}</a>, strategy{" "}
            <a href={explorer(ADDR.strategy)} target="_blank" rel="noreferrer">{short(ADDR.strategy)}</a>.{" "}
          </>
        )}
        Milestone 1: positions are simulated in SimulatedStrategy and driven by real Hyperliquid ETH funding.
      </footer>
    </div>
  );
}

function Header() {
  const corners = [[0, -44], [38.105, 22], [-38.105, 22]];
  return (
    <header className="ops-h">
      <div className="brand">
        <svg width="28" height="28" viewBox="-50 -50 100 100" fill="none" stroke="#fff" aria-hidden>
          <circle r="44" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
          <path d="M0,-44 L38.105,22 L-38.105,22 Z" strokeWidth="1.7" vectorEffect="non-scaling-stroke" />
          <path d="M0,-33 L28.579,16.5 L-28.579,16.5 Z" strokeWidth="0.75" opacity={0.55} vectorEffect="non-scaling-stroke" />
          {corners.map(([x, y]) => <circle key={x} cx={x} cy={y} r="3.2" fill="#fff" stroke="none" />)}
        </svg>
        MidenDelta <span className="muted">Ops</span>
      </div>
      <span className="tagline">Internal, not for investors</span>
    </header>
  );
}

function Fig({ k, v, s, tone }: { k: string; v: string; s?: string; tone?: "bad" }) {
  return (
    <div className="fig">
      <div className="k">{k}</div>
      <div className={`v ${tone ?? ""}`}>{v}</div>
      {s && <div className="s">{s}</div>}
    </div>
  );
}

function Chart({ title, sub, children, wide }: { title: string; sub: string; children: React.ReactElement; wide?: boolean }) {
  return (
    <div className={`panel chart ${wide ? "wide" : ""}`}>
      <h4>{title}</h4>
      <div className="muted small" style={{ marginBottom: 12 }}>{sub}</div>
      <div style={{ height: 240 }}>
        <ResponsiveContainer>{children}</ResponsiveContainer>
      </div>
    </div>
  );
}
