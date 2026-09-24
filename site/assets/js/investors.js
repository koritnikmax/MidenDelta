import { initChrome } from "./common.js";
import { CONFIG } from "./config.js";

initChrome("investors");

const toggle = document.getElementById("seed-toggle");
const seedForm = document.getElementById("seed-form");
toggle.addEventListener("click", () => {
  seedForm.hidden = false;
  toggle.hidden = true;
  toggle.setAttribute("aria-expanded", "true");
  seedForm.querySelector("input")?.focus();
});
if (location.hash === "#seed") toggle.click();

const MESSAGES = {
  valueMissing: "This field is required.",
  typeMismatch: "Enter a valid email address.",
};

function validateField(el) {
  const err = el.type === "checkbox"
    ? el.form.querySelector(`[data-for="${el.name}"]`)
    : el.closest(".field")?.querySelector(".err");
  const bad = !el.checkValidity();
  el.setAttribute("aria-invalid", String(bad));
  const msg = bad ? (el.type === "checkbox" ? "Please confirm to continue." : el.validity.typeMismatch ? MESSAGES.typeMismatch : MESSAGES.valueMissing) : "";
  if (err) err.textContent = msg;
  return !bad;
}

async function send(kind, data) {
  if (CONFIG.formEndpoint) {
    const res = await fetch(CONFIG.formEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      // _subject sets the email subject in Formspree; the "email" field becomes the reply-to address.
      body: JSON.stringify({ form: kind, _subject: kind === "seed-inquiry" ? `Seed inquiry: ${data.firm}` : `Vault 01 waitlist: ${data.name}`, ...data }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return;
  }
  if (CONFIG.contactEmail) {
    const subject = kind === "seed-inquiry" ? `Seed inquiry: ${data.firm}` : `Vault 01 waitlist: ${data.name}`;
    const body = Object.entries(data).map(([k, v]) => `${k}: ${v}`).join("\n");
    location.href = `mailto:${CONFIG.contactEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    return;
  }
  console.warn("[MidenDelta] No formEndpoint or contactEmail set in assets/js/config.js. Submission not sent:", kind, data);
}

document.querySelectorAll("form[data-form]").forEach((form) => {
  const fields = [...form.querySelectorAll("input, select, textarea")];
  fields.forEach((el) => {
    el.addEventListener("blur", () => { if (el.value || el.type === "checkbox") validateField(el); });
    el.addEventListener("input", () => { if (el.getAttribute("aria-invalid") === "true") validateField(el); });
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const invalid = fields.filter((el) => !validateField(el));
    if (invalid.length) { invalid[0].focus(); return; }
    const btn = form.querySelector('button[type="submit"]');
    const label = btn.innerHTML;
    btn.disabled = true; btn.textContent = "Sending…";
    const data = Object.fromEntries(new FormData(form));
    try {
      await send(form.dataset.form, data);
      form.closest(".form-wrap").classList.add("sent");
      form.closest(".form-wrap").querySelector(".form-success").focus?.();
    } catch (err) {
      console.error(err);
      btn.disabled = false; btn.innerHTML = label;
      let msg = form.querySelector(".send-err");
      if (!msg) { msg = document.createElement("p"); msg.className = "err send-err"; msg.setAttribute("role", "alert"); btn.after(msg); }
      msg.textContent = "Something went wrong sending this. Please try again in a moment.";
    }
  });
});
