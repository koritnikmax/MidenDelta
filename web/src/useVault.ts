import { useAccount, useReadContracts } from "wagmi";
import { formatUnits } from "viem";
import { vaultAbi, usdcAbi, strategyAbi } from "./abi";
import { ADDR } from "./wagmi";

const v = { address: ADDR.vault, abi: vaultAbi } as const;
const s = { address: ADDR.strategy, abi: strategyAbi } as const;
const u = { address: ADDR.usdc, abi: usdcAbi } as const;

export const fmtUsd = (x?: bigint, dp = 2) =>
  x === undefined ? "–" : Number(formatUnits(x, 6)).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const fmtPps = (x?: bigint) => (x === undefined ? "–" : Number(formatUnits(x, 18)).toFixed(6));

/** Global vault state (works without a wallet). */
export function useVaultState() {
  const q = useReadContracts({
    allowFailure: true,
    contracts: [
      { ...v, functionName: "totalAssets" },
      { ...v, functionName: "pricePerShare" },
      { ...v, functionName: "seriesInfo", args: [0n] },
      { ...v, functionName: "depositCap" },
      { ...v, functionName: "totalQueued" },
      { ...v, functionName: "instantLiquidity" },
      { ...v, functionName: "totalFeesCollected" },
      { ...v, functionName: "outstandingSeries" },
      { ...v, functionName: "depositSeries" },
      { ...v, functionName: "minDeposit" },
      { ...v, functionName: "performanceFeeBps" },
      { ...v, functionName: "bufferBps" },
      { ...s, functionName: "cumulativeFunding" },
      { ...s, functionName: "hedgeStats" },
      { ...s, functionName: "lastFundingRate" },
      { ...s, functionName: "ethPrice" },
      { ...s, functionName: "lastFundingAt" },
      { ...s, functionName: "totalValue" },
      { ...v, functionName: "totalSupply" },
      { ...v, functionName: "whitelistEnabled" },
      { ...v, functionName: "totalExitFees" },
    ],
    query: { refetchInterval: 8000 },
  });
  const r = (i: number) => q.data?.[i]?.result as any;
  const hourly = r(14) as bigint | undefined;
  return {
    ok: q.data?.[0]?.status === "success",
    loading: q.isLoading,
    refetch: q.refetch,
    totalAssets: r(0) as bigint | undefined,
    pps: r(1) as bigint | undefined,
    leadHwm: r(2)?.[3] as bigint | undefined,
    cap: r(3) as bigint | undefined,
    totalQueued: r(4) as bigint | undefined,
    instantLiquidity: r(5) as bigint | undefined,
    feesCollected: r(6) as bigint | undefined,
    outstanding: (r(7) as bigint[] | undefined) ?? [],
    depositSeries: r(8) as bigint | undefined,
    minDeposit: r(9) as bigint | undefined,
    perfFeeBps: r(10) as bigint | undefined,
    bufferBps: r(11) as bigint | undefined,
    cumulativeFunding: r(12) as bigint | undefined,
    hedgeRatioBps: r(13)?.[0] as bigint | undefined,
    marginBps: r(13)?.[1] as bigint | undefined,
    liveFundingApr: hourly === undefined ? undefined : (Number(formatUnits(hourly, 18)) * 8760 * 100),
    ethPrice: r(15) as bigint | undefined,
    lastFundingAt: r(16) as bigint | undefined,
    strategyValue: r(17) as bigint | undefined,
    supply: r(18) as bigint | undefined,
    whitelist: r(19) as boolean | undefined,
    exitFees: r(20) as bigint | undefined,
  };
}

/** Connected-wallet state. */
export function useUserState() {
  const { address } = useAccount();
  const enabled = !!address;
  const q = useReadContracts({
    allowFailure: true,
    contracts: [
      { ...u, functionName: "balanceOf", args: [address!] },
      { ...u, functionName: "allowance", args: [address!, ADDR.vault] },
      { ...v, functionName: "positionOf", args: [address!] },
      { ...v, functionName: "requestsOf", args: [address!] },
    ],
    query: { enabled, refetchInterval: 8000 },
  });
  const r = (i: number) => q.data?.[i]?.result as any;
  const pos = r(2);
  return {
    address,
    refetch: q.refetch,
    usdc: r(0) as bigint | undefined,
    allowance: r(1) as bigint | undefined,
    leadShares: pos?.[0] as bigint | undefined,
    leadValue: pos?.[1] as bigint | undefined,
    seriesIds: (pos?.[2] as bigint[] | undefined) ?? [],
    seriesShares: (pos?.[3] as bigint[] | undefined) ?? [],
    seriesValues: (pos?.[4] as bigint[] | undefined) ?? [],
    totalValue: pos?.[5] as bigint | undefined,
    requestIds: (r(3) as bigint[] | undefined) ?? [],
  };
}

export function useRequests(ids: bigint[]) {
  const q = useReadContracts({
    allowFailure: true,
    contracts: ids.map((id) => ({ ...v, functionName: "requestInfo", args: [id] }) as const),
    query: { enabled: ids.length > 0, refetchInterval: 8000 },
  });
  return {
    refetch: q.refetch,
    items: ids
      .map((id, i) => {
        const x = q.data?.[i]?.result as any;
        return x ? { id, amount: x[2] as bigint, remaining: x[3] as bigint, claimable: x[4] as bigint, claimed: x[5] as bigint, createdAt: x[6] as bigint } : undefined;
      })
      .filter(Boolean) as { id: bigint; amount: bigint; remaining: bigint; claimable: bigint; claimed: bigint; createdAt: bigint }[],
  };
}
