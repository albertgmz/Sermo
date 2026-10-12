// The backend names a permission or a criterion by a phrase key ("permission.forum.viewLog",
// "promotion.criterion.post_count"), and the phrase catalogue is not reachable from the web app.
// The panel shows the words of the key, set out as a title, next to the id itself.
export function phraseTitle(key: string, prefix: string): string {
  const tail = key.startsWith(prefix) ? key.slice(prefix.length) : key;
  const words = tail
    .replace(/[._]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
  return words ? words[0].toUpperCase() + words.slice(1) : key;
}

export const permissionTitle = (label: string) =>
  phraseTitle(label, "permission.");

export const criterionTitle = (label: string) =>
  phraseTitle(label, "promotion.criterion.");
