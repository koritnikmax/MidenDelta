// Eligibility gate (spec 4.1): a self-declaration of country and investor category before any fund detail.
// It is not a geo-block; blocking US visitors at the network level needs hosting that supports it.
// Self-contained (own styles) so the performance page and the demo app can use it too.

const KEY = "md-eligibility-v1";
const VALID_DAYS = 30;

const COUNTRIES = [
  ["DE", "Germany"], ["AT", "Austria"], ["CH", "Switzerland"], ["LI", "Liechtenstein"], ["LU", "Luxembourg"],
  ["NL", "Netherlands"], ["FR", "France"], ["IT", "Italy"], ["ES", "Spain"], ["GB", "United Kingdom"],
  ["US", "United States"], ["EEA", "Other EU / EEA country"], ["OTHER", "Other country"],
];

export function isEligible() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null");
    return !!(v && v.ok && Date.now() - v.at < VALID_DAYS * 86_400_000);
  } catch {
    return false;
  }
}

function remember(country, category) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ok: true, country, category, at: Date.now() }));
  } catch {
    /* storage blocked: the visitor will be asked again next time */
  }
}

const CSS = `
.md-gate{position:fixed;inset:0;z-index:300;display:grid;place-items:center;padding:16px;background:rgba(0,0,0,.72);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);font-family:Geist,system-ui,sans-serif;color:#f5f5f5}
.md-gate__box{width:min(520px,100%);max-height:calc(100vh - 32px);overflow:auto;background:#0c0c0c;border:1px solid rgba(255,255,255,.22);border-radius:22px;padding:28px}
.md-gate h2{font-size:26px;font-weight:500;letter-spacing:-.03em;margin:0 0 10px;line-height:1.1}
.md-gate p{color:#a8a8a8;font-size:14.5px;line-height:1.55;margin:0 0 18px}
.md-gate label.f{display:block;font-size:13.5px;color:#cfcfcf;margin:0 0 6px}
.md-gate select{width:100%;min-height:46px;border-radius:10px;border:1px solid rgba(255,255,255,.22);background:#000;color:#f5f5f5;padding:10px 12px;font:inherit;font-size:15px;margin-bottom:16px}
.md-gate fieldset{border:0;padding:0;margin:0 0 16px}
.md-gate legend{font-size:13.5px;color:#cfcfcf;margin-bottom:8px;padding:0}
.md-gate .opt{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid rgba(255,255,255,.14);border-radius:10px;margin-bottom:8px;cursor:pointer;font-size:14.5px}
.md-gate .opt:has(input:checked){border-color:#fff}
.md-gate .opt small{display:block;color:#8c8c8c;font-size:12.5px;margin-top:2px}
.md-gate input[type=radio],.md-gate input[type=checkbox]{accent-color:#fff;width:18px;height:18px;margin:2px 0 0;flex:none}
.md-gate .ack{display:flex;gap:10px;align-items:flex-start;font-size:13.5px;color:#a8a8a8;margin:6px 0 18px;cursor:pointer}
.md-gate .row{display:flex;gap:10px;flex-wrap:wrap}
.md-gate button{min-height:46px;padding:0 20px;border-radius:999px;font:inherit;font-weight:500;font-size:15px;cursor:pointer;border:1px solid transparent}
.md-gate .go{background:#fff;color:#000}
.md-gate .go:disabled{opacity:.4;cursor:not-allowed}
.md-gate .back{background:transparent;color:#f5f5f5;border-color:rgba(255,255,255,.22)}
.md-gate :focus-visible{outline:1.5px solid #fff;outline-offset:3px}
.md-gated>*:not(.md-gate){filter:blur(14px);pointer-events:none;user-select:none}
`;

function injectStyles() {
  if (document.getElementById("md-gate-css")) return;
  const st = document.createElement("style");
  st.id = "md-gate-css";
  st.textContent = CSS;
  document.head.appendChild(st);
}

/**
 * @param {{ onPass: () => void, onCancel: () => void }} opts
 */
export function openGate({ onPass, onCancel }) {
  injectStyles();
  const prevFocus = document.activeElement;
  const el = document.createElement("div");
  el.className = "md-gate";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-labelledby", "md-gate-title");
  el.innerHTML = `
    <form class="md-gate__box" novalidate>
      <h2 id="md-gate-title">Before you continue</h2>
      <p>The next pages describe MidenDelta Fund, an alternative investment fund in formation. They are only for professional and semi-professional investors who are not US persons, and nothing on them is an offer to sell fund units.</p>
      <label class="f" for="md-gate-country">Country of residence</label>
      <select id="md-gate-country" required>
        <option value="">Select your country</option>
        ${COUNTRIES.map(([c, n]) => `<option value="${c}">${n}</option>`).join("")}
      </select>
      <fieldset>
        <legend>Which describes you?</legend>
        <label class="opt"><input type="radio" name="cat" value="pro" /><span>Professional investor<small>For example a bank, fund, insurer, large company or an individual treated as professional</small></span></label>
        <label class="opt"><input type="radio" name="cat" value="semi" /><span>Semi-professional investor<small>Investing at least €200,000, with the experience to assess the risks</small></span></label>
        <label class="opt"><input type="radio" name="cat" value="none" /><span>Neither of these</span></label>
      </fieldset>
      <label class="ack"><input type="checkbox" id="md-gate-ack" /><span>I confirm this is accurate and that I am not a US person.</span></label>
      <div class="row">
        <button type="submit" class="go" disabled>Continue</button>
        <button type="button" class="back">Go back</button>
      </div>
    </form>`;
  document.body.appendChild(el);
  const form = el.querySelector("form");
  const country = el.querySelector("#md-gate-country");
  const ack = el.querySelector("#md-gate-ack");
  const go = el.querySelector(".go");
  const cat = () => el.querySelector('input[name="cat"]:checked')?.value;
  const update = () => (go.disabled = !(country.value && cat() && ack.checked));
  form.addEventListener("change", update);

  const close = () => {
    el.remove();
    prevFocus?.focus?.();
  };
  el.querySelector(".back").addEventListener("click", () => {
    close();
    onCancel();
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      close();
      onCancel();
    }
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (country.value === "US" || cat() === "none") {
      el.querySelector(".md-gate__box").innerHTML = `
        <h2 id="md-gate-title">This isn't available to you</h2>
        <p>MidenDelta Fund is only open to professional and semi-professional investors who are not US persons. You're welcome to keep reading how the strategy works on the homepage.</p>
        <div class="row"><button type="button" class="back">Back to the homepage</button></div>`;
      el.querySelector(".back").addEventListener("click", () => {
        close();
        onCancel();
      });
      el.querySelector(".back").focus();
      return;
    }
    remember(country.value, cat());
    close();
    onPass();
  });
  country.focus();
}

/** Blur the current page until the visitor has passed the gate. */
export function requirePageGate({ home = "./" } = {}) {
  if (isEligible()) return;
  const start = () => {
    document.body.classList.add("md-gated");
    openGate({
      onPass: () => document.body.classList.remove("md-gated"),
      onCancel: () => (location.href = home),
    });
  };
  if (document.body) start();
  else addEventListener("DOMContentLoaded", start);
}

/** Ask for the self-declaration before following links to gated pages. */
export function guardLinks(isGated) {
  document.addEventListener("click", (e) => {
    const a = e.target.closest?.("a[href]");
    if (!a || isEligible() || !isGated(new URL(a.href, location.href))) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    openGate({ onPass: () => (location.href = a.href), onCancel: () => {} });
  }, true);
}
