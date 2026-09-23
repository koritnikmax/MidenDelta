import { createPublicClient, http, formatUnits, type Address, type Log } from "viem";
import { hyperEvmTestnet, ADDR } from "../wagmi";
import { vaultAbi, strategyAbi, usdcAbi } from "../abi";
import deployments from "../deployments.json";

export const client = createPublicClient({ chain: hyperEvmTestnet, transport: http(undefined, { batch: true, retryCount: 2 }) });
export const KEEPER = deployments.deployer as Address;
const START_BLOCK = BigInt(deployments.block ?? 0);

const n6 = (x: bigint) => Number(formatUnits(x, 6));
const n18 = (x: bigint) => Number(formatUnits(x, 18));

export const REASONS = ["Allocate", "Deallocate", "Funding", "Rebalance", "Mark-to-market"] as const;

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
  marginBps: number;
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
  price: number; spotEth: number; shortEth: number; tv: number; cumFunding: number; lastRate: number; lastFundingAt: number;
  hedgeBps: number; marginBps: number; leverage: number; spotBps: number; driftBps: number; fundingHours: number;
  nav: number; pps: number; hwm: number; idle: number; queued: number; reserved: number; bufferBps: number;
  perfFees: number; exitFees: number; supply: number; outstanding: bigint[]; perfFeeBps: number;
  keeperHype: number; block: number; blockTime: number;
};

export async function readLive(): Promise<Live> {
  const s = { address: ADDR.strategy, abi: strategyAbi } as const;
  const v = { address: ADDR.vault, abi: vaultAbi } as const;
  const r = await client.multicall({
    allowFailure: false,
    contracts: [
      { ...s, functionName: "ethPrice" },
      { ...s, functionName: "spotEth" },
      { ...s, functionName: "perpShortEth" },
      { ...s, functionName: "totalValue" },
      { ...s, functionName: "cumulativeFunding" },
      { ...s, functionName: "lastFundingRate" },
      { ...s, functionName: "lastFundingAt" },
      { ...s, functionName: "hedgeStats" },
      { ...s, functionName: "leverage" },
      { ...s, functionName: "spotBps" },
      { ...s, functionName: "driftThresholdBps" },
      { ...s, functionName: "fundingEvents" },
      { ...v, functionName: "totalAssets" },
      { ...v, functionName: "pricePerShare" },
      { ...v, functionName: "seriesInfo", args: [0n] },
      { address: ADDR.usdc, abi: usdcAbi, functionName: "balanceOf", args: [ADDR.vault] },
      { ...v, functionName: "totalQueued" },
      { ...v, functionName: "reservedClaimable" },
      { ...v, functionName: "bufferBps" },
      { ...v, functionName: "totalFeesCollected" },
      { ...v, functionName: "totalExitFees" },
      { ...v, functionName: "totalSupply" },
      { ...v, functionName: "outstandingSeries" },
      { ...v, functionName: "performanceFeeBps" },
    ] as any,
  }).catch(async () => {
    // RPC without multicall3: fall back to individual calls
    const calls: any[] = [
      [s, "ethPrice"], [s, "spotEth"], [s, "perpShortEth"], [s, "totalValue"], [s, "cumulativeFunding"], [s, "lastFundingRate"],
      [s, "lastFundingAt"], [s, "hedgeStats"], [s, "leverage"], [s, "spotBps"], [s, "driftThresholdBps"], [s, "fundingEvents"],
      [v, "totalAssets"], [v, "pricePerShare"], [v, "seriesInfo", [0n]], [{ address: ADDR.usdc, abi: usdcAbi }, "balanceOf", [ADDR.vault]],
      [v, "totalQueued"], [v, "reservedClaimable"], [v, "bufferBps"], [v, "totalFeesCollected"], [v, "totalExitFees"], [v, "totalSupply"],
      [v, "outstandingSeries"], [v, "performanceFeeBps"],
    ];
    return Promise.all(calls.map(([c, fn, args]) => client.readContract({ ...c, functionName: fn, args } as any)));
  });
  const [bal, blk] = await Promise.all([client.getBalance({ address: KEEPER }), client.getBlock()]);
  const x = r as any[];
  return {
    price: n6(x[0]), spotEth: n18(x[1]), shortEth: n18(x[2]), tv: n6(x[3]), cumFunding: n6(x[4]),
    lastRate: n18(x[5]), lastFundingAt: Number(x[6]), hedgeBps: Number(x[7][0]), marginBps: Number(x[7][1]),
    leverage: Number(x[8]), spotBps: Number(x[9]), driftBps: Number(x[10]), fundingHours: Number(x[11]),
    nav: n6(x[12]), pps: n18(x[13]), hwm: n18(x[14][3]), idle: n6(x[15]), queued: n6(x[16]), reserved: n6(x[17]),
    bufferBps: Number(x[18]), perfFees: n6(x[19]), exitFees: n6(x[20]), supply: n18(x[21]), outstanding: x[22], perfFeeBps: Number(x[23]),
    keeperHype: n18(bal), block: Number(blk.number), blockTime: Number(blk.timestamp),
  };
}

