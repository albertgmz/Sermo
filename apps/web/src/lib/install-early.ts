// The browser sends `beforeinstallprompt` once per page load, and on a slow connection it can come
// before the page's scripts have run. This small script, inline in the head of every page, holds
// the event on the window (and keeps the browser's own install bar away, as `install-prompt.ts`
// does), so that module takes it over when it loads.
export const EARLY_INSTALL_KEY = "__sermoInstallEvent";

export const installScript = `(function(){addEventListener("beforeinstallprompt",function(e){e.preventDefault();window[${JSON.stringify(EARLY_INSTALL_KEY)}]=e})})()`;
