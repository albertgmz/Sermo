// The visitor's colour theme: System (follow the device), Light or Dark. The source of truth for
// the page is data-theme="light|dark" (plus the dark class when dark, which the dark: variants
// read) on <html>; data-theme-choice holds what the visitor picked, so a browser that refuses
// storage still switches for the page. localStorage only keeps the choice between visits, best
// effort. The script runs in <head> before first paint and is the one place that applies it:
// choosing sends it an event.
export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

const THEME_KEY = "sermo-theme";
const CHOICE_ATTRIBUTE = "data-theme-choice";
const THEME_EVENT = "sermo-theme";

export const themeScript = `(function(){try{var d=document.documentElement,k=${JSON.stringify(THEME_KEY)},a=${JSON.stringify(CHOICE_ATTRIBUTE)},m=matchMedia("(prefers-color-scheme: dark)");function r(){try{var v=localStorage.getItem(k);d.setAttribute(a,v==="light"||v==="dark"?v:"system")}catch(e){d.setAttribute(a,"system")}}function s(){var c=d.getAttribute(a),n=c==="dark"||(c!=="light"&&m.matches);d.setAttribute("data-theme",n?"dark":"light");d.classList.toggle("dark",n)}r();s();m.addEventListener("change",s);addEventListener(${JSON.stringify(THEME_EVENT)},s);addEventListener("storage",function(e){if(e.key===null||e.key===k){r();s()}})}catch(e){}})()`;

function announce() {
  window.dispatchEvent(new Event(THEME_EVENT));
}

export function subscribeTheme(listener: () => void) {
  window.addEventListener(THEME_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(THEME_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

export function currentTheme(): Theme {
  const choice = document.documentElement.getAttribute(CHOICE_ATTRIBUTE);
  return choice === "light" || choice === "dark" ? choice : "system";
}

export function setTheme(theme: Theme) {
  document.documentElement.setAttribute(CHOICE_ATTRIBUTE, theme);
  try {
    if (theme === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage is blocked: the choice lasts until the page is left.
  }
  announce();
}

// React resets attributes it does not manage when development remounts the root: put the stored
// choice back and apply it.
export function restoreTheme() {
  const root = document.documentElement;
  if (!root.hasAttribute(CHOICE_ATTRIBUTE)) {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored === "light" || stored === "dark")
        root.setAttribute(CHOICE_ATTRIBUTE, stored);
    } catch {
      // Storage is blocked: the page follows the device.
    }
  }
  announce();
}
