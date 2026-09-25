/**
 * End-to-end check against the deployed contracts, with the keeper wallet acting as a test investor:
 * self-register → faucet → request subscription → (epoch passes, keeper settles) → claim units →
 * request redemption → (epoch passes, keeper settles) → claim USDC.
 * Run the keeper in a second terminal (npm run keeper -- --interval 60) while this waits for the epochs.
 */
import { formatUnits, parseUnits, maxUint256 } from "viem";
import { publicClient, walletClient, account, deployments } from "./config.js";
import { vaultAbi, usdcAbi, onboardingAbi, registryAbi, tokenAbi } from "./abi.js";

if (!deployments) throw new Error("deploy first");
const d = deployments;
const me = account.address;
const r = (address: `0x${string}`, abi: any, functionName: string, args: unknown[] = []) =>
  publicClient.readContract({ address, abi, functionName, args }) as Promise<any>;
async function w(address: `0x${string}`, abi: any, functionName: string, args: unknown[] = []) {
  const { request } = await publicClient.simulateContract({ account, address, abi, functionName, args });
  const hash = await walletClient.writeContract(request);
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`✓ ${functionName}(${args.map(String).join(", ")})  ${hash}`);
}
const sleep = (s: number) => new Promise((res) => setTimeout(res, s * 1000));
async function waitFor(label: string, check: () => Promise<boolean>) {
  process.stdout.write(`waiting for ${label}`);
  while (!(await check())) {
    process.stdout.write(".");
    await sleep(Number(process.env.POLL_SECONDS ?? 20));
  }
  console.log(" done");
}

if (!(await r(d.registry, registryAbi, "isVerified", [me]))) await w(d.onboarding, onboardingAbi, "registerMe", [276]);
await w(d.usdc, usdcAbi, "faucet");
await w(d.usdc, usdcAbi, "approve", [d.vault, maxUint256]);
await w(d.vault, vaultAbi, "requestDeposit", [parseUnits("5000", 6), me, me]);
await waitFor("the subscription to settle", async () => (await r(d.vault, vaultAbi, "maxDeposit", [me])) > 0n);
await w(d.vault, vaultAbi, "deposit", [await r(d.vault, vaultAbi, "maxDeposit", [me]), me, me]);
const units = await r(d.token, tokenAbi, "balanceOf", [me]);
console.log("units", formatUnits(units, 18));

await w(d.vault, vaultAbi, "requestRedeem", [units / 2n, me, me]);
await waitFor("the redemption to settle", async () => (await r(d.vault, vaultAbi, "maxWithdraw", [me])) > 0n);
const out = await r(d.vault, vaultAbi, "maxWithdraw", [me]);
await w(d.vault, vaultAbi, "withdraw", [out, me, me]);
console.log(`redeemed ${formatUnits(out, 6)} USDC; remaining units ${formatUnits(await r(d.token, tokenAbi, "balanceOf", [me]), 18)}`);
