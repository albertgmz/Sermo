// What the forum picker of a composer lists: the forums a member may start a thread in, under the
// categories (and forums) that hold them. Pure, so the rules are held by tests.

export type ForumChoice = {
  id: number;
  parentId: number | null;
  title: string;
  type: "category" | "forum";
  canPost: boolean;
};

export type ChoiceRow = {
  id: number;
  title: string;
  depth: number;
  // A forum the member may post in; the rest are headings that hold some.
  selectable: boolean;
  hasChildren: boolean;
  // The titles above it, for a result that is shown out of its place.
  trail: string[];
};

const postable = (node: ForumChoice) => node.type === "forum" && node.canPost;

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

export function forumTitle(forums: ForumChoice[], id: number) {
  return forums.find((forum) => forum.id === id)?.title ?? "";
}
