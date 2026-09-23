import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar, Cell, ReferenceLine } from "recharts";
import bt from "./backtest.json";

const daily = bt.daily as { d: string; c: number }[];
const yearTicks = daily.filter((p, i) => i === 0 || p.d.slice(0, 4) !== daily[i - 1].d.slice(0, 4)).map((p) => p.d).slice(1);
const monthly = (bt.monthly as { m: string; apr: number; win: number }[]).filter((m) => /^\d{4}-\d{2}$/.test(m.m));
const yearly = (bt.yearly as { y: string; days: number; gross: number; eff: number; win: number; cum: number | null; mdd: number }[]).filter((y) => /^\d{4}$/.test(y.y));

const KPIS = [
  { v: "14.12", k: "Historical Sharpe ratio", hl: true },
  { v: "14.16%", k: "Gross funding APR" },
  { v: "12.87%", k: "Effective APR (10× perp hedge)" },
  { v: "≈12.24%", k: "Net yield after 5% liquidity buffer" },
  { v: "0.93%", k: "Max. drawdown (whole sample)" },
  { v: "87.3%", k: "Win rate (days with positive carry)" },
  { v: "+47.3%", k: "Cumulative return (non-compounded)" },
  { v: "1,219", k: "Days of Hyperliquid data" },
];

const COMPARE = [
  { n: "MidenDelta", v: 12.24 },
  { n: "DeFi money markets", v: 4.8 },
  { n: "US T-Bills", v: 3.8 },
  { n: "ETH liquid staking", v: 3.4 },
];

const tip = { contentStyle: { borderRadius: 10, border: "1px solid #d5ddec", fontFamily: "Jost", fontSize: 14 } };

export default function Performance() {
  return (
    <section id="performance" style={{ background: "#fff" }}>
      <div className="wrap">
        <div className="sec-head">
          <div className="eyebrow dark">Strategy performance · backtest</div>
          <h2>Funding-rate carry, with near-zero directional risk</h2>
          <p>
            ETH perpetuals trade at a structural premium to spot, driven by demand for leverage. MidenDelta harvests this spread by holding spot ETH
            and an equal perpetual short on Hyperliquid, which does not charge a borrowing fee.
          </p>
        </div>

        <div className="kpi-grid">
          {KPIS.map((k) => (
            <div className="kpi" key={k.k}>
              <div className={`v num ${k.hl ? "hl" : ""}`}>{k.v}</div>
              <div className="k">{k.k}</div>
            </div>
          ))}
        </div>

        <div className="charts">
          <div className="card white chart-card">
            <h4>Cumulative funding return</h4>
            <div className="sub">Hyperliquid ETH short funding, May 2023 – Sep 2026 (%, simple sum)</div>
            <div style={{ height: 280 }}>
              <ResponsiveContainer>
                <AreaChart data={daily} margin={{ left: -12, right: 8, top: 6 }}>
                  <defs>
                    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3347ff" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="#3347ff" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#eef2fa" vertical={false} />
                  <XAxis dataKey="d" ticks={yearTicks} tickFormatter={(d: string) => d.slice(0, 4)} tick={{ fontSize: 12, fill: "#56657f" }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 12, fill: "#56657f" }} axisLine={false} tickLine={false} />
                  <Tooltip {...tip} formatter={(v: number) => [`${v.toFixed(2)}%`, "Cumulative"]} />
                  <Area type="monotone" dataKey="c" stroke="#3347ff" strokeWidth={2} fill="url(#g)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card white chart-card">
            <h4>Yield vs. comparable instruments</h4>
            <div className="sub">APR, %</div>
            <div style={{ height: 280 }}>
              <ResponsiveContainer>
                <BarChart data={COMPARE} layout="vertical" margin={{ left: 40, right: 36 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="n" width={120} tick={{ fontSize: 13, fill: "#0b1b33" }} axisLine={false} tickLine={false} />
                  <Tooltip {...tip} formatter={(v: number) => [`${v}%`, "APR"]} cursor={{ fill: "#eef2fa" }} />
                  <Bar dataKey="v" radius={[0, 6, 6, 0]} barSize={26} label={{ position: "right", fontSize: 13, fill: "#0b1b33", formatter: (v: number) => `${v}%` }}>
                    {COMPARE.map((c, i) => <Cell key={c.n} fill={i === 0 ? "#3347ff" : "#aebbd6"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card white chart-card">
            <h4>Monthly effective APR</h4>
            <div className="sub">After 10× capital efficiency (90.91% deployed), %</div>
            <div style={{ height: 260 }}>
              <ResponsiveContainer>
                <BarChart data={monthly} margin={{ left: -12, right: 8, top: 6 }}>
                  <CartesianGrid stroke="#eef2fa" vertical={false} />
                  <XAxis dataKey="m" tickFormatter={(m: string) => (m.endsWith("-01") ? m.slice(0, 4) : "")} interval={0} tick={{ fontSize: 12, fill: "#56657f" }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 12, fill: "#56657f" }} axisLine={false} tickLine={false} />
                  <ReferenceLine y={0} stroke="#aebbd6" />
                  <Tooltip {...tip} formatter={(v: number) => [`${v.toFixed(2)}%`, "Effective APR"]} cursor={{ fill: "#eef2fa" }} />
                  <Bar dataKey="apr">
                    {monthly.map((m) => <Cell key={m.m} fill={m.apr >= 0 ? "#3347ff" : "#c23a3a"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card white chart-card">
            <h4>By year</h4>
            <div className="sub">Funding compresses as markets mature, so the vault is built to rotate strategies over time</div>
            <table className="table">
              <thead>
                <tr><th>Year</th><th className="r">Gross APR</th><th className="r">Effective</th><th className="r">Win rate</th><th className="r">Max DD</th></tr>
              </thead>
              <tbody>
                {yearly.map((y) => (
                  <tr key={y.y}>
                    <td>{y.y}{y.y === "2023" ? " (from May)" : y.y === "2026" ? " (YTD)" : ""}</td>
                    <td className="r num">{y.gross.toFixed(2)}%</td>
                    <td className="r num">{y.eff.toFixed(2)}%</td>
                    <td className="r num">{y.win.toFixed(1)}%</td>
                    <td className="r num">{y.mdd.toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <p className="footnote">
          Backtest on Hyperliquid ETH funding data (fundingHistory API, 28,668 observations, 12 May 2023 – 11 Sep 2026), based on gross funding rates
          under optimal market conditions. APR = average daily rate × 365, without compounding. Sharpe ratio uses a 4.5% risk-free rate.
          Performance fees, execution costs and basis risk are not included. Past or simulated performance is not a reliable indicator of future results.
        </p>
      </div>
    </section>
  );
}
