import { afterEach, expect, test } from "bun:test";
import { GUEST } from "../../actor";
import { GROUP_IDS } from "../../db/schema";
import { accounts, closeAll, PASSWORD } from "../admin/fixtures.test";
import { runDueJobs } from "../jobs/queue";
import { getAuth } from "./index";

afterEach(closeAll);

const ORIGIN = "http://localhost:3000";
let visitor = 0;

/** A forum with an administrator, and `join`: a visitor's sign-up request, as the web app sends it. */
async function world(options: { mail?: boolean } = {}) {
  const w = await accounts(options);
  const founder = await w.register("Founder", 4);
  const settings = (changes: object) => w.run("settings.update", founder.actor, changes);
  const join = async (username: string, extra: object = {}) => {
    const response = await getAuth(w.ctx).handler(
      new Request(`${ORIGIN}/api/auth/sign-up/email`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          "x-sermo-client-ip": `198.51.100.${++visitor}`,
        },
        body: JSON.stringify({
          name: username,
          username,
          email: `${username.toLowerCase()}@example.test`,
          password: PASSWORD,
          ...extra,
        }),
      }),
    );
    const body = (await response.json()) as { code?: string; user?: { id: string } };
    return {
      status: response.status,
      code: body.code,
      id: body.user ? Number(body.user.id) : null,
    };
  };
  const row = (id: number) =>
    w.ctx.sqlite
      .prepare<
        {
          group_id: number;
          signup_review: string | null;
          location: string;
          website: string;
          about: string;
          birthday_md: string | null;
          birth_year: number | null;
          social_discord: string;
        },
        [number]
      >(
        "SELECT group_id, signup_review, location, website, about, birthday_md, birth_year, social_discord FROM users WHERE id = ?1",
      )
      .get(id);
  const members = () =>
    w.ctx.sqlite.prepare<{ n: number }, []>("SELECT count(*) AS n FROM users").get()!.n;
  return { ...w, founder, settings, join, row, members };
}

const yearsAgo = (ctx: { now(): number }, years: number, days = 0) => {
  const at = new Date(ctx.now() - days * 86_400_000);
  return { year: at.getUTCFullYear() - years, month: at.getUTCMonth() + 1, day: at.getUTCDate() };
};

test("the defaults keep registration as it was: open, nothing asked, no age", async () => {
  const w = await world();
  const settings = await w.settings({});
  expect(settings).toMatchObject({
    registrationOpen: true,
    minimumAge: 0,
    registrationFields: [],
    requireEmailConfirmation: true,
    approveSignups: false,
  });
  expect((await w.run("site.get", GUEST)).registration).toEqual({
    open: true,
    approval: false,
    minimumAge: 0,
    fields: [],
  });
  const joined = await w.join("Newcomer");
  expect(joined.status).toBe(200);
  expect(w.row(joined.id!)).toMatchObject({ group_id: 2, signup_review: null, birth_year: null });
});

test("a closed site refuses every visitor, and leaves no account", async () => {
  const w = await world();
  await w.settings({ registrationOpen: false });
  const before = w.members();
  expect(await w.join("Newcomer")).toMatchObject({ status: 403, code: "REGISTRATION_CLOSED" });
  expect(w.members()).toBe(before);
  expect((await w.run("site.get", GUEST)).registration.open).toBe(false);
  // The call the server makes for itself (the first administrator) has no visitor to refuse.
  expect((await w.register("Inside")).id).toBeGreaterThan(0);
  await w.settings({ registrationOpen: true });
  expect((await w.join("Newcomer")).status).toBe(200);
});

test("approval holds the account until staff approve it", async () => {
  const w = await world();
  await w.settings({ approveSignups: true });
  expect((await w.run("site.get", GUEST)).registration.approval).toBe(true);
  const joined = await w.join("Newcomer");
  expect(joined.status).toBe(200);
  expect(w.row(joined.id!)?.signup_review).toBe("pending");
  const waiting = await w.run("signups.list", w.founder.actor);
  expect(waiting.items.map((item: { user: { username: string } }) => item.user.username)).toEqual([
    "Newcomer",
  ]);
  const decided = await w.run("signups.decide", w.founder.actor, {
    userIds: [joined.id],
    decision: "approve",
  });
  expect(decided).toMatchObject({ done: 1, skipped: 0, failed: 0 });
  expect(w.row(joined.id!)?.signup_review).toBeNull();
  expect((await w.run("signups.list", w.founder.actor)).items).toEqual([]);
});

test("a minimum age asks for the date of birth and refuses a younger visitor", async () => {
  const w = await world();
  await w.settings({ minimumAge: 13 });
  expect((await w.run("site.get", GUEST)).registration).toMatchObject({
    minimumAge: 13,
    fields: ["birthday"],
  });
  const before = w.members();
  // No date, a date without its year, and a visitor one day short of the age.
  expect(await w.join("Nodate")).toMatchObject({
    status: 400,
    code: "REGISTRATION_FIELD_REQUIRED",
  });
  expect(await w.join("Noyear", { profile: { birthday: { month: 5, day: 5 } } })).toMatchObject({
    status: 400,
    code: "REGISTRATION_FIELD_REQUIRED",
  });
  const short = yearsAgo(w.ctx, 13, -1);
  expect(await w.join("Young", { profile: { birthday: short } })).toMatchObject({
    status: 403,
    code: "UNDER_MINIMUM_AGE",
  });
  expect(w.members()).toBe(before);
  // Turning thirteen today is old enough; the date is kept.
  const exact = yearsAgo(w.ctx, 13);
  const joined = await w.join("Exact", { profile: { birthday: exact } });
  expect(joined.status).toBe(200);
  expect(w.row(joined.id!)).toMatchObject({
    birth_year: exact.year,
    birthday_md: `${String(exact.month).padStart(2, "0")}-${String(exact.day).padStart(2, "0")}`,
  });
});

