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

/** Fallback when the Hyperliquid API is unreachable: the backtest mean hourly funding rate. */
export const FALLBACK_HOURLY_RATE = 0.1416 / 8760;

const pk = process.env.PRIVATE_KEY as Hex | undefined;
if (!pk) throw new Error("PRIVATE_KEY missing in keeper/.env");
export const account = privateKeyToAccount(pk);

export const publicClient = createPublicClient({ chain: hyperEvmTestnet, transport: http() });
export const walletClient = createWalletClient({ account, chain: hyperEvmTestnet, transport: http() });

const depPath = process.env.DEPLOYMENTS ?? new URL("../../contracts/deployments/hyperevm-testnet.json", import.meta.url).pathname;

export type Deployments = {
  chainId: number;
  usdc: Hex; registry: Hex; token: Hex; oracle: Hex; liquidity: Hex; strategy: Hex; adapter: Hex;
  vault: Hex; compliance: Hex; onboarding: Hex; timelock: Hex; deployer: Hex; block: number; epochSeconds: number;
};
const raw = existsSync(depPath) ? (JSON.parse(readFileSync(depPath, "utf8")) as Deployments) : undefined;
/** undefined until the fund contracts are deployed */
export const deployments = raw && raw.vault && !/^0x0+$/.test(raw.vault) ? raw : undefined;
export const DEPLOYMENTS_PATH = depPath;
