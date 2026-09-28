export function conditionTemplate(id) {
  return document.getElementById(id).content.firstElementChild.cloneNode(true);
}

export function setText(parent, selector, text) {
  parent.querySelector(selector).textContent = text;
}

export function shortDate(value) {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "Time unknown";
}
