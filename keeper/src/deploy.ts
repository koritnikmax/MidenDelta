/**
 * Deploys the MidenDelta fund contracts to HyperEVM testnet with viem (no Foundry needed on this machine).
 *
 *   1. checks the wallet exists on HyperCore (required for big blocks) and has HYPE for gas
 *   2. big blocks ON, then all contract deployments sent at once with sequential nonces
 *   3. big blocks OFF, then the wiring calls in fast small blocks
 *   4. admin rights handed from the deployer to the FundTimelock
 *
 * On testnet the deployer stands in for several parties that are separate in production:
 * AIFM multisig (timelock proposer/executor), fund administrator (AGENT, NAV_SIGNER), keeper, guardian.
 *
 *   EPOCH_SECONDS   dealing epoch length (default 900 = 15 min for the demo; 86400 = daily in production)
 *   TIMELOCK_DELAY  admin delay in seconds (default 300; e.g. 48h in production)
 *   SEED_USDC       test USDC the deployer subscribes as an anchor investor (default 1,000,000), so individual
 *                   demo users stay small relative to the fund and the 15% redemption gate rarely binds
 *   LOCAL=1         rehearsal against a local node (anvil): skips the HyperCore checks and big blocks,
 *                   and does not overwrite web/src/deployments.json
 */
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { keccak256, toBytes, getContractAddress, encodeDeployData, formatEther, zeroHash, type Hex, type Abi } from "viem";
import { publicClient, walletClient, account, DEPLOYMENTS_PATH } from "./config.js";
import { setBigBlocks, coreRole } from "./hyperliquid.js";
import { eurPerUsd } from "./fx.js";

const art = JSON.parse(readFileSync(new URL("./artifacts.json", import.meta.url), "utf8")) as Record<string, { abi: Abi; bytecode: Hex }>;
const EPOCH_SECONDS = BigInt(process.env.EPOCH_SECONDS ?? 900);
const TIMELOCK_DELAY = BigInt(process.env.TIMELOCK_DELAY ?? 300);
const BLOCKED_COUNTRIES = [840, 192, 364, 408, 760]; // US, Cuba, Iran, North Korea, Syria [CONFIRM list with counsel]
const LOCAL = process.env.LOCAL === "1";
const role = (name: string) => keccak256(toBytes(name));
const R = { AGENT: role("AGENT_ROLE"), NAV_SIGNER: role("NAV_SIGNER_ROLE"), KEEPER: role("KEEPER_ROLE"), GUARDIAN: role("GUARDIAN_ROLE"), VAULT: role("VAULT_ROLE"), MINTER: role("MINTER_ROLE"), ADMIN: zeroHash };

const me = account.address;
console.log(`deployer ${me} on chain ${await publicClient.getChainId()}`);
const hype = await publicClient.getBalance({ address: me });
console.log(`gas balance ${formatEther(hype)} HYPE`);
if (hype === 0n) throw new Error("The deployer has no HYPE on HyperEVM testnet.");
const roleOnCore = LOCAL ? "local" : await coreRole(me);
if (roleOnCore === "missing") {
  throw new Error("The deployer has no HyperCore account yet, so big blocks can't be enabled. Send ~1 test USDC to it on app.hyperliquid-testnet.xyz first.");
}

// ------------------------------------------------------------------ 1. deployments (big blocks)
let nonce = await publicClient.getTransactionCount({ address: me, blockTag: "pending" });
type Step = { name: string; addr: Hex; args: (a: Record<string, Hex>) => unknown[] };
const plan: Step[] = [];
const A: Record<string, Hex> = {};
const add = (key: string, name: string, args: Step["args"]) => {
  const addr = getContractAddress({ from: me, nonce: BigInt(nonce + plan.length) });
  plan.push({ name, addr, args });
  A[key] = addr;
};
add("usdc", "MockUSDC", () => [me]);
add("registry", "IdentityRegistry", () => [me]);
add("token", "MidenShareToken", (a) => ["MidenDelta Fund Unit (testnet)", "MDELTA", a.registry, me]);
add("oracle", "NavOracle", () => [me]);
add("liquidity", "LiquidityManager", () => [me]);
add("strategy", "StrategyManager", (a) => [a.usdc, me]);
add("adapter", "SimulatedHyperliquidAdapter", (a) => [a.usdc, a.strategy, me]);
add("vault", "MidenVault", (a) => [a.usdc, a.token, a.oracle, a.registry, a.liquidity, a.strategy, EPOCH_SECONDS, me]);
add("compliance", "EligibilityCompliance", (a) => [a.registry, a.token, a.oracle, me]);
add("onboarding", "TestnetOnboarding", (a) => [a.registry]);
add("timelock", "FundTimelock", () => [TIMELOCK_DELAY, [me], [me]]);

