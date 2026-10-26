// The matching of the panel's search: what the box finds for a query among the screens, settings
// and permissions the viewer may open (`search-index.ts` builds them on the server). No React and
// no server code: the search box loads it with its popup.

export type SearchEntry = {
  kind: "screen" | "setting" | "permission";
  label: string;
  help: string;
  // The technical id (a setting key, a permission id); empty for a screen.
  id: string;
  // Where it lives, from the section down: shown under the label.
  path: string[];
  href: string;
};

// Why an entry was found: its label, its id or only its help.
export type Hit = { entry: SearchEntry; via: "label" | "id" | "help" };

// Lower case without accents: "Invitádos" and "invitados" are one word.
export const fold = (text: string) =>
  text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const wordsOf = (text: string) =>
  fold(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

const begins = (query: string[], words: string[]) =>
  query.every((part) => words.some((word) => word.startsWith(part)));

// An id matches by its parts (`forum`, `guestpost`) or written whole without its dots
// (`forum.guest` begins `forumguestpost`).
function idMatches(query: string[], id: string) {
  if (!id) return false;
  const parts = wordsOf(id);
  return begins(query, parts) || parts.join("").startsWith(query.join(""));
}

// 0 the exact label, 1 a label that begins with the query, 2 the query's words begin the label's,
// 3 the id, 4 the help (with the label); undefined for no match.
function rankOf(
  query: string[],
  entry: SearchEntry,
): { rank: number; via: Hit["via"] } | undefined {
  const label = wordsOf(entry.label);
  const phrase = query.join(" ");
  const written = label.join(" ");
  if (written === phrase) return { rank: 0, via: "label" };
  if (written.startsWith(phrase)) return { rank: 1, via: "label" };
  if (begins(query, label)) return { rank: 2, via: "label" };
  if (idMatches(query, entry.id)) return { rank: 3, via: "id" };
  if (begins(query, [...label, ...wordsOf(entry.help)]))
    return { rank: 4, via: "help" };
  return undefined;
}

// The entries the query finds, best first; equal matches keep the index's order (screens, then
// settings, then permissions). An empty query finds nothing.
export function searchEntries(
  entries: readonly SearchEntry[],
  query: string,
  limit = 50,
): Hit[] {
  const words = wordsOf(query);
  if (words.length === 0) return [];
  const found: (Hit & { rank: number; at: number })[] = [];
  entries.forEach((entry, at) => {
    const match = rankOf(words, entry);
    if (match) found.push({ entry, ...match, at });
  });
  return found
    .sort((a, b) => a.rank - b.rank || a.at - b.at)
    .slice(0, limit)
    .map(({ entry, via }) => ({ entry, via }));
}
