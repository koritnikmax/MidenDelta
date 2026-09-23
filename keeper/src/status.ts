import { formatUnits, formatEther } from "viem";
import { publicClient, account, deployments } from "./config.js";
import { vaultAbi, strategyAbi } from "./abi.js";

const bal = await publicClient.getBalance({ address: account.address });
console.log(`keeper ${account.address}  HYPE ${formatEther(bal)}  chain ${await publicClient.getChainId()}`);
if (!deployments) process.exit(0);
const { vault, strategy } = deployments;
const r = (address: `0x${string}`, abi: any, functionName: string, args: unknown[] = []) =>
  publicClient.readContract({ address, abi, functionName, args }) as Promise<any>;
const [nav, pps, q, os, fees, tv, hs] = await Promise.all([
  r(vault, vaultAbi, "totalAssets"),
  r(vault, vaultAbi, "pricePerShare"),
  r(vault, vaultAbi, "totalQueued"),
  r(vault, vaultAbi, "outstandingSeries"),
  r(vault, vaultAbi, "totalFeesCollected"),
  r(strategy, strategyAbi, "totalValue"),
  r(strategy, strategyAbi, "hedgeStats"),
]);
console.log({
  nav: formatUnits(nav, 6),
  pps: formatUnits(pps, 18),
  queued: formatUnits(q, 6),
  outstandingSeries: os.map(String),
  perfFees: formatUnits(fees, 6),
  strategyValue: formatUnits(tv, 6),
  hedgeRatioBps: String(hs[0]),
  marginBps: String(hs[1]),
});
