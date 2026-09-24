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

  // Vault 01 terms shown across the site.
  vault: {
    capUsd: 10_000_000,
    minDepositUsd: 1_000,
    perfFee: "19.5%",
    mgmtFee: "0%",
  },
};
