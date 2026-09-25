import { formatUnits, formatEther } from "viem";
import { publicClient, account, deployments } from "./config.js";
import { vaultAbi, strategyAbi, adapterAbi, oracleAbi, tokenAbi } from "./abi.js";
import { coreRole } from "./hyperliquid.js";

const bal = await publicClient.getBalance({ address: account.address });
console.log(`keeper ${account.address}  HYPE ${formatEther(bal)}  HyperCore account: ${await coreRole(account.address)}`);
if (!deployments) {
  console.log("fund contracts: not deployed yet");
  process.exit(0);
}
const d = deployments!;
const r = (address: `0x${string}`, abi: any, functionName: string, args: unknown[] = []) =>
  publicClient.readContract({ address, abi, functionName, args }) as Promise<any>;
const [assets, supply, nav, epoch, settled, queued, reserved, levies, sv, lev, margin] = await Promise.all([
  r(d.vault, vaultAbi, "totalAssets"),
  r(d.token, tokenAbi, "totalSupply"),
  r(d.oracle, oracleAbi, "navPerUnitUSD"),
  r(d.vault, vaultAbi, "currentEpoch"),
  r(d.vault, vaultAbi, "lastSettledEpoch"),
  r(d.vault, vaultAbi, "queuedShares"),
  r(d.vault, vaultAbi, "reservedAssets"),
  r(d.vault, vaultAbi, "totalLevies"),
  r(d.strategy, strategyAbi, "totalValue"),
  r(d.adapter, adapterAbi, "getLeverage", ["0x4554480000000000000000000000000000000000000000000000000000000000"]),
  r(d.adapter, adapterAbi, "getMarginRatio", ["0x4554480000000000000000000000000000000000000000000000000000000000"]),
]);
console.log({
  fundAssets: formatUnits(assets, 6),
  units: formatUnits(supply, 18),
  navPerUnitUSD: formatUnits(nav, 6),
  openEpoch: String(epoch),
  lastSettledEpoch: String(settled),
  queuedRedemptionUnits: formatUnits(queued, 18),
  reservedForClaims: formatUnits(reserved, 6),
  leviesRetained: formatUnits(levies, 6),
  strategyValue: formatUnits(sv, 6),
  leverage: `${(Number(lev) / 1e4).toFixed(2)}x`,
  marginRatio: `${(Number(margin) / 100).toFixed(2)}%`,
});