// ------------------------------------------------------------------ event history (chunked + cached)
const CACHE_KEY = `md-ops-logs-v1-${ADDR.strategy}-${ADDR.vault}`;
type Cache = { to: string; logs: any[] };

function loadCache(): Cache | null {
  try {
    const c = localStorage.getItem(CACHE_KEY);
    return c ? (JSON.parse(c) as Cache) : null;
  } catch {
    return null;
  }
}
function saveCache(c: Cache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
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
      const logs = await client.getLogs({ address: [ADDR.strategy, ADDR.vault], fromBlock: cur, toBlock: end });
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
  const from = cache ? BigInt(cache.to) + 1n : START_BLOCK;
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
      if (addr === ADDR.strategy.toLowerCase()) {
        const d = decodeEventLog({ abi: strategyAbi, data: l.data, topics: l.topics }) as any;
        if (d.eventName !== "Snapshot") continue;
        const a = d.args;
        const price = n6(a.ethPrice), spot = n18(a.spotEth), short = n18(a.perpShortEth), tv = n6(a.totalValue);
        snaps.push({
          block: Number(l.blockNumber), tx: l.transactionHash!, t: Number(a.timestamp), reason: Number(a.reason), price, spotEth: spot, shortEth: short, tv,
          cumFunding: n6(a.cumulativeFunding), hedgeBps: Number(a.hedgeRatioBps), marginBps: Number(a.marginBps),
          longUsd: spot * price, shortUsd: short * price, netDeltaEth: spot - short, netDeltaUsd: (spot - short) * price,
          margin: tv - spot * price, fundingPaid: 0,
        });
      } else if (addr === ADDR.vault.toLowerCase()) {
        const d = decodeEventLog({ abi: vaultAbi, data: l.data, topics: l.topics }) as any;
        const a = d.args;
        const base = { block: Number(l.blockNumber), tx: l.transactionHash! };
        const who = (x: string) => `${x.slice(0, 6)}…${x.slice(-4)}`;
        switch (d.eventName) {
          case "Deposit": vaultEvents.push({ ...base, kind: "Mint", amount: n6(a.assets), text: `${who(a.owner)} minted with ${fmt(n6(a.assets))} USDC` }); break;
          case "Withdraw": vaultEvents.push({ ...base, kind: "Redeem", amount: -n6(a.assets), text: `${who(a.owner)} redeemed ${fmt(n6(a.assets))} USDC` }); break;
          case "Rebalanced": vaultEvents.push({ ...base, t: Number(a.timestamp), kind: "Rebalance", text: `Keeper rebalance: deployed ${fmt(n6(a.allocated))} · pulled back ${fmt(n6(a.deallocated))} · idle ${fmt(n6(a.idle))} · NAV ${fmt(n6(a.totalAssets))}` }); break;
          case "PerformanceFee": if (a.feeAssets > 0n) vaultEvents.push({ ...base, kind: "Fee", text: `Performance fee series #${a.seriesId}: ${fmt(n6(a.feeAssets))} USDC` }); break;
          case "ExitFee": vaultEvents.push({ ...base, kind: "Exit fee", text: `Exit fee ${fmt(n6(a.fee))} USDC (${(Number(a.feeBps) / 100).toFixed(2)}%) on ${fmt(n6(a.gross))}` }); break;
          case "RedeemQueued": vaultEvents.push({ ...base, kind: "Queue", text: `Request #${a.requestId} queued: ${fmt(n6(a.amount))} USDC` }); break;
          case "QueueProcessed": vaultEvents.push({ ...base, kind: "Queue", text: `Queue filled ${fmt(n6(a.filled))} USDC (${(Number(formatUnits(a.fillRatioWad, 16))).toFixed(1)}%), remaining ${fmt(n6(a.remaining))}` }); break;
          case "SeriesCreated": vaultEvents.push({ ...base, kind: "Series", text: `Series #${a.seriesId} opened at PPS ${n18(a.pps).toFixed(6)}` }); break;
          case "SeriesConsolidated": vaultEvents.push({ ...base, kind: "Series", text: `Series #${a.seriesId} consolidated into MDELTA (${fmt(n6(a.assets))} USDC)` }); break;
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
