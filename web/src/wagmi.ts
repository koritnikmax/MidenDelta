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
  strategy: deployments.strategy as Address,
};

export const explorer = (a: string, kind: "address" | "tx" = "address") => `${hyperEvmTestnet.blockExplorers.default.url}/${kind}/${a}`;

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
