import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { isValidElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { EditForm } from "@/components/staff/edit-form";
import { groupBody } from "@/lib/test-bodies";
import { withIntl } from "@/lib/test-intl";
import { fakeBackend } from "../../groups/test-backend";
import { installIntl } from "../intl-stand-ins";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));
const restoreIntl = await installIntl();

const { AppearanceForm } = await import("./appearance/appearance-form");
const appearanceActions = await import("./appearance/actions");
const { Adjust, Awards } = await import("./economy/sections");
const economyActions = await import("./economy/actions");
const { GroupsForm } = await import("./groups/groups-form");
const { SuperAdminForm } = await import("./groups/super-admin-form");
const groupActions = await import("./groups/actions");
const identityActions = await import("./actions");
const { IdentityForm } = await import("./identity-form");
const { ProfileForm } = await import("./profile/profile-form");
const profileActions = await import("./profile/actions");
const { Bans, Restrictions, Warnings } = await import("./sanctions/sections");
const sanctionActions = await import("./sanctions/actions");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(restoreIntl);

// The server action of every `EditForm` in an element tree (async server components are not
// opened: the forms of these screens sit in the tree the component returns).
function actionsIn(node: ReactNode): unknown[] {
  if (Array.isArray(node)) return node.flatMap(actionsIn);
  if (!isValidElement(node)) return [];
  const props = node.props as { action?: unknown; children?: ReactNode };
  return [
    ...(node.type === EditForm ? [props.action] : []),
    ...actionsIn(props.children),
  ];
}

// The names of the controls a node draws, once the async parts have settled.
async function namesIn(node: ReactNode) {
  const stream = await renderToReadableStream(withIntl(node));
  await stream.allReady;
  const html = await new Response(stream).text();
  return new Set(
    [...html.matchAll(/<(?:input|select|textarea)[^>]*? name="([^"]+)"/g)].map(
      (match) => match[1],
    ),
  );
}

const card = {
  id: 7,
  username: "ada",
  avatar: null,
  frame: null,
  nameColor: null,
  nameIcon: null,
  title: "",
  badges: [],
  level: 1,
  restricted: false,
};
const member = {
  card,
  email: "ada@example.test",
  emailVerified: true,
  state: "valid" as const,
  erasedAt: null,
  createdAt: "2026-01-02T10:00:00.000Z",
  lastActivityAt: null,
  usernameChangedAt: null,
  postCount: 1,
  credits: 5,
  canEdit: true,
  isSuperAdmin: false,
  canSetSuperAdmin: true,
};

// Every expected control is drawn under its name.
const drawn = async (node: ReactNode, expected: string[]) => {
  const names = await namesIn(node);
  expect(expected.filter((name) => !names.has(name))).toEqual([]);
};

test("the identity form saves through saveIdentity with the old values and the admin password", async () => {
  const form = await IdentityForm({ member, readOnly: false });
  expect(actionsIn(form)).toEqual([identityActions.saveIdentity]);
  await drawn(form, [
    "id",
    "usernameWas",
    "emailWas",
    "verifiedWas",
    "actorPassword",
    "username",
    "email",
    "emailVerified",
    "passwordMode",
    "password",
  ]);
});

test("the groups form saves through saveGroups; the super admin form through saveSuperAdmin", async () => {
  const groups = [groupBody({ id: 7 }), groupBody({ id: 8, title: "Editors" })];
  const form = await GroupsForm({
    userId: 7,
    groups,
    held: {
      primaryGroupId: 7,
      secondaryGroupIds: [],
      promotionGroupIds: [],
      purchasedGroupIds: [],
    },
    readOnly: false,
  });
  expect(actionsIn(form)).toEqual([groupActions.saveGroups]);
  await drawn(form, ["id", "actorPassword", "primaryGroupId", "secondary"]);
  const admin = await SuperAdminForm({ userId: 7, superAdmin: false });
  expect(actionsIn(admin)).toEqual([groupActions.saveSuperAdmin]);
  await drawn(admin, ["id", "actorPassword", "superAdmin"]);
});

test("the profile and appearance forms keep their actions and fields", async () => {
  const profile = await ProfileForm({
    userId: 7,
    readOnly: false,
    current: { about: "", location: "", website: "", customTitle: null },
  });
  expect(actionsIn(profile)).toEqual([profileActions.saveProfile]);
  await drawn(profile, [
    "id",
    "known",
    "was:about",
    "about",
    "location",
    "website",
    "customTitle",
    "clear-customTitle",
    "signature",
    "clear-signature",
    "reason",
  ]);
  const appearance = await AppearanceForm({
    userId: 7,
    readOnly: false,
    catalogs: { frames: [], accents: [], nameColours: [], covers: [] },
  });
  expect(actionsIn(appearance)).toEqual([appearanceActions.saveAppearance]);
  await drawn(appearance, [
    "id",
    "frameId",
    "accentId",
    "nameColorId",
    "coverPresetId",
    "reason",
  ]);
});

test("the sanctions forms warn, restrict and ban through their own actions", async () => {
  backend = fakeBackend({
    "warnings.list": () => Response.json({ items: [], nextCursor: null }),
    "warningTypes.list": () => Response.json({ items: [] }),
    "bans.list": () => Response.json({ items: [], nextCursor: null }),
  });
  const warnings = await Warnings({
    userId: 7,
    params: {},
    mayList: true,
    mayIssue: true,
    mayDelete: true,
    readOnly: false,
  });
  expect(actionsIn(warnings)).toEqual([sanctionActions.issueWarning]);
  await drawn(warnings, [
    "id",
    "points",
    "reason",
    "days",
    "notify",
    "message",
  ]);
  const restrictions = await Restrictions({
    userId: 7,
    mayList: false,
    mayChange: true,
    readOnly: false,
  });
  expect(actionsIn(restrictions)).toEqual([sanctionActions.addRestriction]);
  await drawn(restrictions, [
    "id",
    "kind",
    "reason",
    "days",
    "notify",
    "message",
  ]);
  const bans = await Bans({ userId: 7, params: {}, readOnly: false });
  expect(actionsIn(bans)).toEqual([sanctionActions.banMember]);
  await drawn(bans, ["id", "reason", "days", "permanent", "notify", "message"]);
});

test("the economy forms adjust credits and grant awards through their own actions", async () => {
  const adjust = await Adjust({ userId: 7, readOnly: false });
  expect(actionsIn(adjust)).toEqual([economyActions.adjustCredits]);
  await drawn(adjust, ["id", "amount", "reason", "confirm"]);
  backend = fakeBackend({
    "awards.memberGrants": () => Response.json({ items: [], nextCursor: null }),
    "awards.list": () => Response.json({ items: [] }),
  });
  const awards = await Awards({
    userId: 7,
    params: {},
    mayGrant: true,
    readOnly: false,
  });
  expect(actionsIn(awards)).toEqual([economyActions.grantAward]);
  await drawn(awards, ["id", "awardId", "reason"]);
});
