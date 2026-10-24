// What the forum picker of a composer lists: the forums a member may start a thread in, under the
// categories (and forums) that hold them. Pure, so the rules are held by tests.

import type { ForumArtUrl } from "@/components/forum/forum-choice-art";

export type ForumChoice = {
  id: number;
  parentId: number | null;
  title: string;
  type: "category" | "forum";
  canPost: boolean;
  // The forum takes no new threads (its read-only setting): it is never offered, not even to an
  // administrator, whose permissions would let them post there.
  readOnly: boolean;
  // The forum's picture (its cover, else its icon) as LITE let it through; null for none.
  image: ForumArtUrl | null;
};

export type ChoiceRow = {
  id: number;
  title: string;
  depth: number;
  // A forum the member may post in; the rest are headings that hold some.
  selectable: boolean;
  hasChildren: boolean;
  image: ForumArtUrl | null;
  // The titles above it, for a result that is shown out of its place.
  trail: string[];
};

// The one rule of what a composer offers: a forum the member may post in that is not read-only.
export const postable = (node: ForumChoice) =>
  node.type === "forum" && node.canPost && !node.readOnly;

// Lower case and without accents, so "foro" finds "Fóro".
const plain = (text: string) =>
  text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase().trim();

function tree(forums: ForumChoice[]) {
  const ids = new Set(forums.map((forum) => forum.id));
  const children = new Map<number | null, ForumChoice[]>();
  for (const forum of forums) {
    // A node whose parent the viewer cannot see is a root of what they can.
    const parent =
      forum.parentId !== null && ids.has(forum.parentId)
        ? forum.parentId
        : null;
    children.set(parent, [...(children.get(parent) ?? []), forum]);
  }
  return children;
}

// The rows of the tree in display order. A node is listed when it is a forum the member may post
// in or holds one; the children of a collapsed node are left out.
export function choiceRows(
  forums: ForumChoice[],
  collapsed: ReadonlySet<number> = new Set(),
): ChoiceRow[] {
  const children = tree(forums);
  const keep = new Map<number, boolean>();
  const kept = (node: ForumChoice): boolean => {
    const known = keep.get(node.id);
    if (known !== undefined) return known;
    const result =
      postable(node) ||
      (children.get(node.id) ?? []).some((child) => kept(child));
    keep.set(node.id, result);
    return result;
  };
  const rows: ChoiceRow[] = [];
  const walk = (parent: number | null, depth: number, trail: string[]) => {
    for (const node of children.get(parent) ?? []) {
      if (!kept(node)) continue;
      const below = (children.get(node.id) ?? []).filter((child) =>
        kept(child),
      );
      rows.push({
        id: node.id,
        title: node.title,
        depth,
        selectable: postable(node),
        hasChildren: below.length > 0,
        image: node.image,
        trail,
      });
      if (!collapsed.has(node.id))
        walk(node.id, depth + 1, [...trail, node.title]);
    }
  };
  walk(null, 0, []);
  return rows;
}

// The forums whose title holds the text, flat, each with the titles above it.
export function searchChoices(
  forums: ForumChoice[],
  query: string,
): ChoiceRow[] {
  const wanted = plain(query);
  if (!wanted) return [];
  return choiceRows(forums).filter(
    (row) => row.selectable && plain(row.title).includes(wanted),
  );
}

// A part of the list as it is drawn: a heading (a category, or a forum that holds forums) and the
// forums right under it; none for the forums at the root. A section follows its parent's, so a
// forum that holds others is first a choice among its siblings, then the heading of its own.
export type ChoiceSection = { heading: ChoiceRow | null; items: ChoiceRow[] };

export function choiceSections(rows: ChoiceRow[]): ChoiceSection[] {
  const sections: ChoiceSection[] = [];
  const headed = new Map<number, ChoiceSection>();
  // The id of the row above each depth: the parent of the next row one level down.
  const above: number[] = [];
  // Forums at the root next to each other share one section without a heading.
  const atRoot = () => {
    const last = sections.at(-1);
    if (last && last.heading === null) return last;
    const section: ChoiceSection = { heading: null, items: [] };
    sections.push(section);
    return section;
  };
  for (const row of rows) {
    above[row.depth] = row.id;
    if (row.selectable) {
      const parent = row.depth > 0 ? above[row.depth - 1] : undefined;
      const section = parent === undefined ? undefined : headed.get(parent);
      (section ?? atRoot()).items.push(row);
    }
    if (row.hasChildren) {
      const section: ChoiceSection = { heading: row, items: [] };
      sections.push(section);
      headed.set(row.id, section);
    }
  }
  return sections;
}

export function forumTitle(forums: ForumChoice[], id: number) {
  return forums.find((forum) => forum.id === id)?.title ?? "";
}
