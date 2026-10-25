import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { translator } from "@/lib/test-intl";
import {
  fakeBackend,
  refusal,
  tooManyWrongPasswords,
  wrongPassword,
} from "../groups/test-backend";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));

const identity = await import("./[id]/actions");
const groups = await import("./[id]/groups/actions");
const profile = await import("./[id]/profile/actions");
const appearance = await import("./[id]/appearance/actions");
const sanctions = await import("./[id]/sanctions/actions");
const economy = await import("./[id]/economy/actions");
const sessions = await import("./[id]/sessions/actions");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

const card = {
  id: 7,
  username: "wren",
  avatar: null,
  frame: null,
  nameColor: null,
  nameIcon: null,
  title: "",
  badges: [],
  restricted: false,
  level: 1,
};
const member = {
  card,
  email: "wren@example.com",
  emailVerified: true,
  state: "valid",
  erasedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  lastActivityAt: null,
  usernameChangedAt: null,
  postCount: 0,
  credits: 0,
  canEdit: true,
  isSuperAdmin: false,
  canSetSuperAdmin: false,
};

const ok = () => Response.json({ ok: true });

function form(fields: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    for (const one of Array.isArray(value) ? value : [value]) {
      data.append(name, one);
    }
  }
  return data;
}

async function redirectedTo(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    return String((error as { digest?: unknown }).digest);
  }
  return undefined;
}

const operations = () => backend?.asked.map((entry) => entry.operation);
const lastBody = () => backend?.asked.at(-1)?.body;

// Identity ------------------------------------------------------------------------------------

const identityForm = (fields: Record<string, string> = {}) =>
  form({
    id: "7",
    usernameWas: "wren",
    emailWas: "wren@example.com",
    verifiedWas: "1",
    username: "wren",
    email: "wren@example.com",
    emailVerified: "on",
    actorPassword: "secret",
    passwordMode: "keep",
    ...fields,
  });

test("a wrong administrator password shows on the password field and changes nothing", async () => {
  backend = fakeBackend({
    "users.adminUpdateIdentity": () => wrongPassword(),
  });
  expect(
    await identity.saveIdentity(null, identityForm({ username: "robin" })),
  ).toEqual({ fields: { actorPassword: "That is not your password." } });
  expect(operations()).toEqual(["users.adminUpdateIdentity"]);
});

test("the backend's limit message after too many wrong passwords is shown as it is", async () => {
  backend = fakeBackend({
    "users.adminUpdateIdentity": () => tooManyWrongPasswords(),
  });
  expect(
    await identity.saveIdentity(null, identityForm({ username: "robin" })),
  ).toEqual({
    fields: { actorPassword: "Too many wrong passwords. Try again later." },
  });
});

test("only what changed is sent, with the password", async () => {
  backend = fakeBackend({
    "users.adminUpdateIdentity": () => Response.json(member),
  });
  const digest = await redirectedTo(() =>
    identity.saveIdentity(
      null,
      identityForm({
        username: "robin",
        passwordMode: "set",
        password: "a-new-password",
      }),
    ),
  );
  expect(digest).toMatch(/;\/admin\/users\/7\?notice=identity;/);
  expect(operations()).toEqual(["users.adminUpdateIdentity"]);
  expect(lastBody()).toEqual({
    actorPassword: "secret",
    username: "robin",
    password: "a-new-password",
  });
});

test("a reset link is requested without a password, and the unverified flag is sent when changed", async () => {
  backend = fakeBackend({
    "users.adminUpdateIdentity": () => Response.json(member),
  });
  const data = identityForm({ passwordMode: "reset" });
  data.delete("emailVerified");
  const digest = await redirectedTo(() => identity.saveIdentity(null, data));
  expect(digest).toMatch(/notice=resetSent/);
  expect(lastBody()).toEqual({
    actorPassword: "secret",
    emailVerified: false,
    sendPasswordReset: true,
  });
});

