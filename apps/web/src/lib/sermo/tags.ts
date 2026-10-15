// A tag's address: the name is the address (letters, numbers and `_`, in NFC and lowercase).
export const tagHref = (name: string) => `/tags/${encodeURIComponent(name)}`;

// The tags a field holds: names separated by spaces or commas, each with or without its `#`. The
// backend decides what is a tag; nothing here judges a name, so an invalid one reaches it and comes
// back refused with its message.
export function tagsFromText(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,;]+/)
        .map((name) => name.replace(/^#+/, ""))
        .filter((name) => name !== ""),
    ),
  ];
}

// The tags of a thread as a field shows them.
export const tagsToText = (tags: readonly string[]) =>
  tags.map((name) => `#${name}`).join(" ");

// A search box holding only a hashtag (`#rust`) asks for that tag's page: the name without the `#`,
// or null for any other query. The backend reads the name like a hashtag (case, accents), so the
// page itself is not found for a text that is no tag.
export function searchedTag(query: string): string | null {
  const match = /^\s*#([^\s#]{1,120})\s*$/u.exec(query);
  return match ? match[1] : null;
}
