// A return path is only followed when it stays on this site: one leading slash, no backslash,
// and not one of the pages a signed-in visitor has no reason to return to.
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
  if (pathname === "/login" || pathname === "/register") return "/";
  return value;
}
