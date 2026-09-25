import { useAccount, useReadContracts } from "wagmi";
import { formatUnits, zeroAddress } from "viem";
import { vaultAbi, usdcAbi, adapterAbi, strategyAbi, oracleAbi, tokenAbi, registryAbi } from "./abi";
import { ADDR, ETH_MARKET } from "./wagmi";

const v = { address: ADDR.vault, abi: vaultAbi } as const;
const u = { address: ADDR.usdc, abi: usdcAbi } as const;
const a = { address: ADDR.adapter, abi: adapterAbi } as const;
const s = { address: ADDR.strategy, abi: strategyAbi } as const;
const o = { address: ADDR.oracle, abi: oracleAbi } as const;
const t = { address: ADDR.token, abi: tokenAbi } as const;
const r = { address: ADDR.registry, abi: registryAbi } as const;

export const fmtUsd = (x?: bigint, dp = 2) =>
  x === undefined ? "–" : Number(formatUnits(x, 6)).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const fmtUnits = (x?: bigint, dp = 2) =>
  x === undefined ? "–" : Number(formatUnits(x, 18)).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

/** Fund-level state (works without a wallet). */
export function useFundState() {
  const q = useReadContracts({
    allowFailure: true,
    contracts: [
      { ...v, functionName: "totalAssets" },
      { ...o, functionName: "navPerUnitUSD" },
      { ...o, functionName: "latestEpoch" },
      { ...v, functionName: "currentEpoch" },
      { ...v, functionName: "epochOpenedAt" },
      { ...v, functionName: "epochDuration" },
      { ...v, functionName: "lastSettledEpoch" },
      { ...v, functionName: "subscriptionCap" },
      { ...v, functionName: "queuedShares" },
      { ...a, functionName: "lastFundingRate" },
      { ...a, functionName: "lastFundingAt" },
      { ...a, functionName: "getLeverage", args: [ETH_MARKET] },
      { ...s, functionName: "maxPerpLeverageBps" },
      { ...a, functionName: "hedgeStats" },
      { ...t, functionName: "totalSupply" },
      { ...v, functionName: "paused" },
    ],
    query: { refetchInterval: 8000 },
  });
  const x = (i: number) => q.data?.[i]?.result as any;
  const hourly = x(9) as bigint | undefined;
  return {
    ok: q.data?.[0]?.status === "success",
    loading: q.isLoading,
    refetch: q.refetch,
    totalAssets: x(0) as bigint | undefined,
    nav: x(1) as bigint | undefined,
    navEpoch: x(2) as bigint | undefined,
    epoch: x(3) as bigint | undefined,
    epochOpenedAt: x(4) as bigint | undefined,
    epochDuration: x(5) as bigint | undefined,
    lastSettled: x(6) as bigint | undefined,
    cap: x(7) as bigint | undefined,
    queuedShares: x(8) as bigint | undefined,
    liveFundingApr: hourly === undefined ? undefined : Number(formatUnits(hourly, 18)) * 8760 * 100,
    lastFundingAt: x(10) as bigint | undefined,
    leverageBps: x(11) as bigint | undefined,
    maxLeverageBps: x(12) as bigint | undefined,
    hedgeRatioBps: x(13)?.[0] as bigint | undefined,
    supply: x(14) as bigint | undefined,
    paused: x(15) as boolean | undefined,
  };
}

/** Connected-wallet state: eligibility, balances and open requests. */
export function useInvestorState() {
  const { address } = useAccount();
  const enabled = !!address;
  const q = useReadContracts({
    allowFailure: true,
    contracts: [
      { ...u, functionName: "balanceOf", args: [address!] },
      { ...u, functionName: "allowance", args: [address!, ADDR.vault] },
      { ...r, functionName: "identityOf", args: [address!] },
      { ...r, functionName: "isVerified", args: [address!] },
      { ...v, functionName: "positionOf", args: [address!] },
    ],
    query: { enabled, refetchInterval: 6000 },
  });
  const x = (i: number) => q.data?.[i]?.result as any;
  const pos = x(4);
  const identity = x(2) as string | undefined;
  return {
    address,
    refetch: q.refetch,
    usdc: x(0) as bigint | undefined,
    allowance: x(1) as bigint | undefined,
    registered: identity !== undefined && identity !== zeroAddress,
    verified: x(3) as boolean | undefined,
    pendingDeposit: pos?.[0] as bigint | undefined,
    claimableUnits: pos?.[1] as bigint | undefined,
    pendingRedeemUnits: pos?.[2] as bigint | undefined,
    claimableUsdc: pos?.[3] as bigint | undefined,
    units: pos?.[4] as bigint | undefined,
  };
}