test("the backend's answer when mail is not configured is shown at the top", async () => {
  backend = fakeBackend({
    "users.adminUpdateIdentity": () =>
      refusal(
        409,
        "conflict",
        "Mail is not configured, so no reset link can be sent.",
      ),
  });
  expect(
    await identity.saveIdentity(null, identityForm({ passwordMode: "reset" })),
  ).toEqual({
    error: "Mail is not configured, so no reset link can be sent.",
  });
});

test("a form with nothing changed says so and writes nothing", async () => {
  backend = fakeBackend({});
  expect(await identity.saveIdentity(null, identityForm())).toEqual({
    notice: messages.adminUsers.errors.unchanged,
  });
  expect(operations()).toEqual([]);
});

test("a new password that is empty, a bad mode and a bad id are refused locally", async () => {
  backend = fakeBackend({});
  expect(
    await identity.saveIdentity(null, identityForm({ passwordMode: "set" })),
  ).toEqual({ fields: { password: messages.adminUsers.errors.newPassword } });
  expect(
    await identity.saveIdentity(null, identityForm({ passwordMode: "wipe" })),
  ).toEqual({ error: messages.adminUsers.errors.passwordMode });
  expect(
    await identity.saveIdentity(null, identityForm({ id: "0x7" })),
  ).toEqual({ error: messages.adminUsers.errors.id });
});

test("removing a picture sends only that key", async () => {
  backend = fakeBackend({
    "users.adminUpdateProfile": () => Response.json(member),
  });
  const digest = await redirectedTo(() =>
    identity.removePicture(
      null,
      form({ id: "7", which: "cover", reason: "rules" }),
    ),
  );
  expect(digest).toMatch(/notice=coverRemoved/);
  expect(lastBody()).toEqual({ removeCover: true, reason: "rules" });
  expect(
    await identity.removePicture(null, form({ id: "7", which: "frame" })),
  ).toEqual({ error: messages.adminUsers.errors.id });
});

test("erasing needs the username typed as it is now and the password", async () => {
  backend = fakeBackend({
    "users.adminGet": () => Response.json(member),
    "users.adminErase": () => ok(),
  });
  expect(
    await identity.eraseMember(
      null,
      form({ id: "7", reason: "", confirmUsername: "wren" }),
    ),
  ).toEqual({ fields: { reason: messages.adminUsers.errors.reason } });
  expect(
    await identity.eraseMember(
      null,
      form({ id: "7", reason: "abuse", confirmUsername: "someone" }),
    ),
  ).toEqual({
    fields: { confirmUsername: messages.adminUsers.errors.confirmUsername },
  });
  expect(operations()).not.toContain("users.adminErase");
  const digest = await redirectedTo(() =>
    identity.eraseMember(
      null,
      form({
        id: "7",
        reason: "abuse",
        confirmUsername: "wren",
        actorPassword: "secret",
      }),
    ),
  );
  expect(digest).toMatch(/notice=erased/);
  expect(lastBody()).toEqual({
    actorPassword: "secret",
    reason: "abuse",
  });
});

test("the backend's refusal to erase a member who holds administration is shown", async () => {
  backend = fakeBackend({
    "users.adminGet": () => Response.json(member),
    "users.adminErase": () =>
      refusal(403, "forbidden", "This needs admin.permissions."),
  });
  expect(
    await identity.eraseMember(
      null,
      form({
        id: "7",
        reason: "abuse",
        confirmUsername: "wren",
        actorPassword: "secret",
      }),
    ),
  ).toEqual({ error: "This needs admin.permissions." });
});

// Groups --------------------------------------------------------------------------------------

test("groups are saved with the password in the same write, with the full secondary list", async () => {
  backend = fakeBackend({
    "users.setGroups": () =>
      Response.json({
        userId: 7,
        primaryGroupId: 3,
        secondaryGroupIds: [5, 6],
        promotionGroupIds: [],
        purchasedGroupIds: [],
        displayGroupId: 3,
        rank: 10,
      }),
  });
  const digest = await redirectedTo(() =>
    groups.saveGroups(
      null,
      form({
        id: "7",
        primaryGroupId: "3",
        secondary: ["5", "6"],
        actorPassword: "secret",
      }),
    ),
  );
  expect(digest).toMatch(/\/admin\/users\/7\/groups\?notice=saved/);
  expect(operations()).toEqual(["users.setGroups"]);
  expect(lastBody()).toEqual({
    primaryGroupId: 3,
    secondaryGroupIds: [5, 6],
    actorPassword: "secret",
  });
});

