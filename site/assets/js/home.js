import { initChrome, reducedMotion, scrollToY } from "./common.js";
import { CONFIG } from "./config.js";
import { SERIES } from "./chartdata.js";
import { initJoin } from "./join.js";

initChrome("home");
initJoin();
document.querySelectorAll("[data-youtube]").forEach((a) => {
  if (!CONFIG.youtubeUrl) return;
  a.href = CONFIG.youtubeUrl;
  a.hidden = false;
});

const T_MAX = 12;
const story = document.getElementById("story");
const canvas = document.getElementById("scene");
const stage = story.querySelector(".story-stage");
const cue = document.getElementById("scroll-cue");
const bar = document.getElementById("progress-line");
const rail = document.getElementById("rail");
const fades = [...story.querySelectorAll("[data-in]")].map((el) => ({ el, a: +el.dataset.in, b: +el.dataset.out, blur: el.hasAttribute("data-blur") }));

const CHAPTERS = [
  ["Intro", 0], ["The problem", 1.1], ["The method", 2.1], ["The library", 3.1], ["Strategy 01", 4.1],
  ["Delta 0", 6.05], ["Carry", 7.05], ["Record & service", 11.6],
];
rail.innerHTML = CHAPTERS.map(([name]) => `<button type="button"><span>${name}</span></button>`).join("");
const railBtns = [...rail.children];
railBtns.forEach((b, i) => {
  b.setAttribute("aria-label", `Go to chapter: ${CHAPTERS[i][0]}`);
  b.addEventListener("click", () => scrollToY(yForT(CHAPTERS[i][1])));
});

const storyTop = () => story.getBoundingClientRect().top + scrollY;
const storyLen = () => story.offsetHeight - innerHeight;
const yForT = (t) => storyTop() + (t / T_MAX) * storyLen();
const tForScroll = () => {
  const len = storyLen();
  return len > 0 ? Math.min(T_MAX, Math.max(0, ((scrollY - storyTop()) / len) * T_MAX)) : 0;
};

// Copy eases in; items marked data-blur also resolve from soft focus, like a lens pulling focus.
const ease = (x) => 1 - Math.pow(1 - x, 3);
const fade = (t, a, b, span) => {
  const inK = ease(Math.min(1, Math.max(0, (t - (a - span)) / span)));
  const outK = Math.min(1, Math.max(0, (t - b) / 0.22));
  return { o: inK * (1 - outK), dy: (1 - inK) * 26 - outK * 22, blur: (1 - inK) * 10 + outK * 6 };
};

let scene = null;
let lastT = -1;

function renderOverlay(t) {
  for (const { el, a, b, blur } of fades) {
    const { o, dy, blur: bl } = fade(t, a, b, blur ? 0.34 : 0.24);
    el.style.setProperty("--blur", `${(blur ? bl : bl * 0.4).toFixed(2)}px`);
    el.style.opacity = o.toFixed(3);
    el.style.visibility = o > 0.001 ? "visible" : "hidden";
    el.style.setProperty("--dy", `${dy.toFixed(1)}px`);
    el.classList.toggle("is-live", o > 0.5);
  }
  cue.style.opacity = t < 0.15 ? 1 : 0;
  bar.style.setProperty("--p", (t / T_MAX).toFixed(4));
  const hero = 1 - Math.min(1, t / 0.6);
  const sec = Math.min(1, Math.max(0, (t - 8.5) / 0.4));
  stage.style.setProperty("--vl", (1 - 0.3 * hero - Math.min(1, Math.max(0, (t - 7.6) / 0.5))).toFixed(3));
  stage.style.setProperty("--vr", sec.toFixed(3));
  let active = 0;
  CHAPTERS.forEach(([, ct], i) => { if (t >= ct - 0.6) active = i; });
  railBtns.forEach((b, i) => b.classList.toggle("active", i === active));
  rail.style.opacity = t < 0.3 || t > 8.1 ? 0 : 1;
  rail.style.pointerEvents = t < 0.3 || t > 8.1 ? "none" : "";
  drawChart(t);
}

