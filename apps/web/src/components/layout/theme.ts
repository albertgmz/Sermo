import { THEME_COLORS } from "@/lib/pwa";

// The visitor's colour theme: System (follow the device), Light or Dark. The source of truth for
// the page is data-theme="light|dark" (plus the dark class when dark, which the dark: variants
// read) on <html>; data-theme-choice holds what the visitor picked, so a browser that refuses
// storage still switches for the page. localStorage only keeps the choice between visits, best
// effort. The script runs in <head> before first paint and is the one place that applies it:
// choosing sends it an event. The server renders the dark class, so a page without scripts is dark.
// It also gives the browser bar the colour of the theme shown: a `theme-color` without `media`, put
// first so it wins over the two that follow the device (the root layout's viewport).
export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

const THEME_KEY = "sermo-theme";
const CHOICE_ATTRIBUTE = "data-theme-choice";
const THEME_EVENT = "sermo-theme";

export const themeScript = `(function(){try{var d=document.documentElement,k=${JSON.stringify(THEME_KEY)},a=${JSON.stringify(CHOICE_ATTRIBUTE)},m;function r(){try{var v=localStorage.getItem(k);d.setAttribute(a,v==="light"||v==="dark"?v:"system")}catch(e){d.setAttribute(a,"system")}}function s(){var c=d.getAttribute(a),n=c==="dark"||(c!=="light"&&!(m&&!m.matches));d.setAttribute("data-theme",n?"dark":"light");d.classList.toggle("dark",n);var t=document.querySelector('meta[name="theme-color"]:not([media])');if(!t){t=document.createElement("meta");t.name="theme-color";document.head.prepend(t)}t.content=n?${JSON.stringify(THEME_COLORS.dark)}:${JSON.stringify(THEME_COLORS.light)}}addEventListener(${JSON.stringify(THEME_EVENT)},s);addEventListener("storage",function(e){if(e.key===null||e.key===k){r();s()}});r();s();m=matchMedia("(prefers-color-scheme: dark)");s();if(m.addEventListener)m.addEventListener("change",s);else if(m.addListener)m.addListener(s)}catch(e){}})()`;

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
  window.dispatchEvent(new Event(THEME_EVENT));
}
