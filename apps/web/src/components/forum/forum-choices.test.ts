import { expect, test } from "bun:test";
import type { ForumArtUrl } from "./forum-choice-art";
import {
  choiceRows,
  choiceSections,
  type ForumChoice,
  searchChoices,
} from "./forum-choices";

const forum = (
  id: number,
  parentId: number | null,
  title: string,
  canPost = true,
  type: ForumChoice["type"] = "forum",
): ForumChoice => ({
  id,
  parentId,
  title,
  type,
  canPost,
  readOnly: false,
  image: null,
});

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

test("a read-only forum is never offered, not even to an administrator who may post there", () => {
  const nodes = [
    forum(1, null, "Support", false, "category"),
    forum(2, 1, "Help"),
    { ...forum(3, 1, "Announcements"), readOnly: true },
  ];
  expect(choiceRows(nodes).map((row) => row.title)).toEqual([
    "Support",
    "Help",
  ]);
  expect(searchChoices(nodes, "announce")).toEqual([]);
});

test("a heading that holds only read-only forums is left out", () => {
  const nodes = [
    forum(1, null, "News", false, "category"),
    { ...forum(2, 1, "Announcements"), readOnly: true },
    forum(3, null, "Lounge", false, "category"),
    forum(4, 3, "Chat"),
  ];
  expect(choiceRows(nodes).map((row) => row.title)).toEqual(["Lounge", "Chat"]);
});

test("a row carries the forum's picture", () => {
  const image = { url: "/files/9" as ForumArtUrl, kind: "cover" } as const;
  const [row] = choiceRows([{ ...forum(1, null, "Chat"), image }]);
  expect(row?.image).toBe(image);
});

test("the list is drawn in sections: each heading with the forums right under it, after its parent's", () => {
  const sections = choiceSections(
    choiceRows([
      ...NODES,
      forum(9, 2, "Feedback"),
      forum(10, 1, "Guides"),
      forum(11, null, "Rules"),
    ]),
  );
  expect(
    sections.map((section) => [
      section.heading?.title ?? null,
      section.items.map((row) => row.title),
    ]),
  ).toEqual([
    ["Support", ["Help", "Guides"]],
    ["Help", ["Billing", "Feedback"]],
    ["Lounge", ["Chat"]],
    [null, ["News", "Rules"]],
  ]);
});

test("a folded heading keeps its section, empty", () => {
  const sections = choiceSections(choiceRows(NODES, new Set([1])));
  expect(
    sections.map((section) => [
      section.heading?.title ?? null,
      section.items.length,
    ]),
  ).toEqual([
    ["Support", 0],
    ["Lounge", 1],
    [null, 1],
  ]);
});
