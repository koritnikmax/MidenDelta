# MidenDelta marketing site

Static site with no build step. Everything is self-hosted (no CDN, no Google Fonts): three.js, Lenis and Chart.js in
`assets/vendor/`, Geist fonts in `assets/fonts/` (SIL OFL). No cookies and nothing in browser storage.

```
index.html       scroll story: subscribe → issue → inside the fund → delta 0 → carry → security; fund structure
investors.html   eligibility-gated: Vault 01 terms, waitlist, seed inquiries, FAQ
team.html        founders (edit assets/js/team.js, photos in assets/team/)
performance.html public strategy research: simulated ETH carry backtest at 3x (no fund terms or fees)
impressum.html, datenschutz.html   legal notice and privacy policy (German)
assets/js/scene.js   the 3D scene; everything is driven by story time t (0 → 12)
assets/js/config.js  demo URL, form endpoint, vault terms, fundMarketing (pre-AIFM mode switch)
assets/js/gate.js    self-declaration gate (country + investor category) before fund details; stores nothing, not a geo-block
```

Preview locally:

```bash
python3 -m http.server 5174 --directory site
```

Before launch:
- Set `formEndpoint` (e.g. Formspree) or `contactEmail` in `assets/js/config.js`. Until one is set, forms only log to the console.
- Add `assets/team/max.jpg` and `assets/team/david.jpg`, plus bios, roles and LinkedIn URLs in `assets/js/team.js`.

Deploy: `.github/workflows/pages.yml` publishes this folder at the Pages root and the `web/` demo app under `/demo/`.
