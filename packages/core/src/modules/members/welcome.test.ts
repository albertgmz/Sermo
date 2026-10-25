import { afterEach, describe, expect, test } from "bun:test";
import { ValidationError } from "../../errors";
import { closeAll } from "../admin/fixtures.test";
import { PASSWORD, queueWorld } from "../admin/signup-fixtures.test";
import { getAuth } from "../auth";
import { readSiteSettings, storeSiteSettings } from "../settings";

afterEach(closeAll);

type World = Awaited<ReturnType<typeof queueWorld>>;

const CUSTOM = { subject: "Hello {name}", body: "Welcome aboard, {name}!" };

/** The welcome message on, from the founder, for a site that holds nobody back by default. */
async function enable(w: World, welcome: Record<string, unknown> = {}) {
  await w.run("settings.update", w.founder.actor, {
    approveSignups: false,
    welcomeMessage: { enabled: true, senderId: null, ...CUSTOM, ...welcome },
  });
}

/** The conversations a member is in, with the first message of each. */
function inbox(w: World, userId: number) {
  return w.ctx.sqlite
    .prepare<
      {
        id: number;
        title: string;
        starter: number;
        body_source: string;
        body_html: string;
        participants: number;
      },
      [number]
    >(
      `SELECT c.id, c.title, c.user_id AS starter, m.body_source, m.body_html, c.participant_count AS participants
       FROM conversation_participants p
       JOIN conversations c ON c.id = p.conversation_id
       JOIN conversation_messages m ON m.id = c.last_message_id
       WHERE p.user_id = ?1 ORDER BY c.id`,
    )
    .all(userId);
}

const setLanguage = (w: World, id: number, language: string) =>
  w.ctx.sqlite.prepare("UPDATE users SET language = ?1 WHERE id = ?2").run(language, id);

describe("who is welcomed, and when", () => {
  test("a member who confirms the email gets one conversation from the sender, with the name filled in", async () => {
    const w = await queueWorld({ mail: true });
    await enable(w);
    const newcomer = await w.join("Newcomer");
    expect(inbox(w, newcomer.id)).toEqual([]);
    w.confirm(newcomer.id);
    const [welcome, ...rest] = inbox(w, newcomer.id);
    expect(rest).toEqual([]);
    expect(welcome).toMatchObject({
      title: "Hello Newcomer",
      starter: w.founder.id,
      body_source: "Welcome aboard, Newcomer!",
      participants: 2,
    });
    expect(welcome?.body_html).toContain("Welcome aboard, Newcomer!");
    // The sender has the conversation, already read: nothing to alert them to.
    const read = w.ctx.sqlite
      .prepare<{ last_read_message_id: number; last_message_id: number }, [number, number]>(
        "SELECT p.last_read_message_id, c.last_message_id FROM conversation_participants p JOIN conversations c ON c.id = p.conversation_id WHERE p.conversation_id = ?1 AND p.user_id = ?2",
      )
      .get(welcome!.id, w.founder.id)!;
    expect(read.last_read_message_id).toBe(read.last_message_id);
    const alerts = w.ctx.sqlite
      .prepare<{ n: number }, [number]>(
        "SELECT count(*) AS n FROM notifications WHERE user_id = ?1",
      )
      .get(w.founder.id)!;
    expect(alerts.n).toBe(0);
  });

  test("a sign-up that needs no confirmation is welcomed at once", async () => {
    const w = await queueWorld();
    await enable(w);
    const newcomer = await w.join("Newcomer");
    expect(inbox(w, newcomer.id).map((c) => c.title)).toEqual(["Hello Newcomer"]);
  });

  test("nothing is sent while the setting is off", async () => {
    const w = await queueWorld({ mail: true });
    await w.run("settings.update", w.founder.actor, { approveSignups: false });
    const newcomer = await w.join("Newcomer");
    w.confirm(newcomer.id);
    expect(inbox(w, newcomer.id)).toEqual([]);
  });

  test("a site that approves sign-ups welcomes after the approval, not before", async () => {
    const w = await queueWorld({ mail: true });
    await enable(w, {});
    await w.run("settings.update", w.founder.actor, { approveSignups: true });
    const newcomer = await w.join("Newcomer");
    w.confirm(newcomer.id);
    expect(inbox(w, newcomer.id)).toEqual([]);
    await w.run("signups.decide", w.founder.actor, {
      userIds: [newcomer.id],
      decision: "approve",
    });
    expect(inbox(w, newcomer.id).map((c) => c.title)).toEqual(["Hello Newcomer"]);
  });

  test("an administrator who confirms the address by hand welcomes the member", async () => {
    const w = await queueWorld({ mail: true });
    await enable(w);
    const newcomer = await w.join("Newcomer");
    await w.run("users.adminUpdateIdentity", w.founder.actor, {
      userId: newcomer.id,
      actorPassword: PASSWORD,
      emailVerified: true,
    });
    expect(inbox(w, newcomer.id)).toHaveLength(1);
  });

  test("an administrator who moves the member out of Unconfirmed welcomes the member", async () => {
    const w = await queueWorld({ mail: true });
    await enable(w);
    const newcomer = await w.join("Newcomer");
    await w.run("users.setGroups", w.founder.actor, { userId: newcomer.id, primaryGroupId: 2 });
    expect(inbox(w, newcomer.id)).toHaveLength(1);
  });

  test("it is sent once: a second confirmation, a group change or a retry sends nothing more", async () => {
    const w = await queueWorld({ mail: true });
    await enable(w);
    const newcomer = await w.join("Newcomer");
    w.confirm(newcomer.id);
    w.confirm(newcomer.id);
    // Held again and confirmed again (the repair of an account, a second link).
    w.ctx.sqlite.prepare("UPDATE users SET group_id = 5 WHERE id = ?1").run(newcomer.id);
    w.confirm(newcomer.id);
    await w.run("users.setGroups", w.founder.actor, { userId: newcomer.id, primaryGroupId: 3 });
    await w.run("users.setGroups", w.founder.actor, { userId: newcomer.id, primaryGroupId: 2 });
    expect(inbox(w, newcomer.id)).toHaveLength(1);
  });

  test("members who were there before are never welcomed, whatever happens to them later", async () => {
    // Regular signed up, and was a member at once, before the message existed.
    const w = await queueWorld();
    await enable(w);
    await w.run("users.setGroups", w.founder.actor, {
      userId: w.member.id,
      primaryGroupId: 3,
    });
    await w.run("users.setGroups", w.founder.actor, {
      userId: w.member.id,
      primaryGroupId: 2,
    });
    expect(inbox(w, w.member.id)).toEqual([]);
  });

  test("an account that signed up while the message was off and confirms after it was turned on is welcomed", async () => {
    const w = await queueWorld({ mail: true });
    await w.run("settings.update", w.founder.actor, { approveSignups: false });
    const newcomer = await w.join("Newcomer");
    await enable(w);
    w.confirm(newcomer.id);
    expect(inbox(w, newcomer.id)).toHaveLength(1);
  });
});

