import { useEffect, useMemo, useState, useCallback } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceArea, ReferenceLine, ComposedChart, Bar, Legend,
} from "recharts";
import { readLive, loadHistory, fmt, REASONS, KEEPER, type Live, type Snap, type VaultEvt } from "./data";
import { ADDR, explorer } from "../wagmi";

const REFRESH_MS = 15_000;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const ago = (t: number, now: number) => {
  const s = Math.max(0, now - t);
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172800) return `${(s / 3600).toFixed(1)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};
const tfmt = (t: number) => new Date(t * 1000).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const NOT_DEPLOYED = /^0x0+$/.test(ADDR.vault);

const C = { long: "#3ddc84", short: "#ff6b6b", net: "#8fb0ff", price: "#e8c46b", funding: "#6b8cff", grid: "#1f2e4a", axis: "#7f90b0" };
const tip = { contentStyle: { background: "#0b1b33", border: "1px solid #2a3d61", borderRadius: 10, fontFamily: "Jost", fontSize: 13, color: "#e6ecf7" }, labelFormatter: (t: number) => tfmt(t) };
const axis = { tick: { fontSize: 11, fill: C.axis }, axisLine: false, tickLine: false } as const;

function Pill({ tone, children }: { tone: "ok" | "warn" | "bad" | "info"; children: React.ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

export default function OpsApp() {
  const [live, setLive] = useState<Live | null>(null);
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [events, setEvents] = useState<VaultEvt[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [updated, setUpdated] = useState<number>(0);
  const [range, setRange] = useState<"24h" | "7d" | "30d" | "all">("7d");

  const refresh = useCallback(async () => {
    if (NOT_DEPLOYED) return;
    try {
      const [l, h] = await Promise.all([readLive(), loadHistory((p) => setProgress(p < 100 ? p : null))]);
      setLive(l);
      setSnaps(h.snaps);
      setEvents(h.vaultEvents);
      setErr(null);
      setUpdated(Math.floor(Date.now() / 1000));
    } catch (e: any) {
      setErr(e?.shortMessage ?? e?.message ?? String(e));
    } finally {
      setProgress(null);
    }
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

  if (NOT_DEPLOYED)
    return (
      <div className="ops wrap">
        <Header />
        <div className="panel"><h3>Waiting for deployment</h3><p className="muted">The contracts are not deployed yet. After deployment this dashboard is rebuilt with the contract addresses and shows the live positions.</p></div>
      </div>
    );

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

  return (
    <div className="ops wrap">
      <Header />

      {/* ------------ status strip ------------ */}
      <div className="status">
        <Pill tone={staleSec < 7200 ? "ok" : staleSec < 21600 ? "warn" : "bad"}>
          Keeper: {L?.lastFundingAt ? `last funding ${ago(L.lastFundingAt, now)}` : "never ran"}
        </Pill>
        <Pill tone={(L?.keeperHype ?? 0) > 0.05 ? "ok" : "bad"}>Keeper gas: {L ? L.keeperHype.toFixed(4) : "–"} HYPE</Pill>
        <Pill tone={hedgeOk ? "ok" : "bad"}>Hedge {L ? (L.hedgeBps / 100).toFixed(2) : "–"}%</Pill>
        <Pill tone={marginOk ? "ok" : "warn"}>Margin {L ? (L.marginBps / 100).toFixed(2) : "–"}%</Pill>
        <Pill tone={L && L.queued > 0 ? "warn" : "ok"}>Queue {L ? fmt(L.queued) : "–"} USDC</Pill>
        <span className="muted small" style={{ marginLeft: "auto" }}>
          {progress !== null ? `Loading history… ${progress}%` : updated ? `Block ${L?.block.toLocaleString()} · refreshed ${ago(updated, Math.floor(Date.now() / 1000))} · auto every 15s` : "Loading…"}
          <button className="mini" onClick={refresh}>Refresh</button>
        </span>
      </div>
      {err && <div className="alert">RPC error: {err}</div>}

      {/* ------------ legs ------------ */}
      <div className="legs">
        <div className="panel leg long">
          <div className="leg-h"><span className="dot" style={{ background: C.long }} />LONG LEG · Spot ETH</div>
          <div className="big">{L ? L.spotEth.toFixed(4) : "–"} <small>ETH</small></div>
          <div className="kv"><span>Market value</span><b>${fmt(longUsd)}</b></div>
          <div className="kv"><span>Share of strategy</span><b>{L && L.tv ? ((longUsd / L.tv) * 100).toFixed(2) : "–"}% <em>target {L ? (L.spotBps / 100).toFixed(2) : "–"}%</em></b></div>
          <div className="kv"><span>ETH mark price</span><b>${L ? fmt(L.price) : "–"}</b></div>
        </div>

        <div className="panel leg shortleg">
          <div className="leg-h"><span className="dot" style={{ background: C.short }} />SHORT LEG · ETH perp ({L?.leverage ?? 10}× target)</div>
          <div className="big">−{L ? L.shortEth.toFixed(4) : "–"} <small>ETH</small></div>
          <div className="kv"><span>Notional</span><b>${fmt(shortUsd)}</b></div>
          <div className="kv"><span>Margin equity (incl. unrealised PnL)</span><b>${fmt(margin)}</b></div>
          <div className="kv"><span>Effective leverage</span><b className={effLev > (L?.leverage ?? 10) * 1.3 ? "bad" : ""}>{effLev.toFixed(2)}×</b></div>
          <div className="kv"><span>Margin wiped if ETH rises</span><b className={liqDist < 5 ? "bad" : liqDist < 8 ? "warn" : ""}>+{liqDist.toFixed(2)}% → ${fmt(liqPrice)}</b></div>
        </div>

        <div className="panel leg net">
          <div className="leg-h"><span className="dot" style={{ background: C.net }} />NET POSITION</div>
          <div className="big">{netEth >= 0 ? "+" : ""}{netEth.toFixed(4)} <small>ETH delta</small></div>
          <div className="kv"><span>Net delta (USD)</span><b className={Math.abs(netEth * (L?.price ?? 0)) > (L?.tv ?? 0) * 0.02 ? "warn" : ""}>{netEth >= 0 ? "+" : "−"}${fmt(Math.abs(netEth * (L?.price ?? 0)))}</b></div>
          <div className="kv"><span>Hedge ratio (short / long)</span><b className={hedgeOk ? "" : "bad"}>{L ? (L.hedgeBps / 100).toFixed(2) : "–"}% <em>band ±{L ? (L.driftBps / 100).toFixed(1) : "–"}%</em></b></div>
          <div className="kv"><span>Strategy value</span><b>${L ? fmt(L.tv) : "–"}</b></div>
          <div className="kv"><span>Funding earned (cumulative)</span><b className="good">+${L ? fmt(L.cumFunding) : "–"}</b></div>
          <div className="kv"><span>Last funding rate</span><b>{L ? (L.lastRate * 100).toFixed(5) : "–"}%/h · {annualised.toFixed(2)}% APR</b></div>
        </div>
      </div>

      {/* ------------ charts ------------ */}
      <div className="range">
        {(["24h", "7d", "30d", "all"] as const).map((r) => (
          <button key={r} className={r === range ? "on" : ""} onClick={() => setRange(r)}>{r}</button>
        ))}
        <span className="muted small">{view.length} snapshots · {rebalances.length} rebalances total</span>
      </div>

      {view.length === 0 ? (
        <div className="panel"><p className="muted">No position history in this range yet. The first snapshot appears when the keeper deploys capital, which happens after the first mint and rebalance.</p></div>
      ) : (
        <div className="charts">
          <Chart title="Long vs short notional" sub="USD. Green = long, red dashed = short; they overlap when perfectly hedged. Yellow markers = rebalances">
            <LineChart data={view}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={tfmt} {...axis} minTickGap={50} />
              <YAxis {...axis} tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`} width={56} />
              <Tooltip {...tip} formatter={(v: number, n) => [`$${fmt(v)}`, n]} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {rebalances.filter((r) => view.includes(r)).map((r) => <ReferenceLine key={r.block + "r"} x={r.t} stroke="#e8c46b" strokeDasharray="3 3" />)}
              <Line isAnimationActive={false} type="stepAfter" dataKey="longUsd" name="Long (spot)" stroke={C.long} dot={false} strokeWidth={4} strokeOpacity={0.7} />
              <Line isAnimationActive={false} type="stepAfter" dataKey="shortUsd" name="Short (perp)" stroke={C.short} dot={false} strokeWidth={1.5} strokeDasharray="5 3" />
            </LineChart>
          </Chart>

          <Chart title="Hedge ratio" sub={`Short ÷ long, %. Rebalance band ${L ? 100 - L.driftBps / 100 : 98}–${L ? 100 + L.driftBps / 100 : 102}%`}>
            <LineChart data={view.map((s) => ({ ...s, hr: s.hedgeBps / 100 }))}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={tfmt} {...axis} minTickGap={50} />
              <YAxis {...axis} domain={["auto", "auto"]} tickFormatter={(v) => `${v}%`} width={50} />
              <ReferenceArea y1={L ? 100 - L.driftBps / 100 : 98} y2={L ? 100 + L.driftBps / 100 : 102} fill="#3ddc84" fillOpacity={0.08} />
              <ReferenceLine y={100} stroke="#3ddc84" strokeOpacity={0.5} />
              <Tooltip {...tip} formatter={(v: number) => [`${v.toFixed(2)}%`, "Hedge ratio"]} />
              <Line isAnimationActive={false} type="stepAfter" dataKey="hr" stroke={C.net} dot={false} strokeWidth={2} />
            </LineChart>
          </Chart>

          <Chart title="Short-leg margin" sub={`Margin equity as % of strategy. Target ${(targetMargin / 100).toFixed(2)}%, rebalance outside ${((targetMargin * 2) / 3 / 100).toFixed(1)}–${((targetMargin * 3) / 2 / 100).toFixed(1)}%`}>
            <LineChart data={view.map((s) => ({ ...s, mg: s.marginBps / 100 }))}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={tfmt} {...axis} minTickGap={50} />
              <YAxis {...axis} domain={[0, "auto"]} tickFormatter={(v) => `${v}%`} width={44} />
              <ReferenceArea y1={(targetMargin * 2) / 3 / 100} y2={(targetMargin * 3) / 2 / 100} fill="#3ddc84" fillOpacity={0.08} />
              <ReferenceLine y={targetMargin / 100} stroke="#3ddc84" strokeOpacity={0.5} />
              <Tooltip {...tip} formatter={(v: number) => [`${v.toFixed(2)}%`, "Margin"]} />
              <Line isAnimationActive={false} type="stepAfter" dataKey="mg" stroke={C.short} dot={false} strokeWidth={2} />
            </LineChart>
          </Chart>

          <Chart title="Net delta & ETH price" sub="Net ETH exposure (should stay near 0) against the ETH mark price">
            <ComposedChart data={view}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={tfmt} {...axis} minTickGap={50} />
              <YAxis yAxisId="d" {...axis} width={56} tickFormatter={(v) => `${v.toFixed(4)}`} />
              <YAxis yAxisId="p" orientation="right" {...axis} width={56} tickFormatter={(v) => `$${Math.round(v)}`} domain={["auto", "auto"]} />
              <ReferenceLine yAxisId="d" y={0} stroke="#7f90b0" />
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
              <Bar isAnimationActive={false} yAxisId="a" dataKey="fundingPaid" name="Per update" fill={C.funding} />
              <Line isAnimationActive={false} yAxisId="b" type="monotone" dataKey="cumFunding" name="Cumulative" stroke={C.long} dot={false} strokeWidth={2} />
            </ComposedChart>
          </Chart>
        </div>
      )}

      {/* ------------ rebalance / position log ------------ */}
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
                    <td className={`r ${dL > 0 ? "good" : dL < 0 ? "bad" : "muted"}`}>{dL === 0 ? "·" : (dL > 0 ? "+" : "") + dL.toFixed(4)}</td>
                    <td className="r">{s.shortEth.toFixed(4)}</td>
                    <td className={`r ${dS > 0 ? "good" : dS < 0 ? "bad" : "muted"}`}>{dS === 0 ? "·" : (dS > 0 ? "+" : "") + dS.toFixed(4)}</td>
                    <td className="r">{(s.hedgeBps / 100).toFixed(2)}%</td>
                    <td className="r">{(s.marginBps / 100).toFixed(2)}%</td>
                    <td className="r">{fmt(s.tv)}</td>
                    <td><a href={explorer(s.tx, "tx")} target="_blank" rel="noreferrer">tx ↗</a></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {snaps.length === 0 && <p className="muted">No snapshots yet.</p>}
        </div>
      </div>

      {/* ------------ vault + activity ------------ */}
      <div className="two">
        <div className="panel">
          <h3>Vault & liquidity</h3>
          <div className="kv"><span>NAV (all series)</span><b>${L ? fmt(L.nav) : "–"}</b></div>
          <div className="kv"><span>Price per MDELTA / high-water mark</span><b>{L ? L.pps.toFixed(6) : "–"} / {L ? L.hwm.toFixed(6) : "–"}</b></div>
          <div className="kv"><span>MDELTA supply</span><b>{L ? fmt(L.supply, 4) : "–"}</b></div>
          <div className="kv"><span>Deployed in strategy</span><b>${L ? fmt(L.tv) : "–"} ({L && L.nav ? ((L.tv / L.nav) * 100).toFixed(1) : "–"}%)</b></div>
          <div className="kv"><span>Idle buffer (free / target)</span><b className={freeIdle < bufferTarget * 0.5 ? "warn" : ""}>${fmt(freeIdle)} / ${fmt(bufferTarget)}</b></div>
          <div className="kv"><span>Redemption queue / reserved for claims</span><b>${L ? fmt(L.queued) : "–"} / ${L ? fmt(L.reserved) : "–"}</b></div>
          <div className="kv"><span>Performance fees ({L ? L.perfFeeBps / 100 : 19.5}%) / exit fees kept in NAV</span><b>${L ? fmt(L.perfFees) : "–"} / ${L ? fmt(L.exitFees) : "–"}</b></div>
          <div className="kv"><span>Outstanding ERC-8113 series</span><b>{L?.outstanding.length ? L.outstanding.map((x) => `#${x}`).join(", ") : "none"}</b></div>
          <div className="kv"><span>Strategy params</span><b>{L?.leverage}× · spot {L ? L.spotBps / 100 : "–"}% · drift ±{L ? L.driftBps / 100 : "–"}% · {L?.fundingHours ?? 0} funding hours</b></div>
        </div>
        <div className="panel">
          <h3>Vault activity</h3>
          <div className="feed">
            {events.slice(0, 60).map((e, i) => (
              <div key={e.tx + i} className="feed-row">
                <span className={`tag k-${e.kind.replace(/\s/g, "")}`}>{e.kind}</span>
                <span className="grow">{e.text}</span>
                <span className="muted small">{e.t ? ago(e.t, now) : `#${e.block}`}</span>
                <a href={explorer(e.tx, "tx")} target="_blank" rel="noreferrer">↗</a>
              </div>
            ))}
            {events.length === 0 && <p className="muted">No vault activity yet.</p>}
          </div>
        </div>
      </div>

      <footer className="muted small">
        Internal · not linked from the public site · Vault <a href={explorer(ADDR.vault)} target="_blank" rel="noreferrer">{short(ADDR.vault)}</a> · Strategy{" "}
        <a href={explorer(ADDR.strategy)} target="_blank" rel="noreferrer">{short(ADDR.strategy)}</a> · Keeper <a href={explorer(KEEPER)} target="_blank" rel="noreferrer">{short(KEEPER)}</a> ·
        Milestone 1: positions are simulated in SimulatedStrategy and driven by real Hyperliquid ETH funding.
      </footer>
    </div>
  );
}

function Header() {
  return (
    <header className="ops-h">
      <div className="brand">
        <svg width="26" height="26" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#b86e00" /><path d="M16 7 L25 24 H7 Z" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinejoin="round" /></svg>
        MidenDelta <span className="muted">Ops</span>
      </div>
      <Pill tone="warn">INTERNAL · not for investors</Pill>
      <Pill tone="info">HyperEVM testnet</Pill>
    </header>
  );
}

function Chart({ title, sub, children, wide }: { title: string; sub: string; children: React.ReactElement; wide?: boolean }) {
  return (
    <div className={`panel chart ${wide ? "wide" : ""}`}>
      <h4>{title}</h4>
      <div className="muted small" style={{ marginBottom: 10 }}>{sub}</div>
      <div style={{ height: 240 }}>
        <ResponsiveContainer>{children}</ResponsiveContainer>
      </div>
    </div>
  );
}
