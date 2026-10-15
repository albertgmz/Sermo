// What a trigger does when the popup's code cannot be fetched, even on the second try. The usual
// cause is a stale chunk after a deploy, which a reload cures; a missing network or a blocker does
// not, and a reload on every press would cost the visitor their place and anything they typed. So
// the page is reloaded at most once per address per browser session, and never while offline. When
// that is spent the visitor is told, in words, to reload by hand.

export type Recovery = "reloaded" | "gave-up";

export type RecoveryEnv = {
  // `sessionStorage`; reading it may throw (blocked storage, a private window).
  storage: () => Pick<Storage, "getItem" | "setItem">;
  // The address without its fragment: a fragment is a place in the page, not another page.
  address: () => string;
  online: () => boolean;
  reload: () => void;
};

// Without usable storage the guard falls back to once per page load.
const page = { reloaded: false };

export function recoverFromChunkFailure(
  env: RecoveryEnv,
  memory: { reloaded: boolean } = page,
): Recovery {
  // Offline, a reload would replace the page with the browser's error page.
  if (!env.online()) return "gave-up";
  try {
    const storage = env.storage();
    const key = `lazy-popup-reload:${env.address()}`;
    if (storage.getItem(key)) return "gave-up";
    storage.setItem(key, "1");
  } catch {
    if (memory.reloaded) return "gave-up";
  }
  memory.reloaded = true;
  // `reload`, not a navigation to the same address: with a fragment in it that only scrolls.
  env.reload();
  return "reloaded";
}

export const browserRecoveryEnv: RecoveryEnv = {
  storage: () => window.sessionStorage,
  address: () => window.location.pathname + window.location.search,
  online: () => window.navigator.onLine !== false,
  reload: () => window.location.reload(),
};