test("a wrong password for a group change shows on the password field", async () => {
  backend = fakeBackend({
    "users.setGroups": () => wrongPassword(),
  });
  expect(
    await groups.saveGroups(
      null,
      form({ id: "7", primaryGroupId: "3", actorPassword: "nope" }),
    ),
  ).toEqual({ fields: { actorPassword: "That is not your password." } });
  expect(
    await groups.saveGroups(
      null,
      form({ id: "7", primaryGroupId: "3", actorPassword: "" }),
    ),
  ).toEqual({
    fields: { actorPassword: messages.adminGroups.errors.password },
  });
  expect(operations()).toEqual(["users.setGroups"]);
});

test("a refusal that is not about the password stays at the top", async () => {
  backend = fakeBackend({
    "users.setGroups": () =>
      refusal(403, "forbidden", "You do not have permission to do that."),
  });
  expect(
    await groups.saveGroups(
      null,
      form({ id: "7", primaryGroupId: "3", actorPassword: "secret" }),
    ),
  ).toEqual({ error: "You do not have permission to do that." });
});

test("the super admin status is sent with the password", async () => {
  backend = fakeBackend({
    "users.setSuperAdmin": () => Response.json({ ok: true }),
  });
  const digest = await redirectedTo(() =>
    groups.saveSuperAdmin(
      null,
      form({ id: "7", superAdmin: "on", actorPassword: "secret" }),
    ),
  );
  expect(digest).toMatch(/\/admin\/users\/7\/groups\?notice=superAdminSaved/);
  expect(lastBody()).toEqual({
    superAdmin: true,
    actorPassword: "secret",
  });
  await redirectedTo(() =>
    groups.saveSuperAdmin(null, form({ id: "7", actorPassword: "secret" })),
  );
  expect(lastBody()).toMatchObject({ superAdmin: false });
});

test("a wrong password for the super admin status shows on the password field", async () => {
  backend = fakeBackend({ "users.setSuperAdmin": () => wrongPassword() });
  expect(
    await groups.saveSuperAdmin(
      null,
      form({ id: "7", superAdmin: "on", actorPassword: "nope" }),
    ),
  ).toEqual({ fields: { actorPassword: "That is not your password." } });
  expect(
    await groups.saveSuperAdmin(null, form({ id: "x", actorPassword: "nope" })),
  ).toEqual({ error: messages.adminUsers.errors.id });
});

test("group ids that are not record ids are refused before any call", async () => {
  backend = fakeBackend({});
  expect(
    await groups.saveGroups(
      null,
      form({ id: "7", primaryGroupId: "3", secondary: ["x"] }),
    ),
  ).toEqual({ error: messages.adminUsers.errors.groups });
  expect(
    await groups.applyPromotion(
      null,
      form({ id: "7", promotionId: "2", action: "delete" }),
    ),
  ).toEqual({ error: messages.adminUsers.errors.promotion });
});

const applied = {
  promotionId: 2,
  title: "Regulars",
  state: "manual",
  eligible: true,
  grantedGroupIds: [],
};