// The record (step 08): ETH and the cash and carry, both as % change since the first week, drawn with the scroll.
const CH = { w: 560, h: 260, padL: 34, padR: 8, padT: 10, padB: 22, yMin: -20, yMax: 180 };
const N = SERIES.length;
const p0 = SERIES[0][1];
const ethPct = SERIES.map((r) => (r[1] / p0 - 1) * 100);
const carryPct = SERIES.map((r) => r[2]);
const cx = (i) => CH.padL + (i / (N - 1)) * (CH.w - CH.padL - CH.padR);
const cy = (v) => CH.padT + (1 - (v - CH.yMin) / (CH.yMax - CH.yMin)) * (CH.h - CH.padT - CH.padB);
const chartEls = {
  eth: document.getElementById("ln-eth"), carry: document.getElementById("ln-carry"),
  dEth: document.getElementById("dot-eth"), dCarry: document.getElementById("dot-carry"),
  date: document.getElementById("ch-date"), vEth: document.getElementById("ch-eth"),
  vCarry: document.getElementById("ch-carry"), vPrice: document.getElementById("ch-price"),
};
(function drawGrid() {
  const g = document.getElementById("ch-grid");
  let html = "";
  for (let v = 0; v <= 150; v += 50)
    html += `<line x1="${CH.padL}" x2="${CH.w - CH.padR}" y1="${cy(v)}" y2="${cy(v)}"${v === 0 ? ' class="zero"' : ""}/><text x="0" y="${cy(v) + 4}">${v > 0 ? "+" : ""}${v}%</text>`;
  SERIES.forEach((r, i) => {
    if (i > 0 && r[0].slice(0, 4) !== SERIES[i - 1][0].slice(0, 4)) html += `<text class="yr" x="${cx(i)}" y="${CH.h - 4}">${r[0].slice(0, 4)}</text>`;
  });
  g.innerHTML = html;
})();
const pct = (v) => (v < 0 ? "−" : "+") + Math.abs(v).toFixed(1) + "%";
const monthFmt = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
let lastChart = -1;
function drawChart(t) {
  const p = Math.min(1, Math.max(0, (t - 8.35) / (11.6 - 8.35)));
  if (!Number.isFinite(p) || Math.abs(p - lastChart) < 1e-4) return;
  lastChart = p;
  const x = Math.max(0.0001, p) * (N - 1), i = Math.floor(x), f = x - i;
  const at = (arr) => (i >= N - 1 ? arr[N - 1] : arr[i] + (arr[i + 1] - arr[i]) * f);
  const line = (arr) => {
    let d = "";
    for (let j = 0; j <= Math.min(i, N - 1); j++) d += (j ? "L" : "M") + cx(j).toFixed(1) + " " + cy(arr[j]).toFixed(1);
    return d + "L" + cx(x).toFixed(1) + " " + cy(at(arr)).toFixed(1);
  };
  const e = at(ethPct), c = at(carryPct);
  chartEls.eth.setAttribute("d", line(ethPct));
  chartEls.carry.setAttribute("d", line(carryPct));
  chartEls.dEth.setAttribute("cx", cx(x)); chartEls.dEth.setAttribute("cy", cy(e));
  chartEls.dCarry.setAttribute("cx", cx(x)); chartEls.dCarry.setAttribute("cy", cy(c));
  chartEls.vEth.textContent = pct(e);
  chartEls.vCarry.textContent = pct(c);
  chartEls.vPrice.textContent = "$" + Math.round(p0 * (1 + e / 100)).toLocaleString("en-US");
  chartEls.date.textContent = monthFmt.format(new Date(SERIES[Math.min(N - 1, Math.round(x))][0] + "T00:00:00Z"));
}

function onScroll() {
  const t = tForScroll();
  scene?.setProgress(t);
  // Text follows the scene's smoothed clock so copy and 3D stay in lock-step.
  if (!scene) renderOverlay(t);
}
addEventListener("scroll", onScroll, { passive: true });
addEventListener("resize", onScroll);

// Price ticker (step 06)
const fmt = (n) => (n < 0 ? "−" : "+") + "$" + Math.abs(Math.round(n)).toLocaleString("en-US");
const tkPrice = document.getElementById("tk-price");
const tkSpot = document.getElementById("tk-spot");
const tkPerp = document.getElementById("tk-perp");

function tick({ t, price, spotPnl }) {
  if (Math.abs(t - lastT) > 1e-4) { renderOverlay(t); lastT = t; }
  if (t > 5.4 && t < 6.7) {
    tkPrice.textContent = "$" + Math.round(price).toLocaleString("en-US");
    tkSpot.textContent = fmt(spotPnl);
    tkPerp.textContent = fmt(-spotPnl);
  }
}

function hasWebGL() {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; }
}

renderOverlay(tForScroll());

if (hasWebGL()) {
  import("./scene.js")
    .then(({ createScene }) => createScene(canvas, { reducedMotion }))
    .then((s) => {
      scene = s;
      scene.onTick(tick);
      scene.jump(tForScroll());
      new IntersectionObserver(([e]) => scene.setVisible(e.isIntersecting)).observe(story);
    })
    .catch((err) => { console.error(err); document.documentElement.classList.add("no-webgl"); });
} else {
  document.documentElement.classList.add("no-webgl");
}
