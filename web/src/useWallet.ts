import { useState } from "react";
import { useConnect, useSwitchChain } from "wagmi";
import { injected } from "wagmi/connectors";
import { hyperEvmTestnet } from "./wagmi";

export const hasInjectedWallet = () => typeof window !== "undefined" && !!(window as any).ethereum;

/** Connect button logic with visible feedback (no more silent clicks). */
export function useWallet() {
  const { connectAsync, isPending } = useConnect();
  const { switchChainAsync } = useSwitchChain();
  const [error, setError] = useState<string | null>(null);

  async function connectWallet() {
    setError(null);
    if (!hasInjectedWallet()) {
      setError("No browser wallet found. Install MetaMask (opening metamask.io), then reload this page.");
      window.open("https://metamask.io/download/", "_blank", "noopener");
      return;
    }
    try {
      await connectAsync({ connector: injected(), chainId: hyperEvmTestnet.id });
    } catch (e: any) {
      // Wallet connected but on another network: ask it to add/switch to HyperEVM testnet
      if (/chain/i.test(e?.message ?? "")) {
        try {
          await connectAsync({ connector: injected() });
          await switchChainAsync({ chainId: hyperEvmTestnet.id });
          return;
        } catch (e2: any) {
          e = e2;
        }
      }
      setError(e?.shortMessage ?? e?.message ?? "Could not connect wallet");
    }
  }

  return { connectWallet, isPending, error, clearError: () => setError(null) };
}
