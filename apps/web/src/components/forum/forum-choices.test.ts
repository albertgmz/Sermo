import { expect, test } from "bun:test";
import { choiceRows, type ForumChoice, searchChoices } from "./forum-choices";

const forum = (
  id: number,
  parentId: number | null,
  title: string,
  canPost = true,
  type: ForumChoice["type"] = "forum",
): ForumChoice => ({ id, parentId, title, type, canPost });

// Support (category) > Help (forum) > Billing (sub-forum); Lounge (category) > Chat (forum);
// Archive (category) > Old (forum the member may not post in); News (forum, root).
const NODES = [
  forum(1, null, "Support", false, "category"),
  forum(2, 1, "Help"),
  forum(3, 2, "Billing"),
  forum(4, null, "Lounge", false, "category"),
  forum(5, 4, "Chat"),
  forum(6, null, "Archive", false, "category"),
  forum(7, 6, "Old", false),
  forum(8, null, "News"),
];

test("only the forums the member may post in are listed, under the categories that hold them", () => {
  const rows = choiceRows(NODES);
  expect(rows.map((row) => [row.title, row.depth, row.selectable])).toEqual([
    ["Support", 0, false],
    ["Help", 1, true],
    ["Billing", 2, true],
    ["Lounge", 0, false],
    ["Chat", 1, true],
    ["News", 0, true],
  ]);
  // A category with nothing to post in, and the forum itself, are gone.
  expect(rows.map((row) => row.title)).not.toContain("Archive");
  expect(rows.map((row) => row.title)).not.toContain("Old");
});

test("a forum that holds sub-forums is both a choice and a fold", () => {
  const help = choiceRows(NODES).find((row) => row.title === "Help");
  expect(help).toMatchObject({ selectable: true, hasChildren: true });
});

test("a folded node hides what is under it and keeps itself", () => {
  const rows = choiceRows(NODES, new Set([1, 4]));
  expect(rows.map((row) => row.title)).toEqual(["Support", "Lounge", "News"]);
});

test("a forum whose parent the member cannot see is a root of what they can", () => {
  const rows = choiceRows([forum(11, 99, "Orphan")]);
  expect(rows.map((row) => row.title)).toEqual(["Orphan"]);
});

test("a search finds forums by title, ignoring case and accents, with the titles above them", () => {
  const nodes = [
    forum(1, null, "Soporte", false, "category"),
    forum(2, 1, "Facturación"),
  ];
  const found = searchChoices(nodes, "  FACTURACION ");
  expect(found).toHaveLength(1);
  expect(found[0]).toMatchObject({ id: 2, trail: ["Soporte"] });
});

test("a search never offers a heading or a forum the member may not post in", () => {
  expect(searchChoices(NODES, "support")).toEqual([]);
  expect(searchChoices(NODES, "old")).toEqual([]);
  expect(searchChoices(NODES, "")).toEqual([]);
  expect(searchChoices(NODES, "b").map((row) => row.title)).toEqual([
    "Billing",
  ]);
});
