// Launch list: posts the email to a Brevo subscription form, which sends the double opt-in email.
// Nothing is stored in the browser; the "not confirmed yet" state only lasts for this page view.
import { CONFIG } from "./config.js";

export function initJoin() {
  const box = document.getElementById("join-box");
  if (!box) return;
  const form = document.getElementById("join-form");
  const input = document.getElementById("join-email");
  const err = document.getElementById("join-err");
  const button = form.querySelector("button[type=submit]");

  const setState = (state) => {
    box.dataset.state = state;
    if (state === "pending") document.getElementById("join-pending").focus({ preventScroll: true });
    if (state === "form") input.focus();
  };

  input.addEventListener("input", () => { err.textContent = ""; input.removeAttribute("aria-invalid"); });
  document.getElementById("join-again").addEventListener("click", () => { input.value = ""; setState("form"); });

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
      document.getElementById("join-sent-to").textContent = email;
      setState("pending");
    } catch (ex) {
      console.error("Launch list signup failed:", ex);
      err.textContent = "That didn't go through. Please try again in a moment.";
    } finally {
      button.disabled = false;
    }
  });
}