test("a promotion is applied to a member with the administrator's password in the write", async () => {
  const fields = { id: "7", promotionId: "2", action: "promote" };
  backend = fakeBackend({
    "promotions.apply": () => Response.json(applied),
  });
  expect(await groups.applyPromotion(null, form(fields))).toEqual({
    fields: { actorPassword: messages.adminGroups.errors.password },
  });
  expect(backend.asked).toEqual([]);
  backend.restore();
  backend = fakeBackend({
    "promotions.apply": () => wrongPassword(),
  });
  expect(
    await groups.applyPromotion(null, form({ ...fields, actorPassword: "no" })),
  ).toEqual({ fields: { actorPassword: "That is not your password." } });
  expect(backend.asked.map((call) => call.operation)).toEqual([
    "promotions.apply",
  ]);
  backend.restore();
  backend = fakeBackend({
    "promotions.apply": () => Response.json(applied),
  });
  await redirectedTo(() =>
    groups.applyPromotion(null, form({ ...fields, actorPassword: "secret" })),
  );
  // The password goes with the write: no call of its own before it.
  expect(backend.asked.map((call) => call.operation)).toEqual([
    "promotions.apply",
  ]);
  expect(backend.asked[0].body).toMatchObject({ actorPassword: "secret" });
});

// Profile and appearance ----------------------------------------------------------------------

test("the profile sends the shown fields, and the title and signature only when typed or cleared", async () => {
  backend = fakeBackend({
    "users.adminUpdateProfile": () => Response.json(member),
  });
  await redirectedTo(() =>
    profile.saveProfile(
      null,
      form({
        id: "7",
        known: "1",
        about: "Hello",
        "was:about": "Hi",
        location: "",
        "was:location": "Mars",
        website: "https://a.example",
        "was:website": "https://a.example",
        customTitle: "Founder",
        signature: "",
        "clear-signature": "on",
        reason: "fix",
      }),
    ),
  );
  // The website is posted as it was shown, so it is not sent.
  expect(lastBody()).toEqual({
    about: "Hello",
    location: "",
    customTitle: "Founder",
    signature: null,
    reason: "fix",
  });
  await redirectedTo(() =>
    profile.saveProfile(
      null,
      form({ id: "7", about: "", location: "", website: "", reason: "" }),
    ),
  );
  expect(lastBody()).toEqual({ reason: "" });
});

test("a field left as it was shown is not sent, so a change made meanwhile is not undone", async () => {
  backend = fakeBackend({
    "users.adminUpdateProfile": () => Response.json(member),
  });
  await redirectedTo(() =>
    profile.saveProfile(
      null,
      form({
        id: "7",
        known: "1",
        about: "As loaded",
        "was:about": "As loaded",
        location: "Mars",
        "was:location": "Mars",
        website: "",
        "was:website": "",
        reason: "",
      }),
    ),
  );
  expect(lastBody()).toEqual({ reason: "" });
});

test("the +18 switch is sent when changed, or when ticked on a profile whose mark could not be read", async () => {
  backend = fakeBackend({
    "users.adminUpdateProfile": () => Response.json(member),
  });
  const save = (fields: Record<string, string>) =>
    redirectedTo(() =>
      profile.saveProfile(
        null,
        form({ id: "7", reason: "", adultShown: "1", ...fields }),
      ),
    );
  await save({ "was:isAdult": "false", isAdult: "on" });
  expect(lastBody()).toEqual({ reason: "", isAdult: true });
  await save({ "was:isAdult": "true" });
  expect(lastBody()).toEqual({ reason: "", isAdult: false });
  // Left as it was shown: not sent.
  await save({ "was:isAdult": "true", isAdult: "on" });
  expect(lastBody()).toEqual({ reason: "" });
  // Not read: only a ticked box says something.
  await save({});
  expect(lastBody()).toEqual({ reason: "" });
  await save({ isAdult: "on" });
  expect(lastBody()).toEqual({ reason: "", isAdult: true });
});

test("a refusal naming a profile field is shown under it", async () => {
  backend = fakeBackend({
    "users.adminUpdateProfile": () =>
      Response.json(
        {
          error: {
            code: "validation",
            message: "Invalid",
            issues: [{ path: ["website"], message: "Use an http(s) URL." }],
          },
        },
        { status: 422 },
      ),
  });
  expect(
    await profile.saveProfile(
      null,
      form({ id: "7", known: "1", website: "x" }),
    ),
  ).toEqual({ fields: { website: "Use an http(s) URL." } });
});

