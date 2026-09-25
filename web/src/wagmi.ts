import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { defineChain, type Address } from "viem";
import deployments from "./deployments.json";

const RPC = (import.meta.env.VITE_RPC_URL as string | undefined) ?? "https://rpc.hyperliquid-testnet.xyz/evm";

export const hyperEvmTestnet = defineChain({
  id: 998,
  name: "HyperEVM Testnet",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
  blockExplorers: { default: { name: "Purrsec", url: "https://testnet.purrsec.com" } },
  testnet: true,
});

export const config = createConfig({
  chains: [hyperEvmTestnet],
  connectors: [injected()],
  transports: { [hyperEvmTestnet.id]: http(RPC) },
});

export const ADDR = {
  vault: deployments.vault as Address,
  usdc: deployments.usdc as Address,
  token: deployments.token as Address,
  registry: deployments.registry as Address,
  oracle: deployments.oracle as Address,
  strategy: deployments.strategy as Address,
  adapter: deployments.adapter as Address,
  onboarding: deployments.onboarding as Address,
};

/** bytes32("ETH"): the only market the strategy may trade */
export const ETH_MARKET = "0x4554480000000000000000000000000000000000000000000000000000000000" as const;

export const explorer = (a: string, kind: "address" | "tx" = "address") => `${hyperEvmTestnet.blockExplorers.default.url}/${kind}/${a}`;

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
