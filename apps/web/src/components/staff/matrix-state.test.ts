import { expect, test } from "bun:test";
import {
  bulkSet,
  type Cell,
  changedIds,
  initialCell,
  initialCells,
  matrixTabs,
  tabOf,
} from "./matrix-state";
import {
  cellText,
  type MatrixValue,
  matrixChanges,
  modeField,
  numberField,
  wasField,
} from "./permission-entries";

const PERMISSIONS = [
  { id: "forum.view", type: "flag", scope: "node", category: "forum" },
  { id: "forum.reply", type: "flag", scope: "node", category: "forum" },
  { id: "forum.editLimit", type: "integer", scope: "node", category: "forum" },
  { id: "profile.post", type: "flag", scope: "global", category: "profile" },
  { id: "tag.manage", type: "flag", scope: "global", category: "moderation" },
  {
    id: "warning.maxPoints",
    type: "integer",
    scope: "global",
    category: "moderation",
  },
] as const;

const ENTRIES: Record<string, MatrixValue> = {
  "forum.view": "allow",
  "forum.reply": "never",
  "forum.editLimit": 30,
  "tag.manage": "allow",
  "warning.maxPoints": -1,
};

// The form the matrix posts for these cells: each row's select, the number of an integer with a
// limit, and the hidden field with what the row showed.
function posted(cells: Record<string, Cell>) {
  const data = new FormData();
  for (const permission of PERMISSIONS) {
    const cell = cells[permission.id];
    data.set(modeField(permission.id), cell.mode);
    if (permission.type === "integer" && cell.mode === "value") {
      data.set(numberField(permission.id), cell.amount);
    }
    data.set(wasField(permission.id), cellText(ENTRIES[permission.id]));
  }
  return data;
}

const tab = (name: "general" | "moderation") =>
  PERMISSIONS.filter((permission) => tabOf(permission.category) === name);

test("moderation has a tab of its own; every other category is general", () => {
  expect(tabOf("moderation")).toBe("moderation");
  for (const category of ["general", "forum", "profile", "admin", "economy"]) {
    expect(tabOf(category)).toBe("general");
  }
});

test("a row starts as its entry shows it, and nothing has changed", () => {
  expect(initialCell("flag", undefined)).toEqual({ mode: "", amount: "" });
  expect(initialCell("flag", "never")).toEqual({ mode: "never", amount: "" });
  expect(initialCell("integer", -1)).toEqual({ mode: "unlimited", amount: "" });
  expect(initialCell("integer", 0)).toEqual({ mode: "value", amount: "0" });
  const cells = initialCells(PERMISSIONS, ENTRIES);
  expect(changedIds(PERMISSIONS, cells, ENTRIES, true)).toEqual([]);
  expect(matrixChanges(posted(cells), PERMISSIONS, true)).toEqual({
    changes: [],
  });
});

test("Allow all on a tab sets every yes/no row of the tab and no integer row", () => {
  const cells = bulkSet(
    initialCells(PERMISSIONS, ENTRIES),
    tab("general"),
    "allow",
  );
  expect(cells["forum.view"].mode).toBe("allow");
  expect(cells["forum.reply"].mode).toBe("allow");
  expect(cells["profile.post"].mode).toBe("allow");
  expect(cells["forum.editLimit"]).toEqual({ mode: "value", amount: "30" });
  // The other tab is left alone.
  expect(cells["tag.manage"].mode).toBe("allow");
  expect(cells["warning.maxPoints"].mode).toBe("unlimited");
  // Only the rows that showed something else are changed, and only they are sent.
  expect(changedIds(PERMISSIONS, cells, ENTRIES, false)).toEqual([
    "forum.reply",
    "profile.post",
  ]);
  expect(matrixChanges(posted(cells), PERMISSIONS, false)).toEqual({
    changes: [
      { permission: "forum.reply", value: "allow" },
      { permission: "profile.post", value: "allow" },
    ],
  });
});

