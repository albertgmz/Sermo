// Signing out clears what the site keeps in the browser: the theme, the width, the panel states and
// the drafts in local and session storage, so a shared device keeps nothing of the member. The
// sign-out route (`app/sign-out/route.ts`) sets this cookie when the session ended. The first page
// after it runs `signedOutScript` before any other script reads the storage. The script clears both
// storages and expires the cookie. The service worker and its files stay: they hold only the
// public static files of the site.
export const SIGNED_OUT_COOKIE = "sermo-signed-out";

// The page script reads the cookie, so it is not HttpOnly. It lives a few minutes: long enough for
// the page that the sign-out opens, and no longer if that page never ran its scripts.
export const SIGNED_OUT_COOKIE_OPTIONS = {
  path: "/",
  maxAge: 300,
  sameSite: "lax",
  httpOnly: false,
} as const;

export const signedOutScript = `(function(){try{var n=${JSON.stringify(SIGNED_OUT_COOKIE)};if(!new RegExp("(?:^|; )"+n+"=1(?:;|$)").test(document.cookie))return;try{localStorage.clear()}catch(e){}try{sessionStorage.clear()}catch(e){}document.cookie=n+"=; Max-Age=0; Path=/; SameSite=Lax"+(location.protocol==="https:"?"; Secure":"")}catch(e){}})()`;