test("a date that does not exist, or lies in the future, is refused", async () => {
  const w = await world();
  await w.settings({ minimumAge: 13 });
  for (const birthday of [
    { year: 2001, month: 2, day: 30 },
    { year: new Date().getUTCFullYear() + 1, month: 1, day: 1 },
  ])
    expect(await w.join("Odd", { profile: { birthday } })).toMatchObject({
      status: 400,
      code: "INVALID_PROFILE_FIELD",
    });
});

test("a required field that is missing or blank is refused; a given one is stored", async () => {
  const w = await world();
  await w.settings({ registrationFields: ["location", "discord", "location"] });
  expect((await w.run("site.get", GUEST)).registration.fields).toEqual(["location", "discord"]);
  const before = w.members();
  expect(await w.join("Nothing")).toMatchObject({
    status: 400,
    code: "REGISTRATION_FIELD_REQUIRED",
  });
  expect(await w.join("Blank", { profile: { location: "  ", discord: "a#1" } })).toMatchObject({
    status: 400,
    code: "REGISTRATION_FIELD_REQUIRED",
  });
  expect(await w.join("Half", { profile: { location: "Havana" } })).toMatchObject({
    status: 400,
    code: "REGISTRATION_FIELD_REQUIRED",
  });
  expect(w.members()).toBe(before);
  const joined = await w.join("Full", {
    profile: { location: "  Havana ", discord: "full#1", website: "https://example.test" },
  });
  expect(joined.status).toBe(200);
  expect(w.row(joined.id!)).toMatchObject({
    location: "Havana",
    social_discord: "full#1",
    website: "https://example.test",
  });
});

test("a field the site does not require is optional, but must still be valid", async () => {
  const w = await world();
  expect(await w.join("Plain")).toMatchObject({ status: 200 });
  expect(await w.join("Bad", { profile: { website: "javascript:alert(1)" } })).toMatchObject({
    status: 400,
    code: "INVALID_PROFILE_FIELD",
  });
  const joined = await w.join("Chatty", { profile: { about: "Hello" } });
  expect(w.row(joined.id!)?.about).toBe("Hello");
});

test("the settings are bounded and the site says what the form asks", async () => {
  const w = await world();
  await expect(w.settings({ minimumAge: 100 })).rejects.toThrow();
  await expect(w.settings({ minimumAge: -1 })).rejects.toThrow();
  await expect(w.settings({ registrationFields: ["passport"] })).rejects.toThrow();
  await w.settings({ minimumAge: 18, registrationFields: ["about", "birthday"] });
  expect((await w.run("site.get", GUEST)).registration.fields).toEqual(["birthday", "about"]);
});

const mailTo = (w: Awaited<ReturnType<typeof world>>, address: string) =>
  w.capture!.messages.filter((message) => message.to === address);

test("with mail, a new account confirms its address by default", async () => {
  const w = await world({ mail: true });
  const joined = await w.join("Newcomer");
  expect(joined.status).toBe(200);
  expect(w.row(joined.id!)?.group_id).toBe(GROUP_IDS.unconfirmed);
  await runDueJobs(w.ctx);
  expect(mailTo(w, "newcomer@example.test")).toHaveLength(1);
});

test("with confirmation off, a new account is a member at once and gets no link; a resend still works", async () => {
  const w = await world({ mail: true });
  await w.settings({ requireEmailConfirmation: false });
  const joined = await w.join("Newcomer");
  expect(joined.status).toBe(200);
  expect(w.row(joined.id!)?.group_id).toBe(GROUP_IDS.member);
  await runDueJobs(w.ctx);
  expect(mailTo(w, "newcomer@example.test")).toHaveLength(0);
  // The member may still ask for a confirmation link of their own accord.
  const resent = await getAuth(w.ctx).handler(
    new Request(`${ORIGIN}/api/auth/send-verification-email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        "x-sermo-client-ip": `198.51.100.${++visitor}`,
      },
      body: JSON.stringify({ email: "newcomer@example.test" }),
    }),
  );
  expect(resent.status).toBe(200);
  await runDueJobs(w.ctx);
  expect(mailTo(w, "newcomer@example.test")).toHaveLength(1);
});

test("with confirmation off, an approved-by-hand sign-up waits for staff at once", async () => {
  const w = await world({ mail: true });
  await w.settings({ requireEmailConfirmation: false, approveSignups: true });
  const joined = await w.join("Newcomer");
  expect(w.row(joined.id!)).toMatchObject({ group_id: GROUP_IDS.member, signup_review: "pending" });
  const waiting = await w.run("signups.list", w.founder.actor);
  expect(waiting.items.map((item: { user: { username: string } }) => item.user.username)).toEqual([
    "Newcomer",
  ]);
});

test("without a mail driver the confirmation switch changes nothing", async () => {
  const w = await world();
  for (const on of [true, false]) {
    await w.settings({ requireEmailConfirmation: on });
    const joined = await w.join(`Person${on}`);
    expect(w.row(joined.id!)?.group_id).toBe(GROUP_IDS.member);
  }
});
