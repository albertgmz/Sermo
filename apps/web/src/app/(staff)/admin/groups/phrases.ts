// The words of a phrase key ("credits.type.adjustment") set out as a title, for the values the
// backend names by a key and gives no text for.
export function phraseTitle(key: string, prefix: string): string {
  const tail = key.startsWith(prefix) ? key.slice(prefix.length) : key;
  const words = tail
    .replace(/[._]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
  return words ? words[0].toUpperCase() + words.slice(1) : key;
}
