import { expect, test } from "bun:test";
import { memberAdminTabs } from "./manage-tabs";

const viewer = (held: string[]) => ({
  resolvedPermissions: Object.fromEntries(held.map((id) => [id, true])),
  staff: { panel: true, moderatesEverywhere: false, moderatedNodeIds: [] },
});

const keys = (held: string[], id = 7) =>
  memberAdminTabs(viewer(held), id).map((tab) => tab.key);

test("a member manager gets a link to every tab, each under the member's own address", () => {
  const tabs = memberAdminTabs(
    viewer(["admin.members", "admin.permissions", "credits.viewAny"]),
    7,
  );
  expect(tabs.map((tab) => [tab.key, tab.href])).toEqual([
    ["usersEdit", "/admin/users/7"],
    ["usersGroups", "/admin/users/7/groups"],
    ["usersProfile", "/admin/users/7/profile"],
    ["usersAppearance", "/admin/users/7/appearance"],
    ["usersPermissions", "/admin/users/7/permissions"],
    ["usersSanctions", "/admin/users/7/sanctions"],
    ["usersEconomy", "/admin/users/7/economy"],
    ["usersSessions", "/admin/users/7/sessions"],
    ["usersHistory", "/admin/users/7/history"],
  ]);
});

test("a tab the viewer may not open has no link, though the viewer manages members", () => {
  const without = keys(["admin.members"]);
  expect(without).not.toContain("usersPermissions");
  expect(without).not.toContain("usersEconomy");
  expect(without).toContain("usersSanctions");
  expect(keys(["admin.members", "admin.permissions"])).toContain(
    "usersPermissions",
  );
  expect(keys(["admin.members", "admin.shop"])).toContain("usersEconomy");
});

test("without the right to manage members there is no menu, whatever else the viewer holds", () => {
  // A moderator, a holder of other tab permissions, a member and a guest.
  const moderator = {
    resolvedPermissions: { "profilePost.approve": true },
    staff: { panel: true, moderatesEverywhere: true, moderatedNodeIds: [1] },
  };
  expect(memberAdminTabs(moderator, 7)).toEqual([]);
  expect(keys(["admin.permissions", "credits.viewAny", "admin.shop"])).toEqual(
    [],
  );
  expect(keys([])).toEqual([]);
});
