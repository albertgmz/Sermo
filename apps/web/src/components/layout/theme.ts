import { THEME_COLORS } from "@/lib/pwa";

// The visitor's colour theme: System (follow the device), Light or Dark. A visitor who has chosen
// nothing gets Light, whatever the device prefers; System is a choice kept like the other two. The
// source of truth for the page is data-theme="light|dark" (plus the dark class when dark, which
// the dark: variants read) on <html>; data-theme-choice holds what the visitor picked, so a
// browser that refuses storage still switches for the page. localStorage only keeps the choice
// between visits, best effort. The script runs in <head> before first paint and is the one place
// that applies it: choosing sends it an event. The server renders data-theme="light", so a page
// without scripts is light. It also gives the browser bar the colour of the theme shown: a
// `theme-color` of its own, put first so it wins over the light one of the root layout's viewport.
export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_KEY = "sermo-theme";
const CHOICE_ATTRIBUTE = "data-theme-choice";
const THEME_EVENT = "sermo-theme";

// A signed-in member's choice lives on their account; this cookie carries it to the head script,
// which wins over localStorage when it is there. Written by the server on a change and by
// `ThemeSync` when another browser changed it, removed when the visitor signs out. Readable by
// scripts on purpose.
export const ACCOUNT_THEME_COOKIE = "sermo-account-theme";

export const ACCOUNT_THEME_COOKIE_OPTIONS = {
  httpOnly: false,
  sameSite: "lax",
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
} as const;

export function isTheme(value: unknown): value is Theme {
  return THEMES.some((theme) => theme === value);
}

export const themeScript = `(function(){try{var d=document.documentElement,k=${JSON.stringify(THEME_KEY)},a=${JSON.stringify(CHOICE_ATTRIBUTE)},m;function r(){var v=null;try{var c=(document.cookie||"").match(/(?:^|; )${ACCOUNT_THEME_COOKIE}=(light|dark|system)/);v=c?c[1]:localStorage.getItem(k)}catch(e){}d.setAttribute(a,v==="light"||v==="dark"||v==="system"?v:"light")}function s(){var c=d.getAttribute(a),n=c==="dark"||(c==="system"&&!!m&&m.matches);d.setAttribute("data-theme",n?"dark":"light");d.classList.toggle("dark",n);var t=document.querySelector('meta[name="theme-color"][data-theme-bar]');if(!t){t=document.createElement("meta");t.name="theme-color";t.setAttribute("data-theme-bar","");document.head.prepend(t)}t.content=n?${JSON.stringify(THEME_COLORS.dark)}:${JSON.stringify(THEME_COLORS.light)}}addEventListener(${JSON.stringify(THEME_EVENT)},s);addEventListener("storage",function(e){if(e.key===null||e.key===k){r();s()}});r();s();m=matchMedia("(prefers-color-scheme: dark)");s();if(m.addEventListener)m.addEventListener("change",s);else if(m.addListener)m.addListener(s)}catch(e){}})()`;

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
  return choice === "system" || choice === "dark" ? choice : "light";
}

export function setTheme(theme: Theme) {
  document.documentElement.setAttribute(CHOICE_ATTRIBUTE, theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage is blocked: the choice lasts until the page is left.
  }
  window.dispatchEvent(new Event(THEME_EVENT));
}