test("appearance sends an id, null for take off, and nothing for a left choice", async () => {
  backend = fakeBackend({
    "users.adminUpdateProfile": () => Response.json(member),
  });
  await redirectedTo(() =>
    appearance.saveAppearance(
      null,
      form({
        id: "7",
        frameId: "4",
        accentId: "none",
        nameColorId: "",
        coverPresetId: "",
        reason: "",
      }),
    ),
  );
  expect(lastBody()).toEqual({
    frameId: 4,
    accentId: null,
    reason: "",
  });
  expect(
    await appearance.saveAppearance(
      null,
      form({ id: "7", frameId: "", accentId: "" }),
    ),
  ).toEqual({ notice: messages.adminUsers.errors.unchanged });
  expect(
    await appearance.saveAppearance(null, form({ id: "7", frameId: "abc" })),
  ).toEqual({ fields: { frameId: messages.adminUsers.errors.choice } });
});

// Sanctions -----------------------------------------------------------------------------------

test("a ban for days sends an end time; permanent sends null; neither is refused", async () => {
  backend = fakeBackend({ "bans.create": () => Response.json({ id: 9 }) });
  const before = Date.now();
  await redirectedTo(() =>
    sanctions.banMember(
      null,
      form({ id: "7", reason: "spam", days: "1", notify: "on" }),
    ),
  );
  const body = lastBody() as { expiresAt: string; notify: boolean };
  expect(body.notify).toBe(true);
  const end = Date.parse(body.expiresAt);
  expect(end).toBeGreaterThanOrEqual(before + 86_400_000);
  expect(end).toBeLessThan(before + 86_400_000 + 60_000);
  await redirectedTo(() =>
    sanctions.banMember(
      null,
      form({ id: "7", reason: "spam", permanent: "on" }),
    ),
  );
  expect(lastBody()).toMatchObject({
    expiresAt: null,
    notify: false,
  });
  expect(
    await sanctions.banMember(null, form({ id: "7", reason: "spam" })),
  ).toEqual({ fields: { days: messages.adminUsers.errors.daysOrPermanent } });
  expect(
    await sanctions.banMember(
      null,
      form({ id: "7", reason: "spam", days: "soon" }),
    ),
  ).toEqual({ fields: { days: messages.adminUsers.errors.days } });
});

test("a warning needs whole points or a type, and the days are optional", async () => {
  backend = fakeBackend({
    "warnings.create": () => Response.json({ id: 1, activePoints: 3 }),
  });
  await redirectedTo(() =>
    sanctions.issueWarning(
      null,
      form({ id: "7", points: "3", reason: "rude", days: "" }),
    ),
  );
  expect(lastBody()).toEqual({
    points: 3,
    reason: "rude",
    notify: false,
  });
  expect(
    await sanctions.issueWarning(null, form({ id: "7", points: "many" })),
  ).toEqual({ fields: { points: messages.adminUsers.errors.points } });
});

test("a warning of a type sends the type and only what was filled in", async () => {
  backend = fakeBackend({
    "warnings.create": () => Response.json({ id: 1, activePoints: 2 }),
  });
  await redirectedTo(() =>
    sanctions.issueWarning(
      null,
      form({ id: "7", typeId: "4", points: "", reason: " ", days: "" }),
    ),
  );
  expect(lastBody()).toEqual({ typeId: 4, notify: false });
  await redirectedTo(() =>
    sanctions.issueWarning(
      null,
      form({ id: "7", typeId: "4", points: "5", reason: "worse", days: "0" }),
    ),
  );
  expect(lastBody()).toEqual({
    typeId: 4,
    points: 5,
    reason: "worse",
    expiresAt: null,
    notify: false,
  });
  expect(
    await sanctions.issueWarning(null, form({ id: "7", typeId: "x" })),
  ).toEqual({ error: messages.adminUsers.errors.id });
});

test("lifting a ban of an erased member shows the backend's refusal", async () => {
  backend = fakeBackend({
    "bans.lift": () =>
      refusal(409, "conflict", "This account was erased; its ban stays."),
  });
  expect(await sanctions.liftBan(null, form({ id: "7", banId: "3" }))).toEqual({
    error: "This account was erased; its ban stays.",
  });
});

