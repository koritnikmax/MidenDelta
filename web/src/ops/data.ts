import { createPublicClient, http, formatUnits, type Address, type Log } from "viem";
import { hyperEvmTestnet, ADDR, ETH_MARKET } from "../wagmi";
import { vaultAbi, strategyAbi, adapterAbi, oracleAbi, tokenAbi } from "../abi";
import deployments from "../deployments.json";

export const client = createPublicClient({ chain: hyperEvmTestnet, transport: http(undefined, { batch: true, retryCount: 2 }) });
/** Live deployment info. Compiled-in first; replaced from GitHub if newer (see resolveDeployments). */
export const DEP = { ...deployments } as Record<string, any> & { vault: string; deployer: string; block: number };
export let KEEPER = DEP.deployer as Address;
const REMOTE = "https://raw.githubusercontent.com/koritnikmax/MidenDelta/main/web/src/deployments.json";
export const isDeployed = () => !/^0x0+$/.test(ADDR.vault);

/** Pull the latest contract addresses from the GitHub repo so this file never needs re-downloading. */
export async function resolveDeployments() {
  try {
    const r = await fetch(`${REMOTE}?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return;
    const d = await r.json();
    if (!d?.vault || /^0x0+$/.test(d.vault)) return;
    Object.assign(DEP, d);
    for (const k of Object.keys(ADDR)) if (d[k]) (ADDR as any)[k] = d[k];
    KEEPER = d.deployer;
  } catch {
    /* offline: keep compiled-in addresses */
  }
}

const n6 = (x: bigint) => Number(formatUnits(x, 6));
const n18 = (x: bigint) => Number(formatUnits(x, 18));

export const REASONS = ["Open", "Unwind", "Funding", "Rebalance", "Mark", "Margin top-up"] as const;

export type Snap = {
  block: number;
  tx: string;
  t: number; // unix sec
  reason: number;
  price: number;
  spotEth: number;
  shortEth: number;
  tv: number; // strategy value USDC
  cumFunding: number;
  hedgeBps: number;
  marginBps: number; // margin equity / short notional
  // derived
  longUsd: number;
  shortUsd: number;
  netDeltaEth: number;
  netDeltaUsd: number;
  margin: number; // short-leg equity (USDC)
  fundingPaid: number; // delta vs previous snapshot
};

export type VaultEvt = { block: number; tx: string; t?: number; kind: string; text: string; amount?: number };

export type Live = {
  // venue (simulated Hyperliquid adapter)
  price: number; spotEth: number; shortEth: number; venueValue: number; cumFunding: number; lastRate: number; lastFundingAt: number;
  hedgeBps: number; marginRatioBps: number; leverageBps: number; fundingHours: number;
  // strategy manager limits
  strategyValue: number; targetLeverageBps: number; maxLeverageBps: number; bandBps: number; minMarginBps: number; bufferBps: number;
  strategyPaused: boolean;
  // vault and dealing
  fundAssets: number; freeCash: number; pendingDeposits: number; reserved: number; queuedUnits: number; levies: number;
  epoch: number; lastSettled: number; epochOpenedAt: number; epochDuration: number; vaultPaused: boolean;
  // official NAV and units
  navUsd: number; navEur: number; navEpoch: number; supply: number;
  keeperHype: number; block: number; blockTime: number;
};

export async function readLive(): Promise<Live> {
  const a = { address: ADDR.adapter, abi: adapterAbi } as const;
  const s = { address: ADDR.strategy, abi: strategyAbi } as const;
  const v = { address: ADDR.vault, abi: vaultAbi } as const;
  const o = { address: ADDR.oracle, abi: oracleAbi } as const;
  const calls: [any, string, unknown[]?][] = [
    [a, "ethPrice"], [a, "spotEth"], [a, "perpShortEth"], [a, "totalValue"], [a, "cumulativeFunding"], [a, "lastFundingRate"],
    [a, "lastFundingAt"], [a, "hedgeStats"], [a, "getLeverage", [ETH_MARKET]], [a, "fundingHours"],
    [s, "totalValue"], [s, "targetLeverageBps"], [s, "maxPerpLeverageBps"], [s, "hedgeBandBps"], [s, "minMarginRatioBps"], [s, "liquidityBufferBps"], [s, "paused"],
    [v, "totalAssets"], [v, "freeCash"], [v, "pendingDepositAssets"], [v, "reservedAssets"], [v, "queuedShares"], [v, "totalLevies"],
    [v, "currentEpoch"], [v, "lastSettledEpoch"], [v, "epochOpenedAt"], [v, "epochDuration"], [v, "paused"],
    [o, "navPerUnitUSD"], [o, "navPerUnitEUR"], [o, "latestEpoch"], [{ address: ADDR.token, abi: tokenAbi }, "totalSupply"],
  ];
  const x = (await Promise.all(calls.map(([c, fn, args]) => client.readContract({ ...c, functionName: fn, args } as any)))) as any[];
  const [bal, blk] = await Promise.all([client.getBalance({ address: KEEPER }), client.getBlock()]);
  const lev = x[8] as bigint;
  return {
    price: n6(x[0]), spotEth: n18(x[1]), shortEth: n18(x[2]), venueValue: n6(x[3]), cumFunding: n6(x[4]), lastRate: n18(x[5]),
    lastFundingAt: Number(x[6]), hedgeBps: Number(x[7][0]), marginRatioBps: Number(x[7][1]),
    leverageBps: lev > 10n ** 12n ? Infinity : Number(lev), fundingHours: Number(x[9]),
    strategyValue: n6(x[10]), targetLeverageBps: Number(x[11]), maxLeverageBps: Number(x[12]), bandBps: Number(x[13]), minMarginBps: Number(x[14]),
    bufferBps: Number(x[15]), strategyPaused: x[16],
    fundAssets: n6(x[17]), freeCash: n6(x[18]), pendingDeposits: n6(x[19]), reserved: n6(x[20]), queuedUnits: n18(x[21]), levies: n6(x[22]),
    epoch: Number(x[23]), lastSettled: Number(x[24]), epochOpenedAt: Number(x[25]), epochDuration: Number(x[26]), vaultPaused: x[27],
    navUsd: n6(x[28]), navEur: n6(x[29]), navEpoch: Number(x[30]), supply: n18(x[31]),
    keeperHype: n18(bal), block: Number(blk.number), blockTime: Number(blk.timestamp),
  };
}

// ------------------------------------------------------------------ event history (chunked + cached)
const cacheKey = () => `md-ops-logs-v2-${ADDR.adapter}-${ADDR.vault}`;
type Cache = { to: string; logs: any[] };

function loadCache(): Cache | null {
  try {
    const c = localStorage.getItem(cacheKey());
    return c ? (JSON.parse(c) as Cache) : null;
  } catch {
    return null;
  }
}
function saveCache(c: Cache) {
  try {
    localStorage.setItem(cacheKey(), JSON.stringify(c));
  } catch {
    /* storage full / blocked: fine, we just refetch */
  }
}

const ser = (l: Log) => JSON.parse(JSON.stringify(l, (_k, v) => (typeof v === "bigint" ? `${v}n` : v)));
const deser = (l: any) => JSON.parse(JSON.stringify(l), (_k, v) => (typeof v === "string" && /^-?\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v));

let chunk = 20_000n;
async function getLogsRange(from: bigint, to: bigint, onProgress?: (p: number) => void) {
  const out: Log[] = [];
  let cur = from;
  while (cur <= to) {
    const end = cur + chunk - 1n > to ? to : cur + chunk - 1n;
    try {
      const logs = await client.getLogs({ address: [ADDR.adapter, ADDR.vault, ADDR.strategy], fromBlock: cur, toBlock: end });
      out.push(...logs);
      cur = end + 1n;
      onProgress?.(Number(((cur - from) * 100n) / (to - from + 1n)));
    } catch (e) {
      if (chunk <= 500n) throw e;
      chunk = chunk / 2n; // RPC range limit: shrink and retry
    }
  }
  return out;
}

export async function loadHistory(onProgress?: (p: number) => void): Promise<{ snaps: Snap[]; vaultEvents: VaultEvt[] }> {
  const latest = await client.getBlockNumber();
  const cache = loadCache();
  const from = cache ? BigInt(cache.to) + 1n : BigInt(DEP.block ?? 0);
  const fresh = from <= latest ? await getLogsRange(from, latest, onProgress) : [];
  const raw = [...(cache?.logs.map(deser) ?? []), ...fresh.map(ser).map(deser)];
  saveCache({ to: latest.toString(), logs: raw.map(ser) });
  return decode(raw as Log[]);
}

async function decode(raw: Log[]) {
  const { decodeEventLog } = await import("viem");
  const snaps: Snap[] = [];
  const vaultEvents: VaultEvt[] = [];
  for (const l of raw) {
    const addr = l.address.toLowerCase();
    try {
      if (addr === ADDR.adapter.toLowerCase()) {
        const d = decodeEventLog({ abi: adapterAbi, data: l.data, topics: l.topics }) as any;
        if (d.eventName !== "Snapshot") continue;
        const a = d.args;
        const price = n6(a.ethPrice), spot = n18(a.spotEth), short = n18(a.perpShortEth), tv = n6(a.totalValue);
        snaps.push({
          block: Number(l.blockNumber), tx: l.transactionHash!, t: Number(a.timestamp), reason: Number(a.reason), price, spotEth: spot, shortEth: short, tv,
          cumFunding: n6(a.cumulativeFunding), hedgeBps: Number(a.hedgeRatioBps), marginBps: Number(a.marginRatioBps),
          longUsd: spot * price, shortUsd: short * price, netDeltaEth: spot - short, netDeltaUsd: (spot - short) * price,
          margin: tv - spot * price, fundingPaid: 0,
        });
      } else if (addr === ADDR.strategy.toLowerCase()) {
        const d = decodeEventLog({ abi: strategyAbi, data: l.data, topics: l.topics }) as any;
        const base = { block: Number(l.blockNumber), tx: l.transactionHash! };
        if (d.eventName === "BreakerTripped") vaultEvents.push({ ...base, kind: "Breaker", text: `Circuit breaker tripped: ${d.args.reason}` });
        if (d.eventName === "TargetLeverageSet") vaultEvents.push({ ...base, kind: "Leverage", text: `Target leverage set to ${(Number(d.args.bps) / 1e4).toFixed(2)}x` });
        if (d.eventName === "MarginToppedUp") vaultEvents.push({ ...base, kind: "Margin", text: `Margin topped up by ${fmt(n6(d.args.amount))} USDC` });
      } else if (addr === ADDR.vault.toLowerCase()) {
        const d = decodeEventLog({ abi: vaultAbi, data: l.data, topics: l.topics }) as any;
        const a = d.args;
        const base = { block: Number(l.blockNumber), tx: l.transactionHash! };
        const who = (x: string) => `${x.slice(0, 6)}…${x.slice(-4)}`;
        switch (d.eventName) {
          case "DepositRequest": vaultEvents.push({ ...base, kind: "Subscribe", amount: n6(a.assets), text: `${who(a.controller)} requested a subscription of ${fmt(n6(a.assets))} USDC (epoch ${a.requestId})` }); break;
          case "RedeemRequest": vaultEvents.push({ ...base, kind: "Redeem", text: `${who(a.controller)} requested a redemption of ${fmt(n18(a.shares), 4)} units (epoch ${a.requestId})` }); break;
          case "Deposit": vaultEvents.push({ ...base, kind: "Claim", text: `${who(a.owner)} claimed ${fmt(n18(a.shares), 4)} units` }); break;
          case "Withdraw": vaultEvents.push({ ...base, kind: "Claim", amount: -n6(a.assets), text: `${who(a.owner)} claimed ${fmt(n6(a.assets))} USDC` }); break;
          case "EpochClosed": vaultEvents.push({ ...base, kind: "Epoch", text: `Epoch ${a.epoch} closed: ${fmt(n6(a.depositAssets))} USDC in, ${fmt(n18(a.redeemShares), 4)} units out` }); break;
          case "EpochSettled": vaultEvents.push({ ...base, kind: "Epoch", text: `Epoch ${a.epoch} settled at NAV ${n6(a.navUsd).toFixed(4)}: ${fmt(n18(a.sharesMinted), 2)} units minted, ${fmt(n18(a.sharesRedeemed), 2)} redeemed, fill ${(Number(formatUnits(a.fillWad, 16))).toFixed(1)}%, levy ${(Number(a.levyBps) / 100).toFixed(2)}%` }); break;
          case "StrategyFlow": vaultEvents.push({ ...base, kind: a.toStrategy ? "Deploy" : "Recall", text: `${a.toStrategy ? "Deployed" : "Recalled"} ${fmt(n6(a.moved))} USDC ${a.toStrategy ? "to" : "from"} the strategy` }); break;
          case "EarlyRedemptionFee": vaultEvents.push({ ...base, kind: "Fee", text: `Early-redemption fee: ${fmt(n18(a.shares), 4)} units (${(Number(a.feeBps) / 100).toFixed(2)}%)` }); break;
        }
      }
    } catch {
      /* unknown event */
    }
  }
  snaps.sort((a, b) => a.block - b.block);
  for (let i = 1; i < snaps.length; i++) snaps[i].fundingPaid = snaps[i].cumFunding - snaps[i - 1].cumFunding;
  // approximate timestamps for vault events from nearest snapshot / rebalance
  const anchors = [...snaps.map((s) => ({ b: s.block, t: s.t })), ...vaultEvents.filter((e) => e.t).map((e) => ({ b: e.block, t: e.t! }))].sort((a, b) => a.b - b.b);
  for (const e of vaultEvents) {
    if (e.t || !anchors.length) continue;
    const near = anchors.reduce((p, c) => (Math.abs(c.b - e.block) < Math.abs(p.b - e.block) ? c : p));
    e.t = near.t + (e.block - near.b); // ~1 block per second on HyperEVM small blocks
  }
  vaultEvents.sort((a, b) => b.block - a.block);
  return { snaps, vaultEvents };
}

export const fmt = (x: number, dp = 2) => x.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
