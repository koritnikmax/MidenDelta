import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { createPublicClient, createWalletClient, defineChain, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const hyperEvmTestnet = defineChain({
  id: 998,
  name: "HyperEVM Testnet",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: [process.env.RPC_URL ?? "https://rpc.hyperliquid-testnet.xyz/evm"] } },
  blockExplorers: { default: { name: "Purrsec", url: "https://testnet.purrsec.com" } },
});

export const HL_TESTNET_API = process.env.HL_TESTNET_API ?? "https://api.hyperliquid-testnet.xyz";
/** Real (mainnet) funding data drives the simulated NAV. */
export const HL_MAINNET_INFO = process.env.HL_MAINNET_INFO ?? "https://api.hyperliquid.xyz/info";

/** Backtest fallback: 14.16% gross APR (Hyperliquid ETH, May 2023 – Sep 2026). */
export const FALLBACK_HOURLY_RATE = 0.1416 / 8760;

const pk = process.env.PRIVATE_KEY as Hex | undefined;
if (!pk) throw new Error("PRIVATE_KEY missing in keeper/.env");
export const account = privateKeyToAccount(pk);

export const publicClient = createPublicClient({ chain: hyperEvmTestnet, transport: http() });
export const walletClient = createWalletClient({ account, chain: hyperEvmTestnet, transport: http() });

const depPath = process.env.DEPLOYMENTS ?? new URL("../../contracts/deployments/hyperevm-testnet.json", import.meta.url).pathname;
export const deployments = existsSync(depPath)
  ? (JSON.parse(readFileSync(depPath, "utf8")) as { usdc: Hex; vault: Hex; strategy: Hex; deployer: Hex })
  : undefined;
