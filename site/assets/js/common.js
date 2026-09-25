// Shared chrome for every page: header, full-screen menu, footer, smooth scroll, reveal-on-scroll.
import Lenis from "lenis";
import { CONFIG } from "./config.js";
import { guardLinks } from "./gate.js";

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
      <a class="btn btn-ghost btn-sm header-demo" href="${CONFIG.performanceUrl}">Performance</a>
      <a class="btn btn-ghost btn-sm header-demo" href="${CONFIG.demoUrl}">Launch demo</a>
      <button class="menu-btn" id="menu-btn" aria-expanded="false" aria-controls="menu" aria-label="Open menu"><span></span><span></span></button>
    </div>
  </header>
  <div class="menu" id="menu" role="dialog" aria-modal="true" aria-label="Site menu">
    <nav>
      <a class="menu-link" href="./"${cur("home")}><small>01</small>How it works</a>
      <a class="menu-link" href="${CONFIG.demoUrl}"><small>02</small>Demo <span class="menu-tag">Testnet</span></a>
      <a class="menu-link" href="${CONFIG.performanceUrl}"><small>03</small>Performance <span class="menu-tag">Backtest</span></a>
      <a class="menu-link" href="investors.html"${cur("investors")}><small>04</small>Investors ${ARROW}</a>
      <a class="menu-link" href="team.html"${cur("team")}><small>05</small>Team</a>
    </nav>
    <aside>
      ${logoSvg("mark-lg", true)}
      <p>MidenDelta runs institutional strategies as a regulated fund with on-chain units. Vault 01 is a delta-neutral ETH cash and carry for professional investors.</p>
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
        <p style="margin-top:14px;max-width:38ch">The next-gen hedge fund: regulated execution with on-chain units and on-chain execution.</p>
      </div>
      <div><h4>Explore</h4><ul>
        <li><a href="./">How it works</a></li>
        <li><a href="${CONFIG.demoUrl}">Testnet demo</a></li>
        <li><a href="${CONFIG.performanceUrl}">Performance</a></li>
        <li><a href="team.html">Team</a></li>
      </ul></div>
      <div><h4>Invest</h4><ul>
        <li><a href="investors.html#vault">Vault 01 waitlist</a></li>
        <li><a href="investors.html#seed">Seed round</a></li>
      </ul></div>
    </div>
    <p class="disclaimer">© ${y} MidenDelta. MidenDelta Fund is an alternative investment fund in formation in Liechtenstein, to be managed by a licensed AIFM. Fund units are available only to professional and semi-professional investors, and not to US persons. Nothing on this website is an offer to sell, or a solicitation of an offer to buy, fund units; any offering will be made only under the fund's offering documents. Vault 01 currently runs as a testnet prototype on HyperEVM and its smart contracts have not yet been audited. The strategy involves risk, including loss of capital: returns vary and can be negative, and a delta-neutral position remains exposed to funding-rate, basis, execution, venue and smart-contract risk. Past or simulated performance is not a reliable indicator of future results.</p>
  </footer>`;
}

export let lenis = null;

export function initChrome(page) {
  document.body.insertAdjacentHTML("afterbegin", header(page));
  document.body.insertAdjacentHTML("beforeend", footer());
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
  guardLinks((u) => u.origin === location.origin && (/(investors|performance)\.html$/.test(u.pathname) || /\/demo\/?/.test(u.pathname)));

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
