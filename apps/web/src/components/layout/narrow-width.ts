// The visitor's width choice: "narrow" in localStorage, applied as data-width on <html> (the
// container width is a CSS variable switched by it). The script runs in <head> before first paint.
const WIDTH_KEY = "sermo-width";
const WIDTH_ATTRIBUTE = "data-width";

export const widthScript = `(function(){try{if(localStorage.getItem(${JSON.stringify(WIDTH_KEY)})==="narrow")document.documentElement.setAttribute(${JSON.stringify(WIDTH_ATTRIBUTE)},"narrow")}catch(e){}})()`;

const listeners = new Set<() => void>();

export function subscribeNarrow(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readNarrow() {
  try {
    return localStorage.getItem(WIDTH_KEY) === "narrow";
  } catch {
    return false;
  }
}

export function applyNarrow(narrow: boolean) {
  if (narrow) document.documentElement.setAttribute(WIDTH_ATTRIBUTE, "narrow");
  else document.documentElement.removeAttribute(WIDTH_ATTRIBUTE);
}

export function writeNarrow(narrow: boolean) {
  try {
    if (narrow) localStorage.setItem(WIDTH_KEY, "narrow");
    else localStorage.removeItem(WIDTH_KEY);
  } catch {
    // Storage is blocked: the choice lasts until the page is left.
  }
  applyNarrow(narrow);
  for (const listener of listeners) listener();
}
