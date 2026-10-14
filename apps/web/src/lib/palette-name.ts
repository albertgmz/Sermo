// The name of a palette colour in the visitor's language. The palette is data: the install ships
// with English names (Rose, Sky), and `messages/<locale>/lib.json` (`appearance.accents`,
// `appearance.nameColors`) holds each of them under its lower-cased name. A colour with no message
// (one staff added or renamed) keeps the name it has. \`t\` is the translator of \`lib.appearance\`.
type Translator = { has(key: string): boolean } & ((key: string) => string);

export function paletteName(
  t: unknown,
  group: "accents" | "nameColors",
  name: string,
): string {
  const say = t as Translator;
  const key = `${group}.${name.trim().toLowerCase()}`;
  return typeof say.has === "function" && say.has(key) ? say(key) : name;
}
