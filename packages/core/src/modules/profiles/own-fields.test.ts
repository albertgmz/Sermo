import { describe, expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { SermoError, ValidationError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { resolvedActor, sharedDatabase } from "../../permissions/test-contexts";
import { type World, world } from "../members/fixtures.test";

const update = (w: World, actor: object, input: object) => w.call("profiles.update", actor, input);
const stored = (w: World, id: number, column: string) =>
  w.ctx.sqlite
    .prepare<Record<string, unknown>, [number]>(`SELECT ${column} FROM users WHERE id = ?1`)
    .get(id)?.[column];
const cardTitle = async (w: World, id: number) =>
  (await w.call("users.cards", w.memberActor, { userIds: [id] })).items[0].title as string;

describe("a signature is one small block", () => {
  const refused: [string, string][] = [
    ["an image", "[IMG]http://example.test/p.png[/IMG]"],
    ["a heading", "[HEADING=1]Heading[/HEADING]"],
    ["a list", "[LIST][*]one[*]two[/LIST]"],
    ["a quote", "[QUOTE]quoted[/QUOTE]"],
    ["a table", "[TABLE][TR][TD]a[/TD][/TR][/TABLE]"],
    ["a code block", "[CODE]code[/CODE]"],
    ["a rule", "[HR]"],
    ["two paragraphs", "one\n\ntwo"],
    ["text and a block", "text [CENTER]block[/CENTER]"],
  ];
  for (const [name, signature] of refused)
    test(`${name} is refused and nothing is stored`, async () => {
      const w = world();
      await update(w, w.moderatorActor, { signature: "kept" });
      const error = await update(w, w.moderatorActor, { signature }).catch((e) => e);
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as SermoError).issues?.[0]?.path).toEqual(["signature"]);
      expect(stored(w, w.moderator.id, "signature_source")).toBe("kept");
    });

  const accepted: [string, string, string][] = [
    ["bold", "[B]bold[/B]", "<strong>bold</strong>"],
    ["italic", "[I]italic[/I]", "<em>italic</em>"],
    ["strikethrough", "[S]gone[/S]", "<del>gone</del>"],
    ["a link", "[URL=https://example.test]site[/URL]", '<a href="https://example.test"'],
    ["a bare link", "see https://example.test", '<a href="https://example.test"'],
    ["inline code", "use [ICODE]code[/ICODE] here", "<code>code</code>"],
    ["a line break", "one\ntwo", "<br"],
    ["typed Markdown, as text", "**not bold** and `not code`", "**not bold** and `not code`"],
    ["typed HTML, as text", "text <b>bold</b>", "text &lt;b&gt;bold&lt;/b&gt;"],
  ];
  for (const [name, signature, html] of accepted)
    test(`${name} is accepted and stored`, async () => {
      const w = world();
      const profile = await update(w, w.moderatorActor, { signature });
      expect(profile.signatureHtml).toContain(html);
      expect(stored(w, w.moderator.id, "signature_source")).toBe(signature);
      expect(String(stored(w, w.moderator.id, "signature_html"))).toContain(html);
    });

  test("a mention stays plain text", async () => {
    const w = world();
    const profile = await update(w, w.moderatorActor, {
      signature: `hello @${w.member.username}`,
    });
    expect(profile.signatureHtml).toBe(`<p>hello @${w.member.username}</p>`);
  });
});

describe("invisible characters", () => {
  test("a website with control or invisible characters is refused", async () => {
    const w = world();
    for (const website of [
      "https://example.test/\u0007",
      "https://exa​mple.test",
      "https://example.test/‮",
      "https://exam﻿ple.test",
    ])
      await expect(update(w, w.memberActor, { website })).rejects.toBeInstanceOf(ValidationError);
    expect(stored(w, w.member.id, "website")).toBe("");
    await update(w, w.memberActor, { website: "https://example.test/ok" });
  });

  test("a title of only invisible characters is stored as NULL and the card falls back", async () => {
    const w = world();
    const fallback = await cardTitle(w, w.moderator.id);
    await update(w, w.moderatorActor, { customTitle: "Boss" });
    expect(await cardTitle(w, w.moderator.id)).toBe("Boss");
    const profile = await update(w, w.moderatorActor, { customTitle: "​‎﻿\u0007" });
    expect(profile.customTitle).toBeNull();
    expect(stored(w, w.moderator.id, "custom_title")).toBeNull();
    expect(await cardTitle(w, w.moderator.id)).toBe(fallback);
  });

  test("invisible characters around and inside a title are stripped", async () => {
    const w = world();
    const profile = await update(w, w.moderatorActor, {
      customTitle: "​The‮ big\u0000 bo﻿ss‏",
    });
    expect(profile.customTitle).toBe("The big boss");
    expect(stored(w, w.moderator.id, "custom_title")).toBe("The big boss");
    expect(await cardTitle(w, w.moderator.id)).toBe("The big boss");
  });

  test("the length limit counts what is stored", async () => {
    const w = world();
    await w.call("settings.update", w.adminActor, { customTitleMaxLength: 10 });
    await update(w, w.moderatorActor, { customTitle: `${"​".repeat(30)}${"x".repeat(10)}` });
    expect(stored(w, w.moderator.id, "custom_title")).toBe("x".repeat(10));
  });
});