test("Never for all on a category sets that category's yes/no rows only", () => {
  const forum = PERMISSIONS.filter((entry) => entry.category === "forum");
  const cells = bulkSet(initialCells(PERMISSIONS, ENTRIES), forum, "never");
  expect(matrixChanges(posted(cells), PERMISSIONS, true)).toEqual({
    changes: [{ permission: "forum.view", value: "never" }],
  });
  expect(cells["profile.post"].mode).toBe("");
  expect(cells["forum.editLimit"]).toEqual({ mode: "value", amount: "30" });
});

test("Clear all returns the yes/no rows to not set, which removes their entries", () => {
  const cells = bulkSet(initialCells(PERMISSIONS, ENTRIES), PERMISSIONS, "");
  for (const permission of PERMISSIONS) {
    if (permission.type === "flag") {
      expect(cells[permission.id].mode).toBe("");
    }
  }
  expect(matrixChanges(posted(cells), PERMISSIONS, false)).toEqual({
    changes: [
      { permission: "forum.view", value: "unset" },
      { permission: "forum.reply", value: "unset" },
      { permission: "tag.manage", value: "unset" },
    ],
  });
});

test("a bulk change undone by hand leaves nothing to send", () => {
  let cells = bulkSet(initialCells(PERMISSIONS, ENTRIES), tab("general"), "");
  cells = { ...cells, "forum.view": { mode: "allow", amount: "" } };
  cells = { ...cells, "forum.reply": { mode: "never", amount: "" } };
  expect(changedIds(PERMISSIONS, cells, ENTRIES, false)).toEqual([]);
});

test("an integer row counts as changed by its number, and one with no valid number too", () => {
  const start = initialCells(PERMISSIONS, ENTRIES);
  const same = {
    ...start,
    "forum.editLimit": { mode: "value", amount: "030" },
  };
  expect(changedIds(PERMISSIONS, same, ENTRIES, false)).toEqual([]);
  const other = {
    ...start,
    "forum.editLimit": { mode: "value", amount: "45" },
  };
  expect(changedIds(PERMISSIONS, other, ENTRIES, false)).toEqual([
    "forum.editLimit",
  ]);
  const empty = { ...start, "forum.editLimit": { mode: "value", amount: "" } };
  expect(changedIds(PERMISSIONS, empty, ENTRIES, false)).toEqual([
    "forum.editLimit",
  ]);
  expect(matrixChanges(posted(empty), PERMISSIONS, false)).toEqual({
    invalid: "forum.editLimit",
  });
});

test("the tabs and categories the buttons act on are laid out as the matrix shows them", () => {
  const tabs = matrixTabs(PERMISSIONS);
  expect(tabs.map(({ tab }) => tab)).toEqual(["general", "moderation"]);
  const [general, moderation] = tabs;
  expect(general.rows.map(({ id }) => id)).toEqual([
    "forum.view",
    "forum.reply",
    "forum.editLimit",
    "profile.post",
  ]);
  expect(
    general.categories.map(({ category, rows }) => [
      category,
      rows.map(({ id }) => id),
    ]),
  ).toEqual([
    ["forum", ["forum.view", "forum.reply", "forum.editLimit"]],
    ["profile", ["profile.post"]],
  ]);
  expect(moderation.categories.map(({ category }) => category)).toEqual([
    "moderation",
  ]);
  // A tab with no rows is left out (a forum has no moderation permission).
  expect(
    matrixTabs(PERMISSIONS.filter(({ scope }) => scope === "node")).map(
      ({ tab }) => tab,
    ),
  ).toEqual(["general"]);
});

test("each bulk button, given its tab's or category's rows, sends only its yes/no rows", () => {
  const [general, moderation] = matrixTabs(PERMISSIONS);
  const start = initialCells(PERMISSIONS, ENTRIES);
  const sent = (cells: Record<string, Cell>) => {
    const result = matrixChanges(posted(cells), PERMISSIONS, false);
    return "changes" in result
      ? result.changes.map(({ permission, value }) => `${permission}=${value}`)
      : result;
  };
  expect(sent(bulkSet(start, moderation.rows, "never"))).toEqual([
    "tag.manage=never",
  ]);
  expect(sent(bulkSet(start, general.categories[1].rows, "allow"))).toEqual([
    "profile.post=allow",
  ]);
  expect(sent(bulkSet(start, general.categories[0].rows, ""))).toEqual([
    "forum.view=unset",
    "forum.reply=unset",
  ]);
});