if (!LOCAL) console.log("big blocks on:", await setBigBlocks(true));
const deployHashes: Hex[] = [];
for (const p of plan) {
  const { abi, bytecode } = art[p.name];
  const args = p.args(A);
  // generous fixed limit if the RPC can't estimate a deployment above the small-block limit
  const gas = await publicClient
    .estimateGas({ account: me, data: encodeDeployData({ abi, bytecode, args }) })
    .then((g) => (g * 12n) / 10n)
    .catch(() => 6_000_000n);
  deployHashes.push(await walletClient.deployContract({ abi, bytecode, args, gas, nonce: nonce++ }));
  console.log(`  sent ${p.name.padEnd(28)} → ${p.addr}`);
}
for (const [i, h] of deployHashes.entries()) {
  const rc = await publicClient.waitForTransactionReceipt({ hash: h, timeout: 900_000 });
  if (rc.status !== "success" || rc.contractAddress?.toLowerCase() !== plan[i].addr.toLowerCase()) throw new Error(`${plan[i].name} deploy failed`);
  console.log(`  ✓ ${plan[i].name} (gas ${rc.gasUsed})`);
}
if (!LOCAL) console.log("big blocks off:", await setBigBlocks(false));

// ------------------------------------------------------------------ 2. wiring (small blocks)
const calls: [string, Hex, string, unknown[]][] = [];
const addressOf = (name: string) => plan.find((p) => p.name === name)!.addr;
const call = (name: string, fn: string, args: unknown[]) => calls.push([name, addressOf(name), fn, args]);

call("StrategyManager", "setVault", [A.vault]);
call("StrategyManager", "setAdapter", [A.adapter]);
call("MockUSDC", "grantRole", [R.MINTER, A.adapter]);
call("MidenShareToken", "grantRole", [R.VAULT, A.vault]);
call("IdentityRegistry", "grantRole", [R.VAULT, A.vault]);
call("IdentityRegistry", "grantRole", [R.AGENT, me]);
call("IdentityRegistry", "grantRole", [R.AGENT, A.onboarding]);
call("MidenShareToken", "grantRole", [R.AGENT, me]);
call("NavOracle", "grantRole", [R.NAV_SIGNER, me]);
call("MidenVault", "grantRole", [R.KEEPER, me]);
call("StrategyManager", "grantRole", [R.KEEPER, me]);
call("SimulatedHyperliquidAdapter", "grantRole", [R.KEEPER, me]);
call("MidenVault", "grantRole", [R.GUARDIAN, me]);
call("MidenVault", "grantRole", [R.GUARDIAN, A.strategy]); // circuit breaker pauses the vault
call("StrategyManager", "grantRole", [R.GUARDIAN, me]);
call("MidenShareToken", "grantRole", [R.GUARDIAN, me]);
for (const c of BLOCKED_COUNTRIES) call("IdentityRegistry", "setCountryBlocked", [c, true]);
call("MidenShareToken", "setCompliance", [A.compliance]); // connected, but peer transfers stay off (Phase 1)
// anchor investor: the deployer registers and subscribes test USDC (settles with the first epoch)
const SEED = BigInt(process.env.SEED_USDC ?? 1_000_000) * 1_000_000n;
if (SEED > 0n) {
  calls.push(["MockUSDC", A.usdc, "grantRole", [R.MINTER, me]]);
  calls.push(["MockUSDC", A.usdc, "mint", [me, SEED]]);
  calls.push(["TestnetOnboarding", A.onboarding, "registerMe", [276]]);
  calls.push(["MockUSDC", A.usdc, "approve", [A.vault, SEED]]);
  calls.push(["MidenVault", A.vault, "requestDeposit", [SEED, me, me]]);
}
const eur = await eurPerUsd();
call("NavOracle", "publish", [0n, 1_000_000n, BigInt(Math.round(1e6 * eur))]); // launch NAV 1.00 USD per unit
// hand admin rights to the timelock
for (const name of ["IdentityRegistry", "MidenShareToken", "NavOracle", "LiquidityManager", "StrategyManager", "SimulatedHyperliquidAdapter", "MidenVault", "EligibilityCompliance"]) {
  call(name, "grantRole", [R.ADMIN, A.timelock]);
  call(name, "renounceRole", [R.ADMIN, me]);
}

const hashes: Hex[] = [];
for (const [name, address, fn, args] of calls) {
  hashes.push(await walletClient.writeContract({ address, abi: art[name].abi, functionName: fn, args, gas: 300_000n, nonce: nonce++ }));
}
for (const [i, h] of hashes.entries()) {
  const rc = await publicClient.waitForTransactionReceipt({ hash: h, timeout: 300_000 });
  const [name, , fn] = calls[i];
  if (rc.status !== "success") throw new Error(`${name}.${fn} failed (${h})`);
}
console.log(`  ✓ ${calls.length} wiring calls`);

// ------------------------------------------------------------------ 3. write addresses
const block = await publicClient.getBlockNumber();
const out = { chainId: 998, ...A, deployer: me, block: Number(block), epochSeconds: Number(EPOCH_SECONDS) };
mkdirSync(dirname(DEPLOYMENTS_PATH), { recursive: true });
writeFileSync(DEPLOYMENTS_PATH, JSON.stringify(out, null, 2));
if (!LOCAL) writeFileSync(new URL("../../web/src/deployments.json", import.meta.url).pathname, JSON.stringify(out, null, 2));
console.log(out);
