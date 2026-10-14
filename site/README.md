# MidenDelta marketing site

Static site with no build step. Everything is self-hosted (no CDN, no Google Fonts): three.js, Lenis and Chart.js in
`assets/vendor/`, Geist fonts in `assets/fonts/` (SIL OFL). No cookies and nothing in browser storage.

```
index.html       scroll story: coin into the piggy bank → method → library → strategy 01 on the scale → chart → services; library
investors.html   eligibility-gated: Vault 01 terms, waitlist, seed inquiries, FAQ
performance.html strategy 01 backtest: simulated ETH carry at 3x, same design as the home page
impressum.html, datenschutz.html   legal notice and privacy policy (German)
assets/js/scene.js   the 3D scene (white studio podium); everything is driven by story time t (0 → 12)
assets/js/chartdata.js  weekly ETH close vs. simulated cash and carry, drawn on the home page
assets/js/config.js  YouTube URL, demo URL, form endpoint, vault terms, fundMarketing (pre-AIFM mode switch)
assets/js/gate.js    self-declaration gate (country + investor category) before fund details; stores nothing, not a geo-block
```

Preview locally:

```bash
python3 -m http.server 5174 --directory site
```

Before launch:
- Set `formEndpoint` (e.g. Formspree) or `contactEmail` in `assets/js/config.js`. Until one is set, forms only log to the console.
- Set `youtubeUrl` in `assets/js/config.js` to show the YouTube buttons.

Deploy: `.github/workflows/pages.yml` publishes this folder at the Pages root and the `web/` demo app under `/demo/`.
