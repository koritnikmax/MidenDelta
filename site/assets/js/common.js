// Shared chrome for every page: header, full-screen menu, footer, smooth scroll, reveal-on-scroll.
import Lenis from "lenis";
import { CONFIG } from "./config.js";
import { guardLinks } from "./gate.js";

// Set before first paint of the injected chrome so fund-only content never flashes.
if (CONFIG.fundMarketing) document.documentElement.classList.add("fund-on");

export const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// The mark: a filigree delta inscribed in an open circle that touches all three corners.
// Delta inside zero: the delta-neutral strategy. Geometry in a 100×100 box, circumradius 44.
const TRI = "M0,-44 L38.105,22 L-38.105,22 Z";
const TRI_IN = "M0,-33 L28.579,16.5 L-28.579,16.5 Z";
const CORNERS = [[0, -44], [38.105, 22], [-38.105, 22]];

export function logoSvg(cls = "brand-mark", large = false) {
  // Small marks keep fixed pixel strokes so they stay crisp at 24–40px; large marks scale with the drawing.
  const ns = large ? "" : ' vector-effect="non-scaling-stroke"';
  const [c, o, i, d] = large ? [0.9, 1.3, 0.45, 1.5] : [1.2, 1.7, 0.75, 3.2];
  return `<svg class="${cls}" viewBox="-50 -50 100 100" aria-hidden="true" fill="none" stroke="currentColor" stroke-linejoin="miter">
    <circle r="44" stroke-width="${c}"${ns}/>
    <path d="${TRI}" stroke-width="${o}"${ns}/>
    <path d="${TRI_IN}" stroke-width="${i}" opacity=".55"${ns}/>
    ${CORNERS.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${d}" fill="currentColor" stroke="none"/>`).join("")}
  </svg>`;
}

const ARROW = `<svg class="menu-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg>`;

function header(page) {
  const cur = (p) => (p === page ? ' aria-current="page"' : "");
  return `
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header" id="site-header">
    <a class="brand" href="./" aria-label="MidenDelta home">${logoSvg()}<span class="brand-name">Miden<b>Delta</b></span></a>
    <div class="header-actions">
      <a class="btn btn-ghost btn-sm header-demo" href="./#library">Strategies</a>
      <a class="btn btn-ghost btn-sm header-demo" href="${CONFIG.performanceUrl}">Backtest</a>
      <button class="menu-btn" id="menu-btn" aria-expanded="false" aria-controls="menu" aria-label="Open menu"><span></span><span></span></button>
    </div>
  </header>
  <div class="menu" id="menu" role="dialog" aria-modal="true" aria-label="Site menu">
    <nav>
      <a class="menu-link" href="./"${cur("home")}><small>01</small>How it works</a>
      <a class="menu-link" href="./#library"><small>02</small>Strategies</a>
      <a class="menu-link" href="${CONFIG.performanceUrl}"${cur("performance")}><small>03</small>Backtest <span class="menu-tag">Simulated</span></a>
    </nav>
    <aside>
      ${logoSvg("mark-lg", true)}
      <p>MidenDelta explains the strategies institutional desks run, from the theory to a working position. Strategy 01 is the ETH cash and carry.</p>
    </aside>
  </div>`;
}

function footer() {
  const y = new Date().getFullYear();
  return `
  <footer class="site-footer">
    <div class="footer-grid">
      <div>
        <a class="brand" href="./" aria-label="MidenDelta home">${logoSvg()}<span class="brand-name">Miden<b>Delta</b></span></a>
        <p style="margin-top:14px;max-width:38ch">Hedge fund strategies, from the theory to the exact setup.</p>
      </div>
      <div><h4>Explore</h4><ul>
        <li><a href="./">How it works</a></li>
        <li><a href="./#library">Strategies</a></li>
        <li><a href="${CONFIG.performanceUrl}">Backtest (simulated)</a></li>
      </ul></div>
      ${CONFIG.youtubeUrl ? `<div><h4>Watch</h4><ul><li><a href="${CONFIG.youtubeUrl}">YouTube</a></li></ul></div>` : ""}
    </div>
    <p class="legal-links"><a href="impressum.html">Impressum</a><a href="datenschutz.html">Datenschutz</a><span>No cookies, no tracking.</span></p>
    <p class="disclaimer">© ${y} MidenDelta. MidenDelta is financial education. Nothing on this website or in our videos is investment advice, a recommendation to buy or sell anything, or an offer of a financial product; decide for yourself and, if in doubt, ask a licensed adviser. Some links to exchanges are affiliate links: if you sign up through them, we may receive a commission at no extra cost to you. Trading derivatives with leverage carries a high risk of losing money. A delta-neutral position is still exposed to funding-rate, basis, execution, liquidation, exchange and smart-contract risk, and funding can turn negative. Figures shown are simulated from historical data and are not a track record; past or simulated performance is not a reliable indicator of future results.</p>
  </footer>`;
}

export let lenis = null;

export function initChrome(page) {
  document.body.insertAdjacentHTML("afterbegin", header(page));
  document.body.insertAdjacentHTML("beforeend", footer());
  // Pre-AIFM mode: remove fund-only content (not just hide it) so hidden required fields can't block forms.
  if (!CONFIG.fundMarketing) document.querySelectorAll("[data-fund-only]").forEach((el) => el.remove());
  document.querySelectorAll("[data-logo]").forEach((el) => (el.innerHTML = logoSvg("mark-lg", true)));

  const root = document.documentElement;
  const btn = document.getElementById("menu-btn");
  const menu = document.getElementById("menu");
  const setOpen = (open) => {
    root.classList.toggle("menu-open", open);
    btn.setAttribute("aria-expanded", String(open));
    btn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    menu.inert = !open;
    if (lenis) open ? lenis.stop() : lenis.start();
    document.body.style.overflow = open ? "hidden" : "";
    if (open) menu.querySelector(".menu-link")?.focus({ preventScroll: true });
  };
  menu.inert = true;
  btn.addEventListener("click", () => setOpen(!root.classList.contains("menu-open")));
  addEventListener("keydown", (e) => { if (e.key === "Escape" && root.classList.contains("menu-open")) { setOpen(false); btn.focus(); } });
  menu.addEventListener("click", (e) => { if (e.target.closest("a")) setOpen(false); });

  if (!reducedMotion) {
    lenis = new Lenis({ duration: 1.15, smoothWheel: true, easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)) });
    const raf = (t) => { lenis.raf(t); requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
    document.addEventListener("click", (e) => {
      const a = e.target.closest('a[href^="#"]');
      if (!a || a.getAttribute("href").length < 2) return;
      const el = document.querySelector(a.getAttribute("href"));
      if (el) { e.preventDefault(); lenis.scrollTo(el, { offset: -80 }); }
    });
  }

  // fund details sit behind the eligibility self-declaration
  guardLinks((u) => u.origin === location.origin && (/investors\.html$/.test(u.pathname) || /\/demo\/?/.test(u.pathname)));

  const hdr = document.getElementById("site-header");
  const onScroll = () => hdr.classList.toggle("scrolled", scrollY > 24);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  const io = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
  }, { rootMargin: "0px 0px -10% 0px" });
  document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
}

export function scrollToY(y) {
  if (lenis) lenis.scrollTo(y, { duration: 1.6 });
  else scrollTo({ top: y, behavior: reducedMotion ? "auto" : "smooth" });
}
