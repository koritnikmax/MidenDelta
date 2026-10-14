// Launch list: posts the email to a Brevo subscription form, which sends the double opt-in email.
// Every element marked [data-join] gets its own copy of the form (home page footer band, join.html).
// Nothing is stored in the browser; the "not confirmed yet" state only lasts for this page view.
import { CONFIG } from "./config.js";

const ARROW = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;

const markup = (n) => `
  <form class="join-form" novalidate>
    <label class="sr-only" for="join-email-${n}">Email address</label>
    <div class="join-row">
      <input id="join-email-${n}" name="email" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" required />
      <button class="btn btn-primary" type="submit">Join ${ARROW}</button>
    </div>
    <p class="join-legal">By joining you agree to receive emails about the MidenDelta launch and new strategies. You can withdraw at any time. Details in our <a href="datenschutz.html">privacy policy</a>.</p>
    <p class="join-err" role="alert"></p>
  </form>
  <div class="join-pending" tabindex="-1" aria-live="polite">
    <span class="join-status"><i></i>Not confirmed yet</span>
    <h3>One more step: check your inbox.</h3>
    <p>We've sent a confirmation link to <b class="mono join-sent-to"></b>. Under EU data protection rules we can only add you once you click it.</p>
    <p class="join-hint">Nothing after a few minutes? Look in your spam or promotions folder, or <button type="button" class="link-btn join-again">use a different address</button>.</p>
  </div>`;

function mount(box, n) {
  box.dataset.state = "form";
  box.innerHTML = markup(n);
  const form = box.querySelector(".join-form");
  const input = box.querySelector("input");
  const err = box.querySelector(".join-err");
  const button = form.querySelector("button[type=submit]");

  const setState = (state) => {
    box.dataset.state = state;
    if (state === "pending") box.querySelector(".join-pending").focus({ preventScroll: true });
    if (state === "form") input.focus();
  };

  input.addEventListener("input", () => { err.textContent = ""; input.removeAttribute("aria-invalid"); });
  box.querySelector(".join-again").addEventListener("click", () => { input.value = ""; setState("form"); });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = input.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      err.textContent = "Please enter a valid email address.";
      input.setAttribute("aria-invalid", "true");
      input.focus();
      return;
    }
    button.disabled = true;
    try {
      if (!CONFIG.brevoFormUrl) throw new Error("CONFIG.brevoFormUrl is not set");
      const data = new FormData();
      data.append("EMAIL", email);
      data.append("email_address_check", ""); // Brevo's spam honeypot, must stay empty
      data.append("locale", "en");
      const url = CONFIG.brevoFormUrl + (CONFIG.brevoFormUrl.includes("?") ? "&" : "?") + "isAjax=1";
      const res = await fetch(url, { method: "POST", body: data });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || result.success === false) throw new Error(result.message || res.status);
      box.querySelector(".join-sent-to").textContent = email;
      setState("pending");
    } catch (ex) {
      console.error("Launch list signup failed:", ex);
      err.textContent = "That didn't go through. Please try again in a moment.";
    } finally {
      button.disabled = false;
    }
  });
}

export function initJoin() {
  document.querySelectorAll("[data-join]").forEach((box, i) => mount(box, i));
}
