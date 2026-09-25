// Site-wide settings. Edit these before going live.
export const CONFIG = {
  // Where the testnet demo (the /web app) is served. The GitHub Pages workflow publishes it under /demo/.
  demoUrl: "demo/",

  // Backtest report for Vault 01 (performance.html is the research note from MidenDelta-Carry-Backtest.html).
  performanceUrl: "performance.html",

  // POST endpoint for the investor forms (e.g. a Formspree / Basin / Getform URL, or your own API).
  // Receives JSON: { form: "vault-waitlist" | "seed-inquiry", ...fields }.
  // Leave empty to fall back to a pre-filled email to `contactEmail`.
  formEndpoint: "https://formspree.io/f/meaozrvw",

  // Fallback inbox for the investor forms when no endpoint is set. Leave empty while previewing.
  contactEmail: "",

  // Pre-AIFM mode. Keep false until the fund is authorised and an AIFM has notified BaFin for marketing
  // (KAGB §§ 306b, 321/323): hides fund terms, fees, allocation sizes and the backtest. Elements marked
  // data-fund-only appear only when true; elements marked data-pre-only appear only when false.
  fundMarketing: false,

  // Vault 01 terms shown across the site.
  vault: {
    capUsd: 10_000_000,
    minDepositUsd: 1_000,
    perfFee: "19.5%",
    mgmtFee: "0%",
  },
};
