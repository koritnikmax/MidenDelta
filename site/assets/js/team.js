import { initChrome } from "./common.js";

// Edit the team here. Drop photos into assets/team/ (portrait, ~1200×1320 px works well).
// Until a photo exists, the card shows the person's initials.
const TEAM = [
  {
    name: "Max Koritnik",
    role: "Co-Founder",
    photo: "assets/team/max.jpg",
    bio: "Bio coming soon.",
    linkedin: "",
  },
  {
    name: "David",
    role: "Co-Founder",
    photo: "assets/team/david.jpg",
    bio: "Bio coming soon.",
    linkedin: "",
  },
];

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const initials = (n) => n.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
const LI = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM3 9h4v12H3zM9 9h3.8v1.7h.05c.53-1 1.83-2.05 3.77-2.05C20.6 8.65 21 11.2 21 14.5V21h-4v-5.8c0-1.4-.03-3.2-1.95-3.2-1.95 0-2.25 1.52-2.25 3.1V21H9z"/></svg>`;

document.getElementById("team").innerHTML = TEAM.map((m, i) => `
  <article class="member reveal" data-delay="${i + 1}">
    <div class="photo">
      <span class="mono-init" aria-hidden="true">${initials(m.name)}</span>
      <img src="${esc(m.photo)}" alt="Portrait of ${esc(m.name)}" loading="lazy" onerror="this.remove()" />
    </div>
    <div class="body">
      <h2>${esc(m.name)}</h2>
      <div class="role">${esc(m.role)}</div>
      <p class="bio">${esc(m.bio)}</p>
      ${m.linkedin ? `<div class="links"><a class="icon-link" href="${esc(m.linkedin)}" target="_blank" rel="noopener" aria-label="${esc(m.name)} on LinkedIn">${LI}</a></div>` : ""}
    </div>
  </article>`).join("");

initChrome("team");
