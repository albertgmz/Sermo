// The screen where a member whose account a sign-in provider made chooses a username.
export const CHOOSE_USERNAME_PATH = "/choose-username";

// The pages a signed-in visitor has no reason to return to.
const NOT_RETURNED_TO = ["/login", "/register", CHOOSE_USERNAME_PATH];

// A return path is only followed when it stays on this site: one leading slash, no backslash,
// and not one of the pages above.
export function safeReturnPath(value: unknown): string {
  if (typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  if (value.includes("\\")) return "/";
  if (
    [...value].some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    )
  ) {
    return "/";
  }
  // A dot segment is resolved by whoever follows the path, and `/.//host` becomes `//host`.
  const segments = value.split(/[?#]/)[0].split("/");
  if (segments.some((s) => [".", ".."].includes(s.replace(/%2e/gi, ".")))) {
    return "/";
  }
  const pathname = value.split(/[?#]/)[0].replace(/\/+$/, "");
  if (NOT_RETURNED_TO.includes(pathname)) return "/";
  return value;
}

// The username screen, with the page to go back to afterwards when it is one to return to.
export function chooseUsernamePath(next: unknown): string {
  const back = safeReturnPath(next);
  return back === "/"
    ? CHOOSE_USERNAME_PATH
    : `${CHOOSE_USERNAME_PATH}?next=${encodeURIComponent(back)}`;
}
