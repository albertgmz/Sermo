// The visitor's width choice. The source of truth is data-width="narrow" on <html> (the container
// width is a CSS variable switched by it); localStorage only keeps it between visits, best effort.
// The script runs in <head> before first paint.
const WIDTH_KEY = "sermo-width";
const WIDTH_ATTRIBUTE = "data-width";

export const widthScript = `(function(){try{if(localStorage.getItem(${JSON.stringify(WIDTH_KEY)})==="narrow")document.documentElement.setAttribute(${JSON.stringify(WIDTH_ATTRIBUTE)},"narrow")}catch(e){}})()`;

const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function stored() {
  try {
    return localStorage.getItem(WIDTH_KEY) === "narrow";
  } catch {
    return false;
  }
}

function apply(narrow: boolean) {
  if (narrow) document.documentElement.setAttribute(WIDTH_ATTRIBUTE, "narrow");
  else document.documentElement.removeAttribute(WIDTH_ATTRIBUTE);
}

// Another tab changed the choice: this page follows it.
function onStorage(event: { key: string | null }) {
  if (event.key !== null && event.key !== WIDTH_KEY) return;
  apply(stored());
  notify();
}

export function subscribeNarrow(listener: () => void) {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

export function isNarrow() {
  return document.documentElement.getAttribute(WIDTH_ATTRIBUTE) === "narrow";
}

export function setNarrow(narrow: boolean) {
  apply(narrow);
  try {
    if (narrow) localStorage.setItem(WIDTH_KEY, "narrow");
    else localStorage.removeItem(WIDTH_KEY);
  } catch {
    // Storage is blocked: the choice lasts until the page is left.
  }
  notify();
}

export function toggleNarrow() {
  setNarrow(!isNarrow());
}

// React resets attributes it does not manage when development remounts the root: put the stored
// choice back.
export function restoreNarrow() {
  if (stored() && !isNarrow()) {
    apply(true);
    notify();
  }
}