describe("the custom title on a profile", () => {
  test("profiles.get shows it only while the member may, profiles.self always", async () => {
    const w = world();
    await update(w, w.moderatorActor, { customTitle: "Boss" });
    const get = () => w.call("profiles.get", w.memberActor, { userId: w.moderator.id });
    expect((await get()).customTitle).toBe("Boss");
    expect((await w.call("profiles.self", w.moderatorActor, {})).customTitle).toBe("Boss");
    w.ctx.sqlite.run(`UPDATE users SET group_id = 2 WHERE id = ${w.moderator.id}`);
    const lost = await get();
    expect(lost.customTitle).toBeNull();
    expect(lost.card.title).toBe("Member");
    const self = await w.call("profiles.self", w.moderatorActor, {});
    expect(self.customTitle).toBe("Boss");
    expect(self.profile.customTitle).toBeNull();
    expect(self.may.setCustomTitle).toBe(false);
  });

  test("a member who lost the permission can still clear it, not set one", async () => {
    const w = world();
    await update(w, w.moderatorActor, { customTitle: "Boss", signature: "sig" });
    w.ctx.sqlite.run(`UPDATE users SET group_id = 2 WHERE id = ${w.moderator.id}`);
    await expect(update(w, w.moderatorActor, { customTitle: "New" })).rejects.toThrow();
    await expect(update(w, w.moderatorActor, { signature: "new" })).rejects.toThrow();
    await update(w, w.moderatorActor, { customTitle: null, signature: null });
    expect(stored(w, w.moderator.id, "custom_title")).toBeNull();
    expect(stored(w, w.moderator.id, "signature_source")).toBeNull();
    expect(stored(w, w.moderator.id, "signature_html")).toBeNull();
  });
});

describe("unlimited award slots", () => {
  test("-1 is returned as it is and no award is cut", async () => {
    const w = world();
    const group = w.group({ title: "All", rank: 12 });
    w.ctx.sqlite.run(
      `INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) SELECT id, 0, ${group}, 0, -1 FROM permission_definitions WHERE key = 'profile.awardSlots'`,
    );
    w.ctx.sqlite.run(
      `INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) SELECT id, 0, ${group}, 0, 1 FROM permission_definitions WHERE key = 'profile.editOwn'`,
    );
    const user = w.user({ groupId: group });
    const actor = userActor(user);
    for (let i = 0; i < 8; i++) w.hold(user.id, w.award({ name: `a${i}`, tier: "bronze", xp: i }));
    const get = await w.call("profiles.get", w.memberActor, { userId: user.id });
    expect(get.awardSlots).toBe(-1);
    expect((await w.call("profiles.self", actor, {})).profile.awardSlots).toBe(-1);
    expect((await update(w, actor, { about: "x" })).awardSlots).toBe(-1);
    const authors = await w.call("users.authors", w.memberActor, { userIds: [user.id] });
    expect(authors.items[0].awards).toHaveLength(8);
  });
});

describe("profiles.update checks the actor's standing inside the transaction", () => {
  const op = (name: string) => getOperation(name);
  async function scenario() {
    const fixture = createTestContext();
    const founder = userActor(insertUser(fixture, { groupId: 4 }));
    const group = (await execute(fixture, op("groups.create"), founder, {
      title: "Writers",
      rank: 20,
    })) as { id: number };
    await execute(fixture, op("permissions.set"), founder, {
      groupId: group.id,
      entries: ["profile.editOwn", "profile.customTitle", "profile.signature"].map(
        (permission) => ({
          permission,
          value: "allow",
        }),
      ),
    });
    const member = insertUser(fixture, { groupId: group.id });
    const database = sharedDatabase(fixture);
    const here = database.open();
    const elsewhere = database.open();
    const actor = resolvedActor(here, member.id);
    return { database, here, elsewhere, founder, member, actor };
  }
  type Scenario = Awaited<ReturnType<typeof scenario>>;
  const row = (s: Scenario) =>
    JSON.stringify(
      s.elsewhere.sqlite
        .prepare("SELECT custom_title, signature_source, signature_html, about FROM users")
        .all(),
    );
  const revocations = {
    "their group is changed": (s: Scenario) =>
      execute(s.elsewhere, op("users.setGroups"), s.founder, {
        userId: s.member.id,
        primaryGroupId: 2,
      }),
    banned: (s: Scenario) =>
      execute(s.elsewhere, op("bans.create"), s.founder, {
        userId: s.member.id,
        reason: "Abuse",
        expiresAt: null,
      }),
  };
  for (const [revoked, revoke] of Object.entries(revocations))
    for (const input of [{ customTitle: "Boss" }, { signature: "hello" }])
      test(`${Object.keys(input)[0]} is refused to a member whose standing changed (${revoked})`, async () => {
        const s = await scenario();
        try {
          await revoke(s);
          const before = row(s);
          await expect(execute(s.here, op("profiles.update"), s.actor, input)).rejects.toThrow(
            SermoError,
          );
          expect(row(s)).toBe(before);
        } finally {
          s.database.close();
        }
      });

  test("a member whose standing did not change sets both from a second process", async () => {
    const s = await scenario();
    try {
      await execute(s.here, op("profiles.update"), s.actor, {
        customTitle: "Boss",
        signature: "hello",
      });
      expect(row(s)).toContain("Boss");
    } finally {
      s.database.close();
    }
  });
});