describe("the text", () => {
  test("an empty text uses the default in the language the member signed up in", async () => {
    const w = await queueWorld({ mail: true });
    await enable(w, { subject: "", body: "" });
    const spanish = await w.join("Ana");
    const english = await w.join("Ben");
    setLanguage(w, spanish.id, "es");
    setLanguage(w, english.id, "en");
    w.confirm(spanish.id);
    w.confirm(english.id);
    const es = inbox(w, spanish.id)[0]!;
    const en = inbox(w, english.id)[0]!;
    expect(es.title).toMatch(/bienvenida/i);
    expect(es.body_source).toContain("Ana");
    expect(en.title).toMatch(/welcome/i);
    expect(en.body_source).toContain("Ben");
    expect(es.body_source).not.toContain("{name}");
    expect(en.body_source).not.toContain("{name}");
  });

  test("a member with no language of their own gets the site's default language", async () => {
    const w = await queueWorld({ mail: true });
    await enable(w, { subject: "", body: "" });
    await w.run("settings.update", w.founder.actor, { defaultLanguage: "es" });
    const newcomer = await w.join("Newcomer");
    w.ctx.sqlite.prepare("UPDATE users SET language = NULL WHERE id = ?1").run(newcomer.id);
    w.confirm(newcomer.id);
    expect(inbox(w, newcomer.id)[0]?.title).toMatch(/bienvenida/i);
  });

  test("the sender is the chosen member, else the first administrator", async () => {
    const w = await queueWorld({ mail: true });
    await enable(w, { senderId: w.moderator.id });
    const first = await w.join("First");
    w.confirm(first.id);
    expect(inbox(w, first.id)[0]?.starter).toBe(w.moderator.id);
    await enable(w, { senderId: null });
    const second = await w.join("Second");
    w.confirm(second.id);
    expect(inbox(w, second.id)[0]?.starter).toBe(w.founder.id);
  });
});

