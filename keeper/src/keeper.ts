/**
 * MidenDelta keeper bot (Milestone 1: simulated strategy)
 *
 * Every interval:
 *   1. reinvestFunding(): pull the REAL realised hourly ETH funding rates from Hyperliquid mainnet for
 *      every hour since the last update and credit them to the simulated short (compounded).
 *   2. adjustPosition() runs inside reinvestFunding when the hedge drifts past the threshold.
 *   3. vault.rebalance(): accrue NAV + performance fees (ERC-8113 series), keep the 5% buffer,
 *      deploy the rest, pull liquidity for the redemption queue and fill it pro-rata.
 *
 * Flags:
 *   --once                 run a single cycle and exit
 *   --interval <sec>       loop interval (default 3600)
 *   --demo-hours <n>       time-compression for demos: apply the average of the last n real hours as n hours
 */
import { parseUnits, formatUnits } from "viem";
import { publicClient, walletClient, account, deployments, HL_MAINNET_INFO, FALLBACK_HOURLY_RATE } from "./config.js";
import { vaultAbi, strategyAbi } from "./abi.js";

const args = process.argv.slice(2);
const flag = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const ONCE = args.includes("--once");
const INTERVAL = Number(flag("--interval") ?? 3600);
const DEMO_HOURS = flag("--demo-hours") ? Number(flag("--demo-hours")) : undefined;

if (!deployments) throw new Error("No deployments file — deploy the contracts first");
const { vault, strategy } = deployments;

async function hlInfo<T>(body: object): Promise<T> {
  const r = await fetch(HL_MAINNET_INFO, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`HL info ${r.status}`);
  return (await r.json()) as T;
}

async function ethPrice(): Promise<bigint> {
  try {
    const mids = await hlInfo<Record<string, string>>({ type: "allMids" });
    return parseUnits(Number(mids.ETH).toFixed(6), 6);
  } catch {
    return 0n; // keep on-chain price
  }
}

/** Returns [average hourly rate, hours] of realised funding since `sinceSec`. */
async function realisedFunding(sinceSec: number): Promise<[number, number, string]> {
  try {
    if (DEMO_HOURS) {
      const start = Date.now() - DEMO_HOURS * 3600_000;
      const hist = await hlInfo<{ fundingRate: string; time: number }[]>({ type: "fundingHistory", coin: "ETH", startTime: start });
      const avg = hist.reduce((a, h) => a + Number(h.fundingRate), 0) / Math.max(hist.length, 1);
      return [avg, DEMO_HOURS, `demo: avg of last ${hist.length}h real ETH funding`];
    }
    const hist = await hlInfo<{ fundingRate: string; time: number }[]>({
      type: "fundingHistory",
      coin: "ETH",
      startTime: sinceSec * 1000 + 1,
    });
    if (hist.length === 0) return [0, 0, "no new funding hours"];
    const sum = hist.reduce((a, h) => a + Number(h.fundingRate), 0);
    return [sum / hist.length, Math.min(hist.length, 720), `${hist.length}h real ETH funding`];
  } catch (e) {
    const hours = DEMO_HOURS ?? Math.max(1, Math.floor((Date.now() / 1000 - sinceSec) / 3600));
    if (!DEMO_HOURS && Date.now() / 1000 - sinceSec < 3600) return [0, 0, "HL API unreachable, < 1h elapsed"];
    return [FALLBACK_HOURLY_RATE, Math.min(hours, 720), `HL API unreachable (${(e as Error).message}) → backtest mean 14.16% APR`];
  }
}

async function send(address: `0x${string}`, abi: any, functionName: string, fnArgs: unknown[] = []) {
  const { request } = await publicClient.simulateContract({ account, address, abi, functionName, args: fnArgs });
  const hash = await walletClient.writeContract(request);
  const rc = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`  ✓ ${functionName} ${hash} (gas ${rc.gasUsed})`);
  return rc;
}

async function cycle() {
  const t = new Date().toISOString();
  const last = Number(await publicClient.readContract({ address: strategy, abi: strategyAbi, functionName: "lastFundingAt" }));
  const since = last > 0 ? last : Math.floor(Date.now() / 1000) - 3600;
  const [rate, hours, note] = await realisedFunding(since);
  const price = await ethPrice();
  console.log(`[${t}] funding: ${(rate * 100).toFixed(5)}%/h × ${hours}h (${note}), ETH ${price ? formatUnits(price, 6) : "n/a"}`);

  if (hours > 0) {
    const rateWad = parseUnits(rate.toFixed(18), 18);
    await send(strategy, strategyAbi, "reinvestFunding", [rateWad, BigInt(hours), price]);
  } else if (price > 0n) {
    await send(strategy, strategyAbi, "adjustPosition", [price]);
  }
  await send(vault, vaultAbi, "rebalance");

  const [nav, pps, queued] = await Promise.all([
    publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "totalAssets" }),
    publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "pricePerShare" }),
    publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "totalQueued" }),
  ]);
  console.log(`  NAV ${formatUnits(nav as bigint, 6)} USDC · PPS ${formatUnits(pps as bigint, 18)} · queued ${formatUnits(queued as bigint, 6)}`);
}

do {
  try {
    await cycle();
  } catch (e) {
    console.error("cycle failed:", (e as Error).message);
  }
  if (!ONCE) await new Promise((r) => setTimeout(r, INTERVAL * 1000));
} while (!ONCE);