test("lifting from the register returns to the register", async () => {
  backend = fakeBackend({ "bans.lift": ok });
  expect(
    await redirectedTo(() => sanctions.liftBan(null, form({ banId: "3" }))),
  ).toMatch(/;\/admin\/bans\?notice=lifted;/);
});

test("a restriction takes one of the known kinds", async () => {
  backend = fakeBackend({});
  expect(
    await sanctions.addRestriction(
      null,
      form({ id: "7", kind: "everything", reason: "x" }),
    ),
  ).toEqual({ error: messages.adminUsers.errors.id });
});

// Economy and sessions ------------------------------------------------------------------------

test("an adjustment needs the confirmation and sends a signed amount", async () => {
  backend = fakeBackend({
    "credits.adjust": () =>
      Response.json({
        id: 1,
        userId: 7,
        amount: 50,
        balanceAfter: 50,
        type: "adjustment",
        source: null,
        actor: null,
        reason: "gift",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
  });
  expect(
    await economy.adjustCredits(
      null,
      form({ id: "7", amount: "50", reason: "gift" }),
    ),
  ).toEqual({ fields: { confirm: messages.adminUsers.errors.confirm } });
  expect(backend.asked).toEqual([]);
  await redirectedTo(() =>
    economy.adjustCredits(
      null,
      form({ id: "7", amount: "50", reason: "gift", confirm: "on" }),
    ),
  );
  expect(lastBody()).toEqual({ amount: 50, reason: "gift" });
  expect(
    await economy.adjustCredits(null, form({ id: "7", amount: "1.5" })),
  ).toEqual({ fields: { amount: messages.adminUsers.errors.amount } });
});

test("an award is granted and a grant revoked by their ids", async () => {
  backend = fakeBackend({ "awards.revoke": ok });
  await redirectedTo(() =>
    economy.revokeAward(
      null,
      form({ id: "7", memberAwardId: "12", reason: "x" }),
    ),
  );
  expect(backend.asked.at(-1)?.path).toBe("/api/v1/award-grants/12");
  expect(
    await economy.grantAward(null, form({ id: "7", awardId: "" })),
  ).toEqual({ fields: { awardId: messages.adminUsers.errors.award } });
});

test("one session or all of them", async () => {
  backend = fakeBackend({
    "users.adminRevokeSessions": () => Response.json({ revoked: 1 }),
  });
  await redirectedTo(() =>
    sessions.revokeSessions(null, form({ id: "7", sessionId: "5" })),
  );
  expect(lastBody()).toEqual({ sessionId: 5, reason: "" });
  const digest = await redirectedTo(() =>
    sessions.revokeSessions(null, form({ id: "7", reason: "stolen" })),
  );
  expect(digest).toMatch(/notice=allRevoked/);
  expect(lastBody()).toEqual({ reason: "stolen" });
  expect(
    await sessions.revokeSessions(null, form({ id: "7", sessionId: "-1" })),
  ).toEqual({ error: messages.adminUsers.errors.id });
});

test("the length of a sanction is the backend's to judge: zero and huge counts of days are sent or refused as dates", async () => {
  backend = fakeBackend({
    "bans.create": () => refusal(422, "validation", "Pick a later date."),
  });
  // No frontend ceiling: 36501 days is sent, and the backend's words come back.
  expect(
    await sanctions.banMember(
      null,
      form({ id: "7", reason: "x", days: "36501" }),
    ),
  ).toEqual({ error: "Pick a later date." });
  expect(backend.asked).toHaveLength(1);
  // A count that cannot be a date at all is refused here, not thrown.
  expect(
    await sanctions.banMember(
      null,
      form({ id: "7", reason: "x", days: "999999999999999" }),
    ),
  ).toEqual({ fields: { days: messages.adminUsers.errors.days } });
  expect(backend.asked).toHaveLength(1);
});
