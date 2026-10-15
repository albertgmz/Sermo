import { describe, expect, test } from "bun:test";
import { createTestContext, insertUser } from "@sermo/core/testing";
import type { Ctx } from "../../context";
import { evaluate, loadFacts, type Rule } from "../../shared/criteria";
import { getAuth, promoteVerifiedMember } from "../auth";
import { registerEmailJobs } from "../email";
import { registerAccountEmailJobs } from "../email/account";
import { parseReferrer, REFERRAL_WINDOW_MS, recordReferral } from "./referrals";

const ORIGIN = "http://localhost:3000";
const DAY = 86_400_000;
let clients = 0;

/** A context, with account mail on when the site asks for email confirmation. */
function site(confirmByMail: boolean) {
  const ctx = createTestContext();
  if (confirmByMail) {
    registerEmailJobs(
      ctx,
      { driver: "capture", sender: "forum@example.test" },
      { defaults: {}, securityTypes: new Set() },
    );
    registerAccountEmailJobs(ctx);
  }
  const auth = getAuth(ctx);
  // Each request comes from its own address: Better Auth limits sign-ups and sign-ins per address.
  const post = (path: string, body: unknown) =>
    auth.handler(
      new Request(`${ORIGIN}/api/auth${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          "x-sermo-client-ip": `198.51.100.${++clients}`,
        },
        body: JSON.stringify(body),
      }),
    );
  const register = async (username: string, ref?: unknown) => {
    const response = await post("/sign-up/email", {
      name: username,
      username,
      email: `${username.toLowerCase()}@example.test`,
      password: "Password123!",
      ...(ref === undefined ? {} : { ref }),
    });
    expect(response.status).toBe(200);
    return Number(((await response.json()) as { user: { id: string } }).user.id);
  };
  const signIn = async (username: string) => {
    const response = await post("/sign-in/username", { username, password: "Password123!" });
    expect(response.status).toBe(200);
  };
  return { ctx, register, signIn };
}

const row = (ctx: Ctx, id: number) =>
  ctx.sqlite
    .prepare<
      {
        referred_by: number | null;
        referred_at: number | null;
        pending_referrer: number | null;
        referral_count: number;
      },
      [number]
    >("SELECT referred_by, referred_at, pending_referrer, referral_count FROM users WHERE id = ?1")
    .get(id)!;

const NONE = { referred_by: null, referred_at: null, pending_referrer: null, referral_count: 0 };

describe("registering with a referrer", () => {
  test("a site without email confirmation records the referrer at registration, once", async () => {
    const { ctx, register, signIn } = site(false);
    const referrer = await register("Referrer");
    const newcomer = await register("Newcomer", String(referrer));
    expect(row(ctx, newcomer)).toEqual({
      referred_by: referrer,
      referred_at: ctx.now(),
      pending_referrer: null,
      referral_count: 0,
    });
    expect(row(ctx, referrer).referral_count).toBe(1);
    // Signing in later records nothing more.
    await signIn("Newcomer");
    expect(row(ctx, referrer).referral_count).toBe(1);
  });

  test("the referrer may be a number as well as the text of one", async () => {
    const { ctx, register } = site(false);
    const referrer = await register("Referrer");
    const newcomer = await register("Newcomer", referrer);
    expect(row(ctx, newcomer).referred_by).toBe(referrer);
  });

  test("a referrer that is not a member id is dropped and the registration still works", async () => {
    const { ctx, register } = site(false);
    const referrer = await register("Referrer");
    let n = 0;
    for (const bad of ["abc", "0", "-1", "1e1", "0x1", " 1", "1.5", 0, -1, 1.5, null, true, [1]]) {
      const id = await register(`Visitor${++n}`, bad);
      expect(row(ctx, id)).toEqual(NONE);
    }
    expect(row(ctx, referrer).referral_count).toBe(0);
  });

  test("a missing, banned or erased referrer is dropped and the registration still works", async () => {
    const { ctx, register } = site(false);
    const banned = insertUser(ctx).id;
    const timed = insertUser(ctx).id;
    const erased = insertUser(ctx).id;
    ctx.sqlite.prepare("UPDATE users SET banned_permanently = 1 WHERE id = ?1").run(banned);
    ctx.sqlite
      .prepare("UPDATE users SET banned_until = ?1 WHERE id = ?2")
      .run(ctx.now() + DAY, timed);
    ctx.sqlite.prepare("UPDATE users SET erased_at = ?1 WHERE id = ?2").run(ctx.now(), erased);
    let n = 0;
    for (const target of [banned, timed, erased, 987654]) {
      const id = await register(`Visitor${++n}`, String(target));
      expect(row(ctx, id)).toEqual(NONE);
    }
    for (const target of [banned, timed, erased]) expect(row(ctx, target).referral_count).toBe(0);
    // A ban that has run out no longer counts.
    ctx.sqlite
      .prepare("UPDATE users SET banned_until = ?1 WHERE id = ?2")
      .run(ctx.now() - 1, timed);
    const later = await register("Later", String(timed));
    expect(row(ctx, later).referred_by).toBe(timed);
  });

  test("a site that asks for email confirmation holds the referrer until the first sign-in", async () => {
    const { ctx, register, signIn } = site(true);
    const referrer = await register("Referrer");
    const newcomer = await register("Newcomer", String(referrer));
    expect(row(ctx, newcomer)).toEqual({ ...NONE, pending_referrer: referrer });
    expect(row(ctx, referrer).referral_count).toBe(0);
    ctx.clock.advance(DAY);
    await signIn("Newcomer");
    expect(row(ctx, newcomer)).toEqual({
      referred_by: referrer,
      referred_at: ctx.now(),
      pending_referrer: null,
      referral_count: 0,
    });
    expect(row(ctx, referrer).referral_count).toBe(1);
    // A second sign-in counts nothing.
    await signIn("Newcomer");
    expect(row(ctx, referrer).referral_count).toBe(1);
  });

  test("confirming the address records it, and the next sign-in does not count it again", async () => {
    const { ctx, register, signIn } = site(true);
    const referrer = await register("Referrer");
    const newcomer = await register("Newcomer", String(referrer));
    expect(promoteVerifiedMember(ctx, newcomer)).toBe(true);
    expect(row(ctx, newcomer)).toMatchObject({ referred_by: referrer, pending_referrer: null });
    expect(row(ctx, referrer).referral_count).toBe(1);
    await signIn("Newcomer");
    expect(row(ctx, referrer).referral_count).toBe(1);
  });

  test("a held referrer is refused after seven days, and the sign-in still works", async () => {
    const { ctx, register, signIn } = site(true);
    const referrer = await register("Referrer");
    const newcomer = await register("Newcomer", String(referrer));
    ctx.clock.advance(REFERRAL_WINDOW_MS);
    await signIn("Newcomer");
    expect(row(ctx, newcomer)).toEqual(NONE);
    expect(row(ctx, referrer).referral_count).toBe(0);
  });

  test("the last moment of the window still records", async () => {
    const { ctx, register, signIn } = site(true);
    const referrer = await register("Referrer");
    const newcomer = await register("Newcomer", String(referrer));
    ctx.clock.advance(REFERRAL_WINDOW_MS - 1);
    await signIn("Newcomer");
    expect(row(ctx, newcomer).referred_by).toBe(referrer);
  });

  test("a held referrer who was banned meanwhile is refused, and the sign-in still works", async () => {
    const { ctx, register, signIn } = site(true);
    const referrer = await register("Referrer");
    const newcomer = await register("Newcomer", String(referrer));
    ctx.sqlite.prepare("UPDATE users SET banned_permanently = 1 WHERE id = ?1").run(referrer);
    await signIn("Newcomer");
    expect(row(ctx, newcomer)).toEqual(NONE);
    expect(row(ctx, referrer).referral_count).toBe(0);
  });

  test("a held referrer who left meanwhile is refused", async () => {
    const { ctx, register, signIn } = site(true);
    const referrer = await register("Referrer");
    const newcomer = await register("Newcomer", String(referrer));
    ctx.sqlite.prepare("UPDATE users SET erased_at = ?1 WHERE id = ?2").run(ctx.now(), referrer);
    await signIn("Newcomer");
    expect(row(ctx, newcomer)).toEqual(NONE);
  });

  test("a banned or missing referrer is never held", async () => {
    const { ctx, register } = site(true);
    const banned = insertUser(ctx).id;
    ctx.sqlite.prepare("UPDATE users SET banned_permanently = 1 WHERE id = ?1").run(banned);
    expect(row(ctx, await register("One", String(banned)))).toEqual(NONE);
    expect(row(ctx, await register("Two", "987654"))).toEqual(NONE);
  });

  test("the referrals criteria see the referral once, from either path", async () => {
    const { ctx, register, signIn } = site(true);
    const referrer = await register("Referrer");
    const newcomer = await register("Newcomer", String(referrer));
    promoteVerifiedMember(ctx, newcomer);
    await signIn("Newcomer");
    await signIn("Newcomer");
    const rule: Rule = {
      match: "all",
      conditions: [{ criterion: "referrals_at_least", value: 1 }],
    };
    const exactly: Rule = {
      match: "all",
      conditions: [
        { criterion: "referrals_at_least", value: 1 },
        { criterion: "referrals_this_month", value: 1 },
      ],
    };
    const facts = loadFacts(ctx, [referrer, newcomer], [rule, exactly]);
    expect(facts.get(referrer)).toMatchObject({ referralCount: 1, wasReferred: false });
    expect(facts.get(newcomer)).toMatchObject({ referralCount: 0, wasReferred: true });
    expect(evaluate(exactly, facts.get(referrer)!)).toBe(true);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>("SELECT count(*) AS n FROM users WHERE referred_by = ?1")
        .get(referrer)!.n,
    ).toBe(1);
  });
});

describe("recordReferral", () => {
  test("never the member themselves, nor the member they brought", () => {
    const ctx = createTestContext();
    const a = insertUser(ctx).id;
    const b = insertUser(ctx).id;
    expect(recordReferral(ctx, a, a)).toBe(false);
    expect(recordReferral(ctx, b, a)).toBe(true);
    expect(recordReferral(ctx, a, b)).toBe(false);
    expect(row(ctx, a)).toEqual({ ...NONE, referral_count: 1 });
    expect(row(ctx, b).referred_by).toBe(a);
  });

  test("a member has one referrer, counted once", () => {
    const ctx = createTestContext();
    const [a, b, c] = [insertUser(ctx).id, insertUser(ctx).id, insertUser(ctx).id];
    expect(recordReferral(ctx, c, a)).toBe(true);
    expect(recordReferral(ctx, c, a)).toBe(false);
    expect(recordReferral(ctx, c, b)).toBe(false);
    expect(row(ctx, a).referral_count).toBe(1);
    expect(row(ctx, b).referral_count).toBe(0);
    expect(row(ctx, c).referred_by).toBe(a);
  });

  test("only within seven days of the account", () => {
    const ctx = createTestContext();
    const [a, b] = [insertUser(ctx).id, insertUser(ctx).id];
    ctx.clock.advance(REFERRAL_WINDOW_MS);
    expect(recordReferral(ctx, b, a)).toBe(false);
    expect(row(ctx, a).referral_count).toBe(0);
  });

  test("a member who does not exist has no referrer", () => {
    const ctx = createTestContext();
    const a = insertUser(ctx).id;
    expect(recordReferral(ctx, 987654, a)).toBe(false);
  });
});

describe("parseReferrer", () => {
  test("takes a positive whole number, as a number or as plain decimal text", () => {
    expect(parseReferrer(7)).toBe(7);
    expect(parseReferrer("7")).toBe(7);
    expect(parseReferrer("1234567")).toBe(1234567);
    for (const bad of [
      0,
      -1,
      1.5,
      Number.NaN,
      "",
      "0",
      "07",
      "7a",
      "+7",
      "1e2",
      "0x10",
      " 7",
      undefined,
      null,
      {},
      [],
    ])
      expect(parseReferrer(bad)).toBeNull();
    expect(parseReferrer("9".repeat(17))).toBeNull();
  });
});
