/** Longest stored file name, in characters. */
const MAX_FILENAME = 255;

/**
 * The name a client sent with a file, reduced to what is safe to store and to put in a header:
 * no directory part, no control or invisible formatting characters (the joiners that emoji and
 * Persian or Indic names need stay), no lone surrogates, at most 255 characters. Null when nothing
 * is left.
 */
export function cleanFilename(name: string | null | undefined): string | null {
  if (!name) return null;
  const base = name.slice(Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\")) + 1);
  const clean = [
    ...base
      .toWellFormed()
      .replace(/(?![\u200c\u200d])[\p{Cc}\p{Cf}\u2028\u2029]/gu, "")
      .trim(),
  ]
    .slice(0, MAX_FILENAME)
    .join("")
    .trim();
  return clean === "" || clean === "." || clean === ".." ? null : clean;
}

/**
 * The `Content-Disposition` of a download: the stored name, with an ASCII fallback beside it. Safe
 * for any stored value, the importer's included: a lone surrogate becomes U+FFFD, and the quoted
 * form keeps only printable ASCII without quote, backslash, percent or semicolon.
 */
export function contentDisposition(
  disposition: "inline" | "attachment",
  name: string | null,
  fallback: string,
): string {
  const full = (name ?? fallback).toWellFormed();
  const ascii = full.replace(/[^\x20-\x7e]|["\\%;]/g, "_");
  const encoded = encodeURIComponent(full).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
