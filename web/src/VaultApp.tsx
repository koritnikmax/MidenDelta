import { useState } from "react";
import { useAccount, useChainId, useSwitchChain, useWriteContract, usePublicClient, useReadContract } from "wagmi";
import { parseUnits, formatUnits, maxUint256 } from "viem";
import { vaultAbi, usdcAbi } from "./abi";
import { ADDR, hyperEvmTestnet, explorer } from "./wagmi";
import { useWallet } from "./useWallet";
import { useVaultState, useUserState, useRequests, fmtUsd } from "./useVault";

type Status = { kind: "info" | "ok" | "err"; msg: string; hash?: string } | null;

export default function VaultApp() {
  const [tab, setTab] = useState<"mint" | "redeem">("mint");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);

  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { connectWallet, isPending: connecting, error: walletError } = useWallet();
  const { switchChain } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const pc = usePublicClient();
  const vs = useVaultState();
  const us = useUserState();
  const reqs = useRequests(us.requestIds);

  const wrongChain = isConnected && chainId !== hyperEvmTestnet.id;
  let parsed = 0n;
  try {
    parsed = amount ? parseUnits(amount, 6) : 0n;
  } catch {
    parsed = 0n;
  }

  const { data: preview } = useReadContract({
    address: ADDR.vault, abi: vaultAbi, functionName: "previewDeposit", args: [parsed],
    query: { enabled: tab === "mint" && parsed > 0n },
  });
  const { data: exitPreview } = useReadContract({
    address: ADDR.vault, abi: vaultAbi, functionName: "previewExitFee", args: [parsed],
    query: { enabled: tab === "redeem" && parsed > 0n },
  });

  const refresh = () => {
    vs.refetch();
    us.refetch();
    reqs.refetch();
  };

  async function run(label: string, fn: () => Promise<`0x${string}`>) {
    setBusy(true);
    setStatus({ kind: "info", msg: `${label}: confirm in your wallet…` });
    try {
      const hash = await fn();
      setStatus({ kind: "info", msg: `${label}: waiting for confirmation…`, hash });
      const rc = await pc!.waitForTransactionReceipt({ hash });
      if (rc.status !== "success") throw new Error("transaction reverted");
      setStatus({ kind: "ok", msg: `${label} confirmed`, hash });
      refresh();
      return true;
    } catch (e: any) {
      setStatus({ kind: "err", msg: e?.shortMessage ?? e?.message ?? String(e) });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const faucet = () => run("Faucet (10,000 test USDC)", () => writeContractAsync({ address: ADDR.usdc, abi: usdcAbi, functionName: "faucet" }));

  async function mint() {
    if (!us.address) return;
    if ((us.allowance ?? 0n) < parsed) {
      const ok = await run("Approve USDC", () =>
        writeContractAsync({ address: ADDR.usdc, abi: usdcAbi, functionName: "approve", args: [ADDR.vault, maxUint256] }),
      );
      if (!ok) return;
    }
    const ok = await run(`Mint with ${fmtUsd(parsed)} USDC`, () =>
      writeContractAsync({ address: ADDR.vault, abi: vaultAbi, functionName: "deposit", args: [parsed, us.address!] }),
    );
    if (ok) setAmount("");
  }

  async function redeem(all = false) {
    if (!us.address) return;
    const ok = await run(all ? "Redeem entire position" : `Redeem ${fmtUsd(parsed)} USDC`, () =>
      all
        ? writeContractAsync({ address: ADDR.vault, abi: vaultAbi, functionName: "redeemAll", args: [us.address!] })
        : writeContractAsync({ address: ADDR.vault, abi: vaultAbi, functionName: "redeem", args: [parsed, us.address!] }),
    );
    if (ok) setAmount("");
  }

  const claim = (id: bigint) => run(`Claim request #${id}`, () => writeContractAsync({ address: ADDR.vault, abi: vaultAbi, functionName: "claim", args: [id] }));

  // -------- derived
  const belowMin = tab === "mint" && parsed > 0n && vs.minDeposit !== undefined && parsed < vs.minDeposit;
  const tooMuchUsdc = tab === "mint" && parsed > (us.usdc ?? 0n);
  const tooMuchPos = tab === "redeem" && parsed > (us.totalValue ?? 0n);
  const previewSeries = preview?.[0];
  const willLandOutstanding = previewSeries !== undefined && previewSeries !== 0n;
  const exitFee = exitPreview?.[1] ?? 0n;
  const exitBps = exitPreview?.[0] ?? 0n;
  const net = parsed > exitFee ? parsed - exitFee : 0n;
  const instant = (vs.instantLiquidity ?? 0n) < net ? vs.instantLiquidity ?? 0n : net;
  const queued = net - instant;

  const actionBtn = () => {
    if (!isConnected)
      return (
        <>
          <button className="btn block" onClick={connectWallet} disabled={connecting}>
            {connecting ? "Check your wallet…" : "Connect wallet"}
          </button>
          {walletError && <div className="notice err">{walletError}</div>}
        </>
      );
    if (wrongChain)
      return (
        <button className="btn block" onClick={() => switchChain({ chainId: hyperEvmTestnet.id })}>
          Switch to HyperEVM Testnet
        </button>
      );
    if (/^0x0+$/.test(ADDR.vault))
      return <div className="notice info">Contracts are being deployed to HyperEVM testnet. Minting opens shortly.</div>;
    if (tab === "mint")
      return (
        <button className="btn block" disabled={busy || parsed === 0n || belowMin || tooMuchUsdc} onClick={mint}>
          {(us.allowance ?? 0n) < parsed && parsed > 0n ? "Approve & mint MDELTA" : "Mint MDELTA"}
        </button>
      );
    return (
      <button className="btn block" disabled={busy || parsed === 0n || tooMuchPos} onClick={() => redeem(false)}>
        Redeem & burn
      </button>
    );
  };

  return (
    <section id="app">
      <div className="wrap">
        <div className="sec-head">
          <div className="eyebrow dark">HyperEVM testnet vault</div>
          <h2>Mint and redeem MDELTA</h2>
          <p>
            Deposit USDC to mint MidenDelta vault tokens at the live NAV. Burn them to get USDC back. Redemptions are paid in the same block
            from the liquidity buffer, and larger ones are filled pro-rata as the keeper unwinds positions.
          </p>
        </div>

        <div className="app-grid">
          {/* ---------------- action card ---------------- */}
          <div className="card">
            <div className="tabs">
              <button className={tab === "mint" ? "on" : ""} onClick={() => { setTab("mint"); setAmount(""); }}>Mint</button>
              <button className={tab === "redeem" ? "on" : ""} onClick={() => { setTab("redeem"); setAmount(""); }}>Redeem</button>
            </div>

            <div className="row" style={{ paddingTop: 0 }}>
              <span>{tab === "mint" ? "You deposit" : "You redeem (USDC value)"}</span>
              <span>
                {tab === "mint" ? "Wallet: " : "Position: "}
                <b className="num">{fmtUsd(tab === "mint" ? us.usdc : us.totalValue)} USDC</b>
              </span>
            </div>
            <div className="field">
              <input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} aria-label="Amount in USDC" />
              <button className="max" onClick={() => setAmount(formatUnits((tab === "mint" ? us.usdc : us.totalValue) ?? 0n, 6))}>MAX</button>
              <span className="unit">USDC</span>
            </div>

            <div style={{ marginTop: 14 }}>
              {tab === "mint" ? (
                <>
                  <div className="row"><span>Price per share (NAV)</span><b className="num">{vs.pps ? Number(formatUnits(vs.pps, 18)).toFixed(6) : "–"} USDC</b></div>
                  <div className="row"><span>You receive</span><b className="num">{preview ? Number(formatUnits(preview[1], 18)).toLocaleString("en-US", { maximumFractionDigits: 4 }) : "–"} shares</b></div>
                  <div className="row">
                    <span>Series (ERC-8113)</span>
                    <b>{previewSeries === undefined ? "–" : willLandOutstanding ? <span className="chip amber">Series #{String(previewSeries)} · locked until new high</span> : <span className="chip green">Lead · tradable MDELTA</span>}</b>
                  </div>
                  <div className="row"><span>Fees</span><b>0% entry, 0% management, 19.5% performance</b></div>
                  {belowMin && <div className="notice">Minimum investment is {fmtUsd(vs.minDeposit, 0)} USDC.</div>}
                  {willLandOutstanding && (
                    <div className="notice info">
                      The vault is below its high-water mark, so your deposit goes into its own series. You only pay the performance fee on
                      gains from your entry price. When the lead series sets a new high, your series is consolidated into tradable MDELTA.
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="row"><span>Dynamic exit fee</span><b className="num">{(Number(exitBps) / 100).toFixed(2)}% · {fmtUsd(exitFee)} USDC</b></div>
                  <div className="row"><span>Paid in the same block (buffer)</span><b className="num">{fmtUsd(instant)} USDC</b></div>
                  <div className="row"><span>Queued · pro-rata fill</span><b className="num">{fmtUsd(queued)} USDC</b></div>
                  <p className="hint">
                    Only net outflow pays the exit fee. The rate rises convexly with queue depth, and the fee stays in the vault for the remaining holders.
                  </p>
                  {tooMuchPos && <div className="notice">That's more than your position.</div>}
                </>
              )}
            </div>

            <div style={{ marginTop: 18 }}>{actionBtn()}</div>
            {isConnected && !wrongChain && !/^0x0+$/.test(ADDR.vault) && (
              <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                <button className="btn soft" onClick={faucet} disabled={busy}>Get 10,000 test USDC</button>
                {tab === "redeem" && (us.totalValue ?? 0n) > 0n && (
                  <button className="btn soft" onClick={() => redeem(true)} disabled={busy}>Redeem everything</button>
                )}
              </div>
            )}
            {!isConnected && <p className="hint">You'll need a little testnet HYPE for gas. The test USDC comes from the faucet button.</p>}

            {status && (
              <div className={`notice ${status.kind === "info" ? "info" : status.kind}`}>
                {status.msg}{" "}
                {status.hash && (
                  <a href={explorer(status.hash, "tx")} target="_blank" rel="noreferrer">View tx ↗</a>
                )}
              </div>
            )}
          </div>

          {/* ---------------- position card ---------------- */}
          <div className="card white">
            <h3 style={{ margin: "0 0 6px", fontSize: 20, fontWeight: 600 }}>Your position</h3>
            {!isConnected ? (
              <p className="hint">Connect a wallet to see your MDELTA balance, series and pending redemptions.</p>
            ) : (
              <>
                <div className="kpi" style={{ border: 0, padding: "10px 0" }}>
                  <div className="v num">{fmtUsd(us.totalValue)} <span style={{ fontSize: 18, color: "var(--muted)" }}>USDC</span></div>
                  <div className="k">Total value at current NAV</div>
                </div>
                <table className="table">
                  <thead>
                    <tr><th>Series</th><th className="r">Shares</th><th className="r">Value (USDC)</th></tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><span className="chip green">Lead · MDELTA</span></td>
                      <td className="r num">{us.leadShares !== undefined ? Number(formatUnits(us.leadShares, 18)).toLocaleString("en-US", { maximumFractionDigits: 4 }) : "–"}</td>
                      <td className="r num">{fmtUsd(us.leadValue)}</td>
                    </tr>
                    {us.seriesIds.map((id, i) => (
                      <tr key={String(id)}>
                        <td><span className="chip amber">Series #{String(id)}</span></td>
                        <td className="r num">{Number(formatUnits(us.seriesShares[i], 18)).toLocaleString("en-US", { maximumFractionDigits: 4 })}</td>
                        <td className="r num">{fmtUsd(us.seriesValues[i])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="sep" />
                <h4 style={{ margin: "0 0 8px", fontWeight: 600 }}>Redemption requests</h4>
                {reqs.items.length === 0 ? (
                  <p className="hint" style={{ marginTop: 0 }}>No queued redemptions.</p>
                ) : (
                  <table className="table">
                    <thead>
                      <tr><th>#</th><th className="r">Owed</th><th className="r">Filled</th><th className="r"></th></tr>
                    </thead>
                    <tbody>
                      {reqs.items.map((r) => {
                        const filledPct = r.amount > 0n ? Number(((r.amount - r.remaining) * 10000n) / r.amount) / 100 : 0;
                        return (
                          <tr key={String(r.id)}>
                            <td>{String(r.id)}</td>
                            <td className="r num">{fmtUsd(r.amount)}</td>
                            <td className="r num">{filledPct.toFixed(1)}%</td>
                            <td className="r">
                              {r.claimable > 0n ? (
                                <button className="btn" style={{ padding: "6px 12px", fontSize: 14 }} onClick={() => claim(r.id)} disabled={busy}>
                                  Claim {fmtUsd(r.claimable)}
                                </button>
                              ) : r.remaining === 0n ? (
                                <span className="chip green">Claimed</span>
                              ) : (
                                <span className="chip">Waiting for keeper</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
                <div className="sep" />
                <div className="row"><span>Instant liquidity in buffer</span><b className="num">{fmtUsd(vs.instantLiquidity)} USDC</b></div>
                <div className="row"><span>Vault redemption queue</span><b className="num">{fmtUsd(vs.totalQueued)} USDC</b></div>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
