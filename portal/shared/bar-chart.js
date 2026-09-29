// <portal-bar-chart> — compact horizontal bar list: label | proportional bar | value text.
// Reusable for any "compare N things on one measure" view (tool-group share, per-model usage).
//
// Usage: set `.rows` to [{ label, value, text?, tone?, title? }]. `value` sizes the bar relative
// to the largest row; `text` is the right-hand label (defaults to the raw value); `tone` is
// "warn" | "ok" | "danger" | omitted (accent); `title` is a hover tooltip carrying detail that
// would otherwise clutter the row. Styling uses the page's CSS variables (they inherit through
// the shadow root), so it follows the light/dark theme with no extra stylesheet.
const STYLE = `
  :host { display: block; }
  .row { display: grid; grid-template-columns: minmax(80px, 160px) 1fr minmax(48px, auto);
    align-items: center; gap: 10px; padding: 5px 0; font-size: var(--text-xs, 13px); }
  .label { color: var(--ink); font-weight: 600; overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap; text-align: right; }
  .track { display: block; height: 10px; background: var(--raised); border-radius: 3px; overflow: hidden; }
  .bar { display: block; height: 100%; min-width: 2px; border-radius: 3px; background: var(--accent); }
  .bar.warn { background: var(--warn); }
  .bar.ok { background: var(--ok); }
  .bar.danger { background: var(--danger); }
  .text { color: var(--dim); font-variant-numeric: tabular-nums; white-space: nowrap; }
`;

class PortalBarChart extends HTMLElement {
  #rows = [];

  connectedCallback() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this.#render();
  }

  get rows() { return this.#rows; }
  set rows(value) {
    this.#rows = Array.isArray(value) ? value : [];
    if (this.shadowRoot) this.#render();
  }

  #render() {
    const max = Math.max(...this.#rows.map((r) => r.value || 0), 0.0001);
    const root = this.shadowRoot;
    root.replaceChildren();
    const style = document.createElement("style");
    style.textContent = STYLE;
    root.appendChild(style);
    for (const r of this.#rows) {
      const row = document.createElement("div");
      row.className = "row";
      if (r.title) row.title = r.title;
      const label = document.createElement("span");
      label.className = "label";
      label.textContent = r.label;
      const track = document.createElement("span");
      track.className = "track";
      const bar = document.createElement("span");
      bar.className = "bar" + (r.tone ? " " + r.tone : "");
      bar.style.width = ((r.value || 0) / max) * 100 + "%";
      track.appendChild(bar);
      const text = document.createElement("span");
      text.className = "text";
      text.textContent = r.text ?? String(r.value ?? "");
      row.append(label, track, text);
      root.appendChild(row);
    }
  }
}

if (!customElements.get("portal-bar-chart")) customElements.define("portal-bar-chart", PortalBarChart);
