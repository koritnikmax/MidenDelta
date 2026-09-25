import { useEffect, useState } from "react";
import { useAccount, useChainId, useSwitchChain, useWriteContract, usePublicClient } from "wagmi";
import { parseUnits, formatUnits, maxUint256 } from "viem";
import { vaultAbi, usdcAbi, onboardingAbi } from "./abi";
import { ADDR, hyperEvmTestnet, explorer } from "./wagmi";
import { useWallet } from "./useWallet";
import { useFundState, useInvestorState, fmtUsd, fmtUnits } from "./useVault";

type Status = { kind: "info" | "ok" | "err"; msg: string; hash?: string } | null;

// Testnet onboarding choices. A blocked country (US) shows the eligibility check rejecting the wallet.
const COUNTRIES = [
  { code: 276, name: "Germany" },
  { code: 40, name: "Austria" },
  { code: 756, name: "Switzerland" },
  { code: 438, name: "Liechtenstein" },
  { code: 442, name: "Luxembourg" },
  { code: 840, name: "United States (blocked)" },
];

const NOT_DEPLOYED = /^0x0+$/.test(ADDR.vault);

function useNow() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

const mmss = (s: number) => {
  const m = Math.floor(Math.max(0, s) / 60);
  const r = Math.max(0, s) % 60;
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m}:${String(r).padStart(2, "0")}`;
};

export default function VaultApp() {
  const [tab, setTab] = useState<"subscribe" | "redeem">("subscribe");
  const [amount, setAmount] = useState("");
  const [country, setCountry] = useState(276);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);

  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { connectWallet, isPending: connecting, error: walletError } = useWallet();
  const { switchChain } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const pc = usePublicClient();
  const fund = useFundState();
  const me = useInvestorState();
  const now = useNow();

  const wrongChain = isConnected && chainId !== hyperEvmTestnet.id;
  const decimals = tab === "subscribe" ? 6 : 18;
  let parsed = 0n;
  try {
    parsed = amount ? parseUnits(amount, decimals) : 0n;
  } catch {
    parsed = 0n;
  }

  const closesIn = fund.epochOpenedAt !== undefined && fund.epochDuration !== undefined ? Number(fund.epochOpenedAt + fund.epochDuration) - now : undefined;
  const awaitingSettlement = fund.epoch !== undefined && fund.lastSettled !== undefined && fund.lastSettled < fund.epoch - 1n;

  async function run(label: string, fn: () => Promise<`0x${string}`>) {
    setBusy(true);
    setStatus({ kind: "info", msg: `${label}: confirm in your wallet…` });
    try {
      const hash = await fn();
      setStatus({ kind: "info", msg: `${label}: waiting for confirmation…`, hash });
      const rc = await pc!.waitForTransactionReceipt({ hash });
      if (rc.status !== "success") throw new Error("transaction reverted");
      setStatus({ kind: "ok", msg: `${label}: confirmed`, hash });
      fund.refetch();
      me.refetch();
      return true;
    } catch (e: any) {
      setStatus({ kind: "err", msg: e?.shortMessage ?? e?.message ?? String(e) });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const faucet = () => run("Get 10,000 test USDC", () => writeContractAsync({ address: ADDR.usdc, abi: usdcAbi, functionName: "faucet" }));
  const register = () => run("Register as test investor", () => writeContractAsync({ address: ADDR.onboarding, abi: onboardingAbi, functionName: "registerMe", args: [country] }));

  async function requestSubscription() {
    if (!me.address) return;
    if ((me.allowance ?? 0n) < parsed) {
      const ok = await run("Approve USDC", () => writeContractAsync({ address: ADDR.usdc, abi: usdcAbi, functionName: "approve", args: [ADDR.vault, maxUint256] }));
      if (!ok) return;
    }
    const ok = await run(`Request subscription of ${fmtUsd(parsed)} USDC`, () =>
      writeContractAsync({ address: ADDR.vault, abi: vaultAbi, functionName: "requestDeposit", args: [parsed, me.address!, me.address!] }),
    );
    if (ok) setAmount("");
  }

  async function requestRedemption() {
    if (!me.address) return;
    const ok = await run(`Request redemption of ${fmtUnits(parsed)} units`, () =>
      writeContractAsync({ address: ADDR.vault, abi: vaultAbi, functionName: "requestRedeem", args: [parsed, me.address!, me.address!] }),
    );
    if (ok) setAmount("");
  }

  const claimUnits = () =>
    run("Claim units", () => writeContractAsync({ address: ADDR.vault, abi: vaultAbi, functionName: "mint", args: [me.claimableUnits!, me.address!, me.address!] }));
  const claimUsdc = () =>
    run("Claim USDC", () => writeContractAsync({ address: ADDR.vault, abi: vaultAbi, functionName: "withdraw", args: [me.claimableUsdc!, me.address!, me.address!] }));

  const tooMuch = tab === "subscribe" ? parsed > (me.usdc ?? 0n) : parsed > (me.units ?? 0n);
  const indicativeUnits = tab === "subscribe" && fund.nav ? (parsed * 10n ** 18n) / fund.nav : undefined;
  const indicativeUsdc = tab === "redeem" && fund.nav ? (parsed * fund.nav) / 10n ** 18n : undefined;

  const gate = () => {
    if (!isConnected)
      return (
        <>
          <button className="btn block" onClick={connectWallet} disabled={connecting}>
            {connecting ? "Check your wallet…" : "Connect wallet"}
          </button>
          {walletError && <div className="notice err">{walletError}</div>}
        </>
      );
    if (wrongChain) return <button className="btn block" onClick={() => switchChain({ chainId: hyperEvmTestnet.id })}>Switch to HyperEVM Testnet</button>;
    if (NOT_DEPLOYED) return <div className="notice info">The fund contracts are being deployed to HyperEVM testnet. Dealing opens shortly.</div>;
    if (fund.paused) return <div className="notice err">Dealing is paused: a circuit breaker has tripped. Only the fund manager can resume it.</div>;
    return null;
  };

  const blocker = gate();

  return (
    <section id="app">
      <div className="wrap">
        <div className="sec-head">
          <div className="eyebrow dark">HyperEVM testnet fund</div>
          <h2>Subscribe and redeem</h2>
          <p>
            Dealing works like a regulated fund with the unit register on-chain. You request a subscription or redemption, the epoch closes
            at its cutoff, the administrator publishes the NAV, and you claim your units or USDC. On testnet an epoch lasts{" "}
            {fund.epochDuration ? mmss(Number(fund.epochDuration)) : "a few minutes"}; the fund itself deals daily.
          </p>
        </div>

        <div className="app-grid">
          {/* ---------------- action card ---------------- */}
          <div className="card">
            {blocker ??
              (!me.registered ? (
                <>
                  <h3 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 500 }}>Testnet onboarding</h3>
                  <p className="hint" style={{ marginTop: 0 }}>
                    The fund is open to professional and semi-professional investors only. In production the administrator verifies you through
                    KYC. Here you can register your wallet as a test professional investor.
                  </p>
                  <div className="row"><span>Country of residence</span>
                    <select value={country} onChange={(e) => setCountry(Number(e.target.value))} className="select" aria-label="Country of residence">
                      {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                    </select>
                  </div>
                  <button className="btn block" style={{ marginTop: 16 }} onClick={register} disabled={busy}>Register as test investor</button>
                </>
              ) : !me.verified ? (
                <div className="notice err">
                  This wallet is registered but not eligible (blocked country or expired KYC). The fund does not accept US persons.
                </div>
              ) : (
                <>
                  <div className="tabs">
                    <button className={tab === "subscribe" ? "on" : ""} onClick={() => { setTab("subscribe"); setAmount(""); }}>Subscribe</button>
                    <button className={tab === "redeem" ? "on" : ""} onClick={() => { setTab("redeem"); setAmount(""); }}>Redeem</button>
                  </div>
                  <div className="row" style={{ paddingTop: 0 }}>
                    <span>{tab === "subscribe" ? "Amount" : "Units to redeem"}</span>
                    <span>
                      {tab === "subscribe" ? "Wallet: " : "Held: "}
                      <b>{tab === "subscribe" ? `${fmtUsd(me.usdc)} USDC` : `${fmtUnits(me.units)} units`}</b>
                    </span>
                  </div>
                  <div className="field">
                    <input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} aria-label={tab === "subscribe" ? "Amount in USDC" : "Units to redeem"} />
                    <button className="max" onClick={() => setAmount(formatUnits((tab === "subscribe" ? me.usdc : me.units) ?? 0n, decimals))}>MAX</button>
                    <span className="unit">{tab === "subscribe" ? "USDC" : "units"}</span>
                  </div>
                  <div style={{ marginTop: 14 }}>
                    <div className="row"><span>Last official NAV per unit</span><b>{fund.nav ? `${Number(formatUnits(fund.nav, 6)).toFixed(4)} USDC` : "–"}</b></div>
                    {tab === "subscribe" ? (
                      <div className="row"><span>Indicative units</span><b>{indicativeUnits !== undefined ? fmtUnits(indicativeUnits) : "–"}</b></div>
                    ) : (
                      <div className="row"><span>Indicative proceeds</span><b>{indicativeUsdc !== undefined ? `${fmtUsd(indicativeUsdc)} USDC` : "–"}</b></div>
                    )}
                    <div className="row"><span>Settles at</span><b>{fund.epoch !== undefined ? `end of epoch ${fund.epoch} (${closesIn !== undefined && closesIn > 0 ? `in ${mmss(closesIn)}` : "closing now"})` : "–"}</b></div>
                    <div className="row"><span>Fees</span><b>19.5% performance fee above high-water mark</b></div>
                  </div>
                  <p className="hint">
                    {tab === "subscribe"
                      ? "Units are priced at the NAV struck for the epoch, not the NAV shown here."
                      : "If net redemptions exceed 15% of NAV in an epoch, every request is filled pro-rata and the rest rolls over. Net outflows pay an anti-dilution levy that stays in the fund."}
                  </p>
                  {tooMuch && parsed > 0n && <div className="notice">That's more than you hold.</div>}
                  <button
                    className="btn block"
                    style={{ marginTop: 14 }}
                    disabled={busy || parsed === 0n || tooMuch}
                    onClick={tab === "subscribe" ? requestSubscription : requestRedemption}
                  >
                    {tab === "subscribe" ? ((me.allowance ?? 0n) < parsed && parsed > 0n ? "Approve and request subscription" : "Request subscription") : "Request redemption"}
                  </button>
                </>
              ))}

            {isConnected && !wrongChain && !NOT_DEPLOYED && me.verified && (
              <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                <button className="btn soft" onClick={faucet} disabled={busy}>Get 10,000 test USDC</button>
              </div>
            )}
            {!isConnected && <p className="hint">You'll need a little testnet HYPE for gas. Test USDC comes from the faucet button after onboarding.</p>}

            {status && (
              <div className={`notice ${status.kind}`}>
                {status.msg}{" "}
                {status.hash && <a href={explorer(status.hash, "tx")} target="_blank" rel="noreferrer">View tx</a>}
              </div>
            )}
          </div>

          {/* ---------------- position card ---------------- */}
          <div className="card white">
            <h3 style={{ margin: "0 0 6px", fontSize: 20, fontWeight: 500 }}>Your position</h3>
            {!isConnected ? (
              <p className="hint">Connect a wallet to see your units, open requests and claims.</p>
            ) : (
              <>
                <div className="kpi">
                  <div className="v">{fmtUnits(me.units)} <span style={{ fontSize: 16, color: "var(--muted)" }}>units</span></div>
                  <div className="k">
                    Indicative value {me.units !== undefined && fund.nav ? `${fmtUsd((me.units * fund.nav) / 10n ** 18n)} USDC` : "–"} at the last official NAV
                  </div>
                </div>
                <div className="sep" />
                <div className="row"><span>Subscription waiting for settlement</span><b>{fmtUsd(me.pendingDeposit)} USDC</b></div>
                <div className="row">
                  <span>Units ready to claim</span>
                  <b>
                    {(me.claimableUnits ?? 0n) > 0n ? (
                      <button className="btn" style={{ padding: "6px 14px", fontSize: 14 }} onClick={claimUnits} disabled={busy}>Claim {fmtUnits(me.claimableUnits)}</button>
                    ) : "0.00"}
                  </b>
                </div>
                <div className="row"><span>Redemption waiting for settlement</span><b>{fmtUnits(me.pendingRedeemUnits)} units</b></div>
                <div className="row">
                  <span>USDC ready to claim</span>
                  <b>
                    {(me.claimableUsdc ?? 0n) > 0n ? (
                      <button className="btn" style={{ padding: "6px 14px", fontSize: 14 }} onClick={claimUsdc} disabled={busy}>Claim {fmtUsd(me.claimableUsdc)}</button>
                    ) : "0.00"}
                  </b>
                </div>
                <div className="sep" />
                <div className="row"><span>Open epoch</span><b>{fund.epoch !== undefined ? String(fund.epoch) : "–"}{closesIn !== undefined ? `, closes ${closesIn > 0 ? `in ${mmss(closesIn)}` : "now"}` : ""}</b></div>
                <div className="row"><span>Settlement</span><b>{awaitingSettlement ? "waiting for NAV" : `epoch ${fund.lastSettled !== undefined ? String(fund.lastSettled) : "–"} settled`}</b></div>
                <p className="hint">Units can't be sent to other wallets directly: transfers between eligible investors go through the administrator.</p>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
