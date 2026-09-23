/**
 * End-to-end smoke test against the deployed contracts, using the keeper wallet as an investor:
 * faucet → approve → mint → funding accrual (+fee) → instant redeem from buffer → queued redeem → fill → claim
 */
import { formatUnits, parseUnits, maxUint256 } from "viem";
import { publicClient, walletClient, account, deployments } from "./config.js";
import { vaultAbi, usdcAbi, strategyAbi } from "./abi.js";

if (!deployments) throw new Error("deploy first");
const { vault, usdc, strategy } = deployments;
const me = account.address;
const r = (address: `0x${string}`, abi: any, functionName: string, args: unknown[] = []) =>
  publicClient.readContract({ address, abi, functionName, args }) as Promise<any>;
async function w(address: `0x${string}`, abi: any, functionName: string, args: unknown[] = []) {
  const { request, result } = await publicClient.simulateContract({ account, address, abi, functionName, args });
  const hash = await walletClient.writeContract(request);
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`✓ ${functionName}(${args.map(String).join(", ")}) → ${result ?? ""}  ${hash}`);
  return result;
}
const usd = (x: bigint) => formatUnits(x, 6);
const pos = async () => {
  const p = await r(vault, vaultAbi, "positionOf", [me]);
  return `lead ${formatUnits(p[0], 18)} MDELTA (= ${usd(p[1])} USDC), total ${usd(p[5])} USDC`;
};

await w(usdc, usdcAbi, "faucet");
await w(usdc, usdcAbi, "approve", [vault, maxUint256]);
await w(vault, vaultAbi, "deposit", [parseUnits("5000", 6), me]);
console.log("after mint:", await pos());

await w(vault, vaultAbi, "rebalance");
console.log("strategy value", usd(await r(strategy, strategyAbi, "totalValue")), "vault idle", usd(await r(usdc, usdcAbi, "balanceOf", [vault])));

// 7 days of funding at the backtest mean (14.16% APR) to see NAV + performance fee move
await w(strategy, strategyAbi, "reinvestFunding", [parseUnits((0.1416 / 8760).toFixed(18), 18), 168n, 0n]);
await w(vault, vaultAbi, "rebalance");
console.log("PPS", formatUnits(await r(vault, vaultAbi, "pricePerShare"), 18), "fees", usd(await r(vault, vaultAbi, "totalFeesCollected")));
console.log("after funding:", await pos());

console.log("instant liquidity", usd(await r(vault, vaultAbi, "instantLiquidity")));
await w(vault, vaultAbi, "redeem", [parseUnits("100", 6), me]);
await w(vault, vaultAbi, "redeem", [parseUnits("2000", 6), me]); // exceeds buffer -> queue
const ids = (await r(vault, vaultAbi, "requestsOf", [me])) as bigint[];
console.log("queued", usd(await r(vault, vaultAbi, "totalQueued")), "requests", ids.map(String));
await w(vault, vaultAbi, "rebalance"); // pulls from strategy, fills queue
for (const id of ids) {
  const c = await r(vault, vaultAbi, "claimable", [id]);
  if (c > 0n) await w(vault, vaultAbi, "claim", [id]);
}
console.log("final:", await pos(), "| USDC wallet", usd(await r(usdc, usdcAbi, "balanceOf", [me])));
