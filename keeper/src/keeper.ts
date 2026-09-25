/**
 * MidenDelta keeper (testnet, simulated Hyperliquid adapter)
 *
 * Execution-only: it cannot withdraw, change parameters, add markets or unpause after a breaker.
 * Every interval:
 *   1. feed the real Hyperliquid ETH mark price and realised hourly funding into the simulated adapter
 *   2. re-hedge if spot/short or leverage drifted past the band; top up margin or trip the breaker if margin
 *      falls below the floor
 *   3. dealing: close the epoch at its cutoff; publish the NAV (testnet stand-in for the fund administrator);
 *      recall liquidity for redemptions; settle; deploy free cash into the strategy
 *
 * Flags:
 *   --once              run a single cycle and exit
 *   --interval <sec>    loop interval (default 300)
 */
import { parseUnits, formatUnits, type Hex } from "viem";
import { publicClient, walletClient, account, deployments, HL_MAINNET_INFO, FALLBACK_HOURLY_RATE } from "./config.js";
import { vaultAbi, strategyAbi, adapterAbi, oracleAbi, tokenAbi } from "./abi.js";
import { eurPerUsd } from "./fx.js";

const args = process.argv.slice(2);
const flag = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const ONCE = args.includes("--once");
const INTERVAL = Number(flag("--interval") ?? 300);

if (!deployments) throw new Error("No deployments file: deploy the contracts first (npm run deploy)");
const D = deployments;
const WAD = 10n ** 18n;

const read = <T>(address: Hex, abi: any, functionName: string, fnArgs: unknown[] = []) =>
  publicClient.readContract({ address, abi, functionName, args: fnArgs }) as Promise<T>;

async function send(address: Hex, abi: any, functionName: string, fnArgs: unknown[] = []) {
  const { request } = await publicClient.simulateContract({ account, address, abi, functionName, args: fnArgs });
  const hash = await walletClient.writeContract(request);
  const rc = await publicClient.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error(`${functionName} reverted (${hash})`);
  console.log(`  ✓ ${functionName}(${fnArgs.map(String).join(", ")}) ${hash}`);
  return rc;
}

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
    return 0n;
  }
}

/** Average realised hourly funding since `sinceSec` and the number of hours. */
async function realisedFunding(sinceSec: number): Promise<[number, number]> {
  try {
    const hist = await hlInfo<{ fundingRate: string }[]>({ type: "fundingHistory", coin: "ETH", startTime: sinceSec * 1000 + 1 });
    if (!hist.length) return [0, 0];
    return [hist.reduce((a, h) => a + Number(h.fundingRate), 0) / hist.length, Math.min(hist.length, 720)];
  } catch {
    const hours = Math.floor((Date.now() / 1000 - sinceSec) / 3600);
    return hours > 0 ? [FALLBACK_HOURLY_RATE, Math.min(hours, 720)] : [0, 0];
  }
}

async function strategyStep() {
  const last = Number(await read<bigint>(D.adapter, adapterAbi, "lastFundingAt"));
  const since = last > 0 ? last : Math.floor(Date.now() / 1000) - 3600;
  const [rate, hours] = await realisedFunding(since);
  const price = await ethPrice();
  console.log(`  funding ${(rate * 100).toFixed(5)}%/h × ${hours}h, ETH ${price ? formatUnits(price, 6) : "n/a"}`);
  if (hours > 0) await send(D.adapter, adapterAbi, "accrueFunding", [parseUnits(rate.toFixed(18), 18), BigInt(hours), price]);
  else if (price > 0n) await send(D.adapter, adapterAbi, "markPrice", [price]);

  if ((await read<bigint>(D.adapter, adapterAbi, "totalValue")) === 0n) return;
  await send(D.strategy, strategyAbi, "rebalanceHedge");
  if (await read<boolean>(D.strategy, strategyAbi, "marginBelowFloor")) {
    const idle = (await read<bigint>(D.strategy, strategyAbi, "totalValue")) - (await read<bigint>(D.adapter, adapterAbi, "totalValue"));
    if (idle > 0n) await send(D.strategy, strategyAbi, "topUpMargin", [idle]);
    if (await read<boolean>(D.strategy, strategyAbi, "marginBelowFloor")) {
      await send(D.strategy, strategyAbi, "tripBreaker", ["margin below floor after top-up"]);
    }
  }
}

