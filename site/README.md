# MidenDelta marketing site

Static site with no build step. Three.js and Lenis load from jsDelivr through an import map.

```
index.html       scroll story: deposit → mint → inside the vault → delta 0 → carry → security
investors.html   Vault 01 waitlist ($10M cap, 0% perf. fee year one) + seed inquiries
team.html        founders (edit assets/js/team.js, photos in assets/team/)
assets/js/scene.js   the 3D scene; everything is driven by story time t (0 → 10.5)
assets/js/config.js  demo URL, form endpoint, contact email, vault terms
```

Preview locally:

```bash
python3 -m http.server 5174 --directory site
```

Before launch:
- Set `formEndpoint` (e.g. Formspree) or `contactEmail` in `assets/js/config.js`. Until one is set, forms only log to the console.
- Add `assets/team/max.jpg` and `assets/team/david.jpg`, plus bios, roles and LinkedIn URLs in `assets/js/team.js`.

Deploy: `.github/workflows/pages.yml` publishes this folder at the Pages root and the `web/` demo app under `/demo/`.
