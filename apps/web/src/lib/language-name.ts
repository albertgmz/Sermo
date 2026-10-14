// A language in its own name ("English", "Español"), the way a language chooser lists it: a
// visitor must find theirs whatever language the page is in.
export function languageName(code: string): string {
  const name =
    new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code;
  return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
}