async function dealingStep() {
  const [current, openedAt, duration, lastSettled] = await Promise.all([
    read<bigint>(D.vault, vaultAbi, "currentEpoch"),
    read<bigint>(D.vault, vaultAbi, "epochOpenedAt"),
    read<bigint>(D.vault, vaultAbi, "epochDuration"),
    read<bigint>(D.vault, vaultAbi, "lastSettledEpoch"),
  ]);
  const now = BigInt(Math.floor(Date.now() / 1000));
  let epoch = current;
  if (lastSettled === current - 1n && now >= openedAt + duration) {
    await send(D.vault, vaultAbi, "closeEpoch");
    epoch = current + 1n;
  }
  const toSettle = (await read<bigint>(D.vault, vaultAbi, "lastSettledEpoch")) + 1n;
  if (toSettle >= epoch) return; // nothing closed yet

  // NAV per unit = gross fund assets / units outstanding (testnet stand-in for the administrator's NAV)
  const published = (await read<{ timestamp: bigint }>(D.oracle, oracleAbi, "navOf", [toSettle])).timestamp > 0n;
  const navUsd = published
    ? (await read<{ usd: bigint }>(D.oracle, oracleAbi, "navOf", [toSettle])).usd
    : await (async () => {
        const [assets, supply, latest] = await Promise.all([
          read<bigint>(D.vault, vaultAbi, "totalAssets"),
          read<bigint>(D.token, tokenAbi, "totalSupply"),
          read<bigint>(D.oracle, oracleAbi, "navPerUnitUSD"),
        ]);
        const nav = supply === 0n ? latest : (assets * WAD) / supply;
        const eur = BigInt(Math.round(Number(nav) * (await eurPerUsd())));
        await send(D.oracle, oracleAbi, "publish", [toSettle, nav, eur]);
        return nav;
      })();

  // make sure the vault holds enough USDC to pay the redemptions this epoch can fill
  const [queued, info, freeCash] = await Promise.all([
    read<bigint>(D.vault, vaultAbi, "queuedShares"),
    read<readonly bigint[]>(D.vault, vaultAbi, "epochs", [toSettle]),
    read<bigint>(D.vault, vaultAbi, "freeCash"),
  ]);
  const depositAssets = info[0];
  const redeemValue = ((queued + info[1]) * navUsd) / WAD;
  const available = freeCash + depositAssets;
  if (redeemValue > available) await send(D.vault, vaultAbi, "recallFromStrategy", [((redeemValue - available) * 101n) / 100n]);
  await send(D.vault, vaultAbi, "settleEpoch");
}

async function deployStep() {
  const free = await read<bigint>(D.vault, vaultAbi, "freeCash");
  if (free > 1_000_000n) await send(D.vault, vaultAbi, "deployToStrategy", [free]);
}

async function cycle() {
  console.log(`[${new Date().toISOString()}]`);
  if (await read<boolean>(D.vault, vaultAbi, "paused")) {
    console.log("  vault paused: breaker tripped, waiting for the AIFM to resume");
    return;
  }
  await strategyStep();
  await dealingStep();
  await deployStep();
  const [assets, epoch, nav] = await Promise.all([
    read<bigint>(D.vault, vaultAbi, "totalAssets"),
    read<bigint>(D.vault, vaultAbi, "currentEpoch"),
    read<bigint>(D.oracle, oracleAbi, "navPerUnitUSD"),
  ]);
  console.log(`  fund assets ${formatUnits(assets, 6)} USDC, NAV/unit ${formatUnits(nav, 6)}, open epoch ${epoch}`);
}

do {
  try {
    await cycle();
  } catch (e) {
    console.error("cycle failed:", (e as Error).message);
  }
  if (!ONCE) await new Promise((r) => setTimeout(r, INTERVAL * 1000));
} while (!ONCE);