describe("what it does not depend on", () => {
  test("the sender's flood and conversation limits do not stop it", async () => {
    const w = await queueWorld({ mail: true });
    await enable(w);
    await w.run("settings.update", w.founder.actor, { floodSeconds: 3600 });
    w.ctx.sqlite
      .prepare("UPDATE users SET restricted_conversations_until = ?1 WHERE id = ?2")
      .run(Number.MAX_SAFE_INTEGER, w.founder.id);
    const first = await w.join("First");
    const second = await w.join("Second");
    w.confirm(first.id);
    w.confirm(second.id);
    expect(inbox(w, first.id)).toHaveLength(1);
    expect(inbox(w, second.id)).toHaveLength(1);
  });

  test("a message that cannot be sent is logged and the confirmation still goes through", async () => {
    const w = await queueWorld({ mail: true });
    await enable(w);
    // The text quotes a post that is not there: it renders for nobody.
    storeSiteSettings(w.ctx, {
      ...readSiteSettings(w.ctx),
      welcomeMessage: {
        enabled: true,
        senderId: null,
        subject: "Hello",
        body: '[QUOTE="Ada, post: 999999, member: 1"]hi[/QUOTE]',
      },
    });
    const newcomer = await w.join("Newcomer");
    const errors: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void errors.push(args);
    try {
      expect(w.confirm(newcomer.id)).toBe(true);
    } finally {
      console.error = original;
    }
    expect(inbox(w, newcomer.id)).toEqual([]);
    expect(errors.map((args) => args[0])).toContain("[members.welcome]");
    const group = w.ctx.sqlite
      .prepare<{ group_id: number }, [number]>("SELECT group_id FROM users WHERE id = ?1")
      .get(newcomer.id)!;
    expect(group.group_id).toBe(2);
    // Mended, the next time the account is confirmed it is welcomed: nothing was marked as sent.
    storeSiteSettings(w.ctx, {
      ...readSiteSettings(w.ctx),
      welcomeMessage: { enabled: true, senderId: null, subject: "Hello", body: "Fine" },
    });
    w.ctx.sqlite.prepare("UPDATE users SET group_id = 5 WHERE id = ?1").run(newcomer.id);
    w.confirm(newcomer.id);
    expect(inbox(w, newcomer.id)).toHaveLength(1);
  });

  test("the sign-up itself goes through when the sender is gone", async () => {
    const w = await queueWorld();
    await enable(w);
    w.ctx.sqlite.prepare("UPDATE users SET group_id = 2 WHERE id = ?1").run(w.founder.id);
    const logged: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void logged.push(args);
    try {
      const response = await getAuth(w.ctx).api.signUpEmail({
        body: {
          name: "Late",
          username: "Late",
          email: "late@example.test",
          password: "Password123!",
        },
        asResponse: true,
      });
      expect(response.status).toBe(200);
    } finally {
      console.error = original;
    }
    expect(logged.map((args) => args[0])).toEqual(["[members.welcome]"]);
  });
});

describe("the setting", () => {
  test("round-trips through settings.update and settings.get; off with no sender by default", async () => {
    const w = await queueWorld();
    expect((await w.run("settings.get", w.founder.actor, {})).welcomeMessage).toEqual({
      enabled: false,
      senderId: null,
      subject: "",
      body: "",
    });
    const saved = {
      enabled: true,
      senderId: w.moderator.id,
      subject: "Hello {name}",
      body: "Glad you came, {name}.",
    };
    await w.run("settings.update", w.founder.actor, { welcomeMessage: saved });
    expect((await w.run("settings.get", w.founder.actor, {})).welcomeMessage).toEqual(saved);
    // Other keys keep it.
    await w.run("settings.update", w.founder.actor, { siteName: "Other" });
    expect((await w.run("settings.get", w.founder.actor, {})).welcomeMessage).toEqual(saved);
  });

  test("a sender who is not a member, and a text that cannot be sent, are refused when saved", async () => {
    const w = await queueWorld();
    const save = (welcomeMessage: Record<string, unknown>) =>
      w.run("settings.update", w.founder.actor, {
        welcomeMessage: { enabled: true, subject: "", body: "", senderId: null, ...welcomeMessage },
      });
    const unknown = await save({ senderId: 999_999 }).catch((error) => error);
    expect(unknown).toBeInstanceOf(ValidationError);
    expect(unknown.issues[0].path).toEqual(["welcomeMessage", "senderId"]);
    const unsendable = await save({
      body: '[QUOTE="Ada, post: 999999, member: 1"]hi[/QUOTE]',
    }).catch((error) => error);
    expect(unsendable).toBeInstanceOf(ValidationError);
    expect(unsendable.issues[0].path).toEqual(["welcomeMessage", "body"]);
  });
});
