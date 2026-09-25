/**
 * EUR per USD for the testnet NAV, from the ECB reference rates (frankfurter.app, no key needed).
 * In production the fund administrator strikes both the USD and the EUR NAV; this only stands in for it on testnet.
 */
export async function eurPerUsd(): Promise<number> {
  try {
    const r = await fetch("https://api.frankfurter.app/latest?from=USD&to=EUR");
    const j = (await r.json()) as { rates: { EUR: number } };
    if (j.rates?.EUR > 0) return j.rates.EUR;
  } catch {
    /* fall through */
  }
  return 0.92;
}
