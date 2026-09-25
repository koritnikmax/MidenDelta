# MidenDelta marketing site

Static site with no build step. Three.js and Lenis load from jsDelivr through an import map.

```
index.html       scroll story: subscribe → issue → inside the fund → delta 0 → carry → security; fund structure
investors.html   eligibility-gated: Vault 01 terms, waitlist, seed inquiries, FAQ
team.html        founders (edit assets/js/team.js, photos in assets/team/)
performance.html eligibility-gated backtest at the 3x leverage cap
assets/js/scene.js   the 3D scene; everything is driven by story time t (0 → 12)
assets/js/config.js  demo URL, form endpoint, contact email, vault terms
assets/js/gate.js    self-declaration gate (country + investor category) before fund details; not a geo-block
```

Preview locally:

```bash
python3 -m http.server 5174 --directory site
```

Before launch:
- Set `formEndpoint` (e.g. Formspree) or `contactEmail` in `assets/js/config.js`. Until one is set, forms only log to the console.
- Add `assets/team/max.jpg` and `assets/team/david.jpg`, plus bios, roles and LinkedIn URLs in `assets/js/team.js`.

Deploy: `.github/workflows/pages.yml` publishes this folder at the Pages root and the `web/` demo app under `/demo/`.
