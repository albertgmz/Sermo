import { SUPPORTED_LANGUAGES } from "../../contracts/settings";

/**
 * The language a visitor reads in, from the request that made their account: the `forum_locale`
 * cookie the web app sets, else the first supported language of `Accept-Language`. Null when the
 * request names none, so the site's default applies.
 */
export function requestLanguage(headers: Headers | undefined): string | null {
  if (!headers) return null;
  const supported = (code: string | undefined) =>
    SUPPORTED_LANGUAGES.find((language) => language === code?.toLowerCase().split("-")[0]) ?? null;
  const cookie = /(?:^|;\s*)forum_locale=([a-zA-Z-]{2,10})(?:;|$)/.exec(
    headers.get("cookie") ?? "",
  );
  const chosen = supported(cookie?.[1]);
  if (chosen) return chosen;
  // By weight (a missing q is 1, a refusal q=0 is skipped), then by position.
  const ranked = (headers.get("accept-language") ?? "")
    .split(",")
    .map((part, position) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params
        .map((param) => /^\s*q\s*=(.*)$/i.exec(param)?.[1])
        .find((v) => v !== undefined);
      const weight = q === undefined ? 1 : Number(q.trim() === "" ? Number.NaN : q);
      return { found: supported(tag.trim()), weight: Number.isNaN(weight) ? 0 : weight, position };
    })
    .filter((entry) => entry.found && entry.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.position - b.position);
  if (ranked[0]?.found) return ranked[0].found;
  return null;
}
