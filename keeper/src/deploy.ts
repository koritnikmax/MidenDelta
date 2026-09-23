/**
 * Deploys MockUSDC + MidenDeltaVault + SimulatedStrategy to HyperEVM testnet with viem
 * (no Foundry needed on the machine). Run `npm run big-blocks` first: the vault needs ~4.5M gas.
 */
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { keccak256, toBytes, type Hex, type Abi } from "viem";
import { publicClient, walletClient, account } from "./config.js";

const art = JSON.parse(readFileSync(new URL("./artifacts.json", import.meta.url), "utf8")) as Record<string, { abi: Abi; bytecode: Hex }>;

async function deploy(name: string, args: unknown[]) {
  const { abi, bytecode } = art[name];
  const hash = await walletClient.deployContract({ abi, bytecode, args, gas: name === "MidenDeltaVault" ? 6_000_000n : 3_000_000n });
  console.log(`  ${name} tx ${hash} … (big block may take ~1 min)`);
  const rc = await publicClient.waitForTransactionReceipt({ hash, timeout: 300_000 });
  if (rc.status !== "success" || !rc.contractAddress) throw new Error(`${name} deploy failed`);
  console.log(`  ✓ ${name} ${rc.contractAddress} (gas ${rc.gasUsed})`);
  return rc.contractAddress;
}

async function call(address: Hex, name: string, fn: string, args: unknown[]) {
  const hash = await walletClient.writeContract({ address, abi: art[name].abi, functionName: fn, args, gas: 500_000n });
  await publicClient.waitForTransactionReceipt({ hash, timeout: 300_000 });
  console.log(`  ✓ ${name}.${fn}`);
}

console.log(`deployer ${account.address} on chain ${await publicClient.getChainId()}`);
const usdc = await deploy("MockUSDC", [account.address]);
const vault = await deploy("MidenDeltaVault", [usdc, account.address, account.address]);
const strategy = await deploy("SimulatedStrategy", [usdc, vault, account.address]);
await call(usdc, "MockUSDC", "grantRole", [keccak256(toBytes("MINTER_ROLE")), strategy]);
await call(vault, "MidenDeltaVault", "setStrategy", [strategy]);

const block = await publicClient.getBlockNumber();
const out = { chainId: 998, usdc, vault, strategy, deployer: account.address, block: Number(block) };
const dir = new URL("../../contracts/deployments/", import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
writeFileSync(dir + "hyperevm-testnet.json", JSON.stringify(out, null, 2));
writeFileSync(new URL("../../web/src/deployments.json", import.meta.url).pathname, JSON.stringify(out, null, 2));
console.log(out);
