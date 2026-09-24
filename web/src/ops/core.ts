// Live HyperCore data for the ops dashboard, straight from Hyperliquid's public info API.
// Market data comes from mainnet (the strategy's funding source); the keeper account lives on testnet.
import { type Address } from "viem";
import { client } from "./data";

const MAINNET = "https://api.hyperliquid.xyz/info";
const TESTNET = "https://api.hyperliquid-testnet.xyz/info";
const COIN = "ETH";

async function info<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Hyperliquid info ${body.type}: HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

export type Venue = { venue: string; rate: number; intervalHours: number; next: number };
export type Market = {
  mark: number; oracle: number; mid: number; prevDay: number;
  funding: number; // current hourly rate (fraction)
  premium: number;
  openInterest: number; // ETH
  dayVolume: number; // USD
  maxLeverage: number;
  venues: Venue[]; // predicted next funding per venue, normalised to hourly
};

export async function readMarket(): Promise<Market> {
  const [[meta, ctxs], predicted] = await Promise.all([
    info<[{ universe: { name: string; maxLeverage: number }[] }, Record<string, string>[]]>(MAINNET, { type: "metaAndAssetCtxs" }),
    info<[string, [string, { fundingRate: string; nextFundingTime: number; fundingIntervalHours?: number }][]][]>(MAINNET, { type: "predictedFundings" }).catch(() => []),
  ]);
  const i = meta.universe.findIndex((u) => u.name === COIN);
  const c = ctxs[i];
  const venues = (predicted.find(([coin]) => coin === COIN)?.[1] ?? []).map(([venue, v]) => {
    const h = v.fundingIntervalHours ?? 8;
    return { venue: venue.replace(/Perp$/, ""), rate: Number(v.fundingRate) / h, intervalHours: h, next: v.nextFundingTime };
  });
  return {
    mark: +c.markPx, oracle: +c.oraclePx, mid: +c.midPx, prevDay: +c.prevDayPx, funding: +c.funding, premium: +c.premium,
    openInterest: +c.openInterest, dayVolume: +c.dayNtlVlm, maxLeverage: meta.universe[i].maxLeverage, venues,
  };
}

export type FundingPoint = { t: number; rate: number; apr: number };

/** Hourly ETH funding over the last `days` days (the API returns at most 500 rows per call, so page forward). */
export async function readFunding(days = 7): Promise<FundingPoint[]> {
  const end = Date.now();
  let start = end - days * 86_400_000;
  const out: FundingPoint[] = [];
  for (let page = 0; page < 10 && start < end; page++) {
    const rows = await info<{ fundingRate: string; time: number }[]>(MAINNET, { type: "fundingHistory", coin: COIN, startTime: start });
    if (!rows.length) break;
    for (const r of rows) out.push({ t: Math.floor(r.time / 1000), rate: +r.fundingRate, apr: +r.fundingRate * 8760 * 100 });
    start = rows[rows.length - 1].time + 1;
    if (rows.length < 500) break;
  }
  return out;
}

export type CoreAccount = {
  role: string; // "missing" until the address has received funds on HyperCore
  accountValue: number; withdrawable: number; perpPositions: number;
  spot: { coin: string; total: number }[];
  evmHype: number; // gas balance on HyperEVM
};

export async function readCoreAccount(user: Address): Promise<CoreAccount> {
  const [role, perp, spot, evm] = await Promise.all([
    info<{ role: string }>(TESTNET, { type: "userRole", user }),
    info<{ marginSummary: { accountValue: string }; withdrawable: string; assetPositions: unknown[] }>(TESTNET, { type: "clearinghouseState", user }),
    info<{ balances: { coin: string; total: string }[] }>(TESTNET, { type: "spotClearinghouseState", user }),
    client.getBalance({ address: user }),
  ]);
  return {
    role: role.role,
    accountValue: +perp.marginSummary.accountValue,
    withdrawable: +perp.withdrawable,
    perpPositions: perp.assetPositions.length,
    spot: spot.balances.map((b) => ({ coin: b.coin, total: +b.total })).filter((b) => b.total > 0),
    evmHype: Number(evm) / 1e18,
  };
}
