import { afterEach, describe, expect, test } from "bun:test";
import { expectNoTableScan } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { ForbiddenError, UnauthenticatedError, ValidationError } from "../../errors";
import { accounts, closeAll, PASSWORD } from "../admin/fixtures.test";
import { getAuth, markSessionsRevoked, resolveActor } from "../auth";
import { signUnsubscribe } from "../email/token";
import { runDueJobs } from "../jobs";
import { configureSecurity, resolveLocation } from "./config";
import { openGeoDatabase } from "./geo-maxmind";
import { securitySql } from "./index";
import {
  cleanCountry,
  cleanPlace,
  LOCATION_HEADERS,
  proxyLocation,
  requestLocation,
  setLocationHeaders,
} from "./location";
import { IP_LOG_PURGE_BATCH, purgeIpLog, registerSecurityJobs, retentionSql } from "./retention";
import {
  ACTIVE_STEP_MS,
  flushSessionActivity,
  noteSessionActive,
  sessionActivitySql,
} from "./session";

afterEach(closeAll);

const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0";
const GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const SPAIN = { country: "ES", region: "Catalonia", city: "Barcelona" };
const FRANCE = { country: "FR", region: "Occitanie", city: "Toulouse" };

type W = Awaited<ReturnType<typeof accounts>>;

function headers(
  ip: string,
  userAgent: string,
  location?: { country: string | null; region: string | null; city: string | null } | null,
) {
  const result = new Headers({ "x-sermo-client-ip": ip, "user-agent": userAgent });
  setLocationHeaders(result, location ?? null);
  return result;
}

function signIn(
  w: W,
  userAgent = CHROME,
  location: Parameters<typeof headers>[2] = SPAIN,
  ip = "203.0.113.10",
  email = "ada@example.test",
) {
  return getAuth(w.ctx).api.signInEmail({
    body: { email, password: PASSWORD },
    headers: headers(ip, userAgent, location),
  });
}

/** Signs in and returns the cookie of the new session. */
async function signInWithCookie(w: W, userAgent = CHROME, location = SPAIN) {
  const result = await getAuth(w.ctx).api.signInEmail({
    body: { email: "ada@example.test", password: PASSWORD },
    headers: headers("203.0.113.10", userAgent, location),
    returnHeaders: true,
  });
  return result.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
}

const rows = (w: W, userId: number) =>
  w.ctx.sqlite
    .prepare<
      { action: string; country: string | null; region: string | null; city: string | null },
      [number]
    >("SELECT action, country, region, city FROM ip_log WHERE user_id = ?1 ORDER BY id")
    .all(userId);

describe("location headers", () => {
  test("a location travels as encoded headers and comes back whole", () => {
    const sent = new Headers({ [LOCATION_HEADERS.city]: "stale" });
    setLocationHeaders(sent, { country: "CH", region: "Zürich", city: "Zürich" });
    expect(requestLocation(sent)).toEqual({ country: "CH", region: "Zürich", city: "Zürich" });
    // Replacing with nothing leaves nothing behind.
    setLocationHeaders(sent, null);
    expect(requestLocation(sent)).toBeNull();
    expect(requestLocation(undefined)).toBeNull();
  });

  test("the proxy's values are cleaned: unknown countries, controls, length and encoding", () => {
    expect(cleanCountry("es")).toBe("ES");
    expect(cleanCountry("XX")).toBeNull();
    expect(cleanCountry("T1")).toBeNull();
    expect(cleanCountry("ESP")).toBeNull();
    expect(cleanPlace("  Ma\u0000drid\n")).toBe("Madrid");
    expect(cleanPlace("x".repeat(500))).toHaveLength(100);
    expect(cleanPlace("")).toBeNull();
    // UTF-8 that a server read as Latin-1 is put back; text that was read right is left alone.
    expect(cleanPlace("SÃ£o Paulo")).toBe("São Paulo");
    expect(cleanPlace("Zürich")).toBe("Zürich");
    expect(
      proxyLocation(
        new Headers({ "cf-ipcountry": "BR", "cf-region": "S%C3%A3o%20Paulo", "cf-ipcity": "" }),
      ),
    ).toEqual({ country: "BR", region: "São Paulo", city: null });
    expect(proxyLocation(new Headers())).toBeNull();
  });
});

describe("the optional location database", () => {
  test("with no database nothing is looked up, and the reported location wins when there is one", () => {
    const w = accounts();
    return w.then(({ ctx }) => {
      expect(resolveLocation(ctx, "203.0.113.5", null)).toEqual({
        country: null,
        region: null,
        city: null,
      });
      configureSecurity(ctx, { geoLookup: () => FRANCE });
      expect(resolveLocation(ctx, "203.0.113.5", null)).toEqual(FRANCE);
      expect(resolveLocation(ctx, "203.0.113.5", SPAIN)).toEqual(SPAIN);
      // Not an address: not looked up.
      expect(resolveLocation(ctx, "unknown", null).country).toBeNull();
    });
  });

  test("no database path means no lookup, and a path with no file is an error at start", async () => {
    expect(await openGeoDatabase(null)).toBeNull();
    expect(await openGeoDatabase("")).toBeNull();
    await expect(openGeoDatabase(".tmp-run/absent/GeoLite2-City.mmdb")).rejects.toThrow(
      "not found",
    );
  });

  test("a lookup that fails or knows nothing never fails the caller", async () => {
    const { ctx } = await accounts();
    const quiet = console.error;
    console.error = () => {};
    try {
      configureSecurity(ctx, {
        geoLookup: () => {
          throw new Error("corrupt database");
        },
      });
      expect(resolveLocation(ctx, "203.0.113.5", null).country).toBeNull();
    } finally {
      console.error = quiet;
    }
    configureSecurity(ctx, { geoLookup: () => null });
    expect(resolveLocation(ctx, "203.0.113.5", null).country).toBeNull();
  });

  test("the log stores the place: the proxy's, else the database's, else none", async () => {
    const w = await accounts();
    const ada = await w.register("Ada");
    await signIn(w, CHROME, SPAIN);
    await signIn(w, CHROME, null);
    configureSecurity(w.ctx, { geoLookup: () => FRANCE });
    await signIn(w, CHROME, null);
    await signIn(w, CHROME, SPAIN);
    expect(rows(w, ada.id)).toEqual([
      { action: "sign_in", ...SPAIN },
      { action: "sign_in", country: null, region: null, city: null },
      { action: "sign_in", ...FRANCE },
      { action: "sign_in", ...SPAIN },
    ]);
  });

  test("a request's place reaches the actor and the rows its actions write", async () => {
    const w = await accounts();
    const ada = await w.register("Ada");
    const cookie = await signInWithCookie(w);
    const resolved = await resolveActor(
      w.ctx,
      new Headers({
        cookie,
        "x-sermo-client-ip": "203.0.113.11",
        "user-agent": CHROME,
        ...Object.fromEntries(
          Object.entries(LOCATION_HEADERS).map(([part, name]) => [
            name,
            SPAIN[part as keyof typeof SPAIN],
          ]),
        ),
      }),
    );
    expect(resolved.actor).toMatchObject({ kind: "user", userId: ada.id, clientLocation: SPAIN });
  });
});

describe("sign-in history", () => {
  test("lists the member's successful and failed sign-ins, newest first, with device and place", async () => {
    const w = await accounts();
    const ada = await w.register("Ada");
    const bob = await w.register("Bob");
    await signIn(w, CHROME, SPAIN);
    await expect(
      getAuth(w.ctx).api.signInEmail({
        body: { email: "ada@example.test", password: "wrong-password" },
        headers: headers("198.51.100.5", FIREFOX, FRANCE),
      }),
    ).rejects.toBeDefined();
    await signIn(w, FIREFOX, null);
    // Posts and others' sign-ins are not sign-ins of Ada's.
    await getAuth(w.ctx).api.signInEmail({
      body: { email: "bob@example.test", password: PASSWORD },
      headers: headers("203.0.113.99", CHROME, SPAIN),
    });
    const history = await w.run("auth.signInHistory", ada.actor, {});
    expect(history.items).toHaveLength(3);
    expect(history.items.map((item: { result: string }) => item.result)).toEqual([
      "success",
      "failed",
      "success",
    ]);
    expect(history.items[0]).toMatchObject({
      device: { browser: "Firefox", os: "GNU/Linux", isBot: false },
      location: null,
    });
    expect(history.items[1]).toMatchObject({
      device: { browser: "Firefox" },
      location: FRANCE,
    });
    expect(history.items[2]).toMatchObject({
      device: { browser: "Chrome", os: "Windows" },
      location: SPAIN,
    });
    // Nothing but those fields: no address in the member's history.
    expect(Object.keys(history.items[0]).sort()).toEqual([
      "at",
      "device",
      "id",
      "location",
      "result",
    ]);
    expect((await w.run("auth.signInHistory", ada.actor, { limit: 2 })).items).toHaveLength(2);
    expect((await w.run("auth.signInHistory", bob.actor, {})).items).toHaveLength(1);
  });

  test("only a signed-in browser session may ask", async () => {
    const w = await accounts();
    const ada = await w.register("Ada");
    await expect(w.run("auth.signInHistory", GUEST, {})).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    await expect(
      w.run("auth.signInHistory", { ...ada.actor, kind: "token", tokenId: 1 }, {}),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(w.run("auth.signInHistory", ada.actor, { limit: 1000 })).rejects.toBeDefined();
  });

  test("the history and the new-device check read their partial index", async () => {
    const w = await accounts();
    expectNoTableScan(w.ctx, securitySql.signIns, [1, 20]);
    expectNoTableScan(w.ctx, sessionActivitySql.seen, [1, "Chrome", "Windows", "ES"]);
    const plan = w.ctx.sqlite
      .prepare<{ detail: string }, [number, number]>(`EXPLAIN QUERY PLAN ${securitySql.signIns}`)
      .all(1, 20)
      .map((row) => row.detail)
      .join(" ");
    expect(plan).toContain("ip_log_member_sign_in");
    expect(plan).not.toContain("TEMP B-TREE");
  });
});

describe("sessions show when they were last used and where they were opened", () => {
  test("auth.sessionDevices carries the place and the last use", async () => {
    const w = await accounts();
    const ada = await w.register("Ada");
    await signIn(w, FIREFOX, FRANCE);
    const list = await w.run("auth.sessionDevices", ada.actor, {});
    expect(list.items[0]).toMatchObject({
      location: FRANCE,
      lastActiveAt: "2026-01-01T00:00:00.000Z",
    });
    // The session the registration opened predates the record.
    expect(list.items[1]).toMatchObject({ location: null, lastActiveAt: null });
  });

  test("last use is noted at most once per step and written by the flush, not by requests", async () => {
    const w = await accounts();
    const ada = await w.register("Ada");
    const cookie = await signInWithCookie(w);
    const session = w.ctx.sqlite
      .prepare<{ id: number }, [number]>(
        "SELECT id FROM auth_session WHERE user_id = ?1 ORDER BY id DESC",
      )
      .get(ada.id)!.id;
    const stored = () =>
      w.ctx.sqlite
        .prepare<{ last_active_at: number }, [number]>(
          "SELECT last_active_at FROM session_activity WHERE session_id = ?1",
        )
        .get(session)?.last_active_at;
    const opened = w.ctx.now();
    expect(stored()).toBe(opened);
    const request = () =>
      resolveActor(w.ctx, new Headers({ cookie, "x-sermo-client-ip": "203.0.113.10" }));
    w.ctx.clock.advance(ACTIVE_STEP_MS + 1_000);
    await request();
    await request();
    await request();
    // Requests only note; nothing is written until the flush.
    expect(stored()).toBe(opened);
    expect(flushSessionActivity(w.ctx)).toBe(1);
    expect(stored()).toBe(w.ctx.clock.now());
    // Inside the step the session is not noted again.
    const used = w.ctx.clock.now();
    w.ctx.clock.advance(ACTIVE_STEP_MS - 1_000);
    await request();
    expect(flushSessionActivity(w.ctx)).toBe(0);
    expect(stored()).toBe(used);
    // After the step it is.
    w.ctx.clock.advance(2_000);
    await request();
    expect(flushSessionActivity(w.ctx)).toBe(1);
    expect(stored()).toBe(w.ctx.clock.now());
  });

  test("a session that predates the record gets a row, one that is gone gets none, time never goes back", async () => {
    const w = await accounts();
    const ada = await w.register("Ada");
    const session = w.ctx.sqlite
      .prepare<{ id: number }, [number]>("SELECT id FROM auth_session WHERE user_id = ?1")
      .get(ada.id)!.id;
    noteSessionActive(w.ctx, session);
    noteSessionActive(w.ctx, 99_999);
    expect(flushSessionActivity(w.ctx)).toBe(2);
    const count = () =>
      w.ctx.sqlite.prepare<{ n: number }, []>("SELECT count(*) AS n FROM session_activity").get()!
        .n;
    expect(count()).toBe(1);
    // A late note older than the stored time does not move it back.
    w.ctx.sqlite.run("UPDATE session_activity SET last_active_at = last_active_at + 99999999");
    w.ctx.clock.advance(ACTIVE_STEP_MS + 1);
    noteSessionActive(w.ctx, session);
    flushSessionActivity(w.ctx);
    expect(
      w.ctx.sqlite
        .prepare<{ v: number }, []>("SELECT last_active_at AS v FROM session_activity")
        .get()!.v,
    ).toBeGreaterThan(w.ctx.clock.now());
    // The row goes with its session.
    w.ctx.sqlite.prepare("DELETE FROM auth_session WHERE id = ?1").run(session);
    expect(count()).toBe(0);
  });

  test("a session list shows a use that is still waiting for the flush", async () => {
    const w = await accounts();
    const ada = await w.register("Ada");
    const session = w.ctx.sqlite
      .prepare<{ id: number }, [number]>("SELECT id FROM auth_session WHERE user_id = ?1")
      .get(ada.id)!.id;
    noteSessionActive(w.ctx, session);
    const list = await w.run("auth.sessionDevices", ada.actor, {});
    expect(list.items[0].lastActiveAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("the new-sign-in alert", () => {
  async function mailed(w: W): Promise<{ to: string; subject: string; text: string }[]> {
    await runDueJobs(w.ctx);
    return w.capture!.messages as { to: string; subject: string; text: string }[];
  }
  const setup = async () => {
    const w = await accounts({ mail: true });
    const ada = await w.register("Ada");
    return { w, ada };
  };

  test("the first sign-in, and a repeat from the same browser and country, send nothing", async () => {
    const { w } = await setup();
    await signIn(w, CHROME, SPAIN);
    await signIn(w, CHROME, SPAIN, "203.0.113.77");
    await signIn(w, CHROME, SPAIN);
    expect((await mailed(w)).filter((message) => message.subject.includes("sign-in"))).toEqual([]);
  });

  test("a new browser sends the mail with a This wasn't me link", async () => {
    const { w } = await setup();
    await signIn(w, CHROME, SPAIN);
    await signIn(w, FIREFOX, SPAIN);
    const messages = (await mailed(w)).filter((message) => message.subject.includes("sign-in"));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ to: "ada@example.test" });
    expect(messages[0]!.text).toContain("Firefox on GNU/Linux");
    expect(messages[0]!.text).toContain("Barcelona, Catalonia, Spain");
    expect(messages[0]!.text).toMatch(/This wasn't me: http:\/\/localhost:3000\/not-me\?token=\S+/);
    // The same new browser again is no longer new.
    await signIn(w, FIREFOX, SPAIN);
    expect((await mailed(w)).filter((message) => message.subject.includes("sign-in"))).toHaveLength(
      1,
    );
  });

  test("a new country sends it, in the member's language", async () => {
    const { w, ada } = await setup();
    w.ctx.sqlite.prepare("UPDATE users SET language = 'es' WHERE id = ?1").run(ada.id);
    await signIn(w, CHROME, SPAIN);
    await signIn(w, CHROME, FRANCE);
    const messages = (await mailed(w)).filter((message) => message.subject.includes("inicio"));
    expect(messages).toHaveLength(1);
    expect(messages[0]!.text).toContain("Toulouse, Occitanie, Francia");
    expect(messages[0]!.text).toContain("No fui yo: ");
    await signIn(w, CHROME, FRANCE);
    expect((await mailed(w)).filter((message) => message.subject.includes("inicio"))).toHaveLength(
      1,
    );
  });

  test("a crawler never triggers it", async () => {
    const { w } = await setup();
    await signIn(w, CHROME, SPAIN);
    await signIn(w, GOOGLEBOT, FRANCE);
    expect((await mailed(w)).filter((message) => message.subject.includes("sign-in"))).toHaveLength(
      0,
    );
  });

  test("an unknown browser or country, or history without them, cannot be new", async () => {
    const { w } = await setup();
    // First sign-ins with no browser and no place on record.
    await signIn(w, "", null);
    await signIn(w, "", null);
    // Now a browser and a country appear: there is nothing recorded to compare them with.
    await signIn(w, FIREFOX, FRANCE);
    expect((await mailed(w)).filter((message) => message.subject.includes("sign-in"))).toHaveLength(
      0,
    );
    // And an unknown place after known ones is not a new country.
    await signIn(w, FIREFOX, null);
    expect((await mailed(w)).filter((message) => message.subject.includes("sign-in"))).toHaveLength(
      0,
    );
  });

  test("failed sign-ins are not sign-ins: a browser seen only failing is still new", async () => {
    const { w } = await setup();
    await signIn(w, CHROME, SPAIN);
    await expect(
      getAuth(w.ctx).api.signInEmail({
        body: { email: "ada@example.test", password: "wrong-password" },
        headers: headers("198.51.100.9", FIREFOX, SPAIN),
      }),
    ).rejects.toBeDefined();
    expect((await mailed(w)).filter((message) => message.subject.includes("sign-in"))).toHaveLength(
      0,
    );
    await signIn(w, FIREFOX, SPAIN);
    expect((await mailed(w)).filter((message) => message.subject.includes("sign-in"))).toHaveLength(
      1,
    );
  });

  test("registration is not a sign-in: the first real sign-in sends nothing", async () => {
    const w = await accounts({ mail: true });
    await getAuth(w.ctx).api.signUpEmail({
      body: { name: "Eve", username: "Eve", email: "eve@example.test", password: PASSWORD },
      headers: headers("203.0.113.20", CHROME, SPAIN),
    });
    await signIn(w, FIREFOX, FRANCE, "203.0.113.21", "eve@example.test");
    expect((await mailed(w)).filter((message) => message.subject.includes("sign-in"))).toHaveLength(
      0,
    );
  });

  test("without mail the sign-in still works and nothing is queued", async () => {
    const w = await accounts();
    await w.register("Ada");
    await signIn(w, CHROME, SPAIN);
    await signIn(w, FIREFOX, FRANCE);
    expect(w.ctx.sqlite.prepare<{ n: number }, []>("SELECT count(*) AS n FROM jobs").get()!.n).toBe(
      0,
    );
  });
});

describe("the This wasn't me link", () => {
  async function linkFor(w: W) {
    await signIn(w, CHROME, SPAIN);
    await signIn(w, FIREFOX, SPAIN);
    await runDueJobs(w.ctx);
    const text = w.capture!.messages.findLast((message) =>
      message.subject.includes("sign-in"),
    )!.text;
    return decodeURIComponent(/token=(\S+)/.exec(text)![1]!);
  }

  test("signs the member out everywhere, once, and leaves other members alone", async () => {
    const w = await accounts({ mail: true });
    const ada = await w.register("Ada");
    const bob = await w.register("Bob");
    const token = await linkFor(w);
    expect(w.sessions(ada.id)).toBe(3);
    expect(w.sessions(bob.id)).toBe(1);
    // Anyone holding the link can use it: it needs no session.
    const result = await w.run("auth.notMe", GUEST, { token });
    expect(result).toEqual({ revoked: 3 });
    expect(w.sessions(ada.id)).toBe(0);
    expect(w.sessions(bob.id)).toBe(1);
    // Used: it is dead now.
    await expect(w.run("auth.notMe", GUEST, { token })).rejects.toBeInstanceOf(ValidationError);
    // A session opened afterwards is not touched by a second try either.
    w.ctx.clock.advance(1_000);
    await signIn(w, CHROME, SPAIN);
    await expect(w.run("auth.notMe", GUEST, { token })).rejects.toBeInstanceOf(ValidationError);
    expect(w.sessions(ada.id)).toBe(1);
  });

  test("expires after a week", async () => {
    const w = await accounts({ mail: true });
    await w.register("Ada");
    const token = await linkFor(w);
    w.ctx.clock.advance(7 * 24 * 60 * 60_000 + 1);
    await expect(w.run("auth.notMe", GUEST, { token })).rejects.toBeInstanceOf(ValidationError);
  });

  test("is dead once the member's sessions were cut after the sign-in it is about", async () => {
    const w = await accounts({ mail: true });
    const ada = await w.register("Ada");
    const token = await linkFor(w);
    w.ctx.clock.advance(1_000);
    markSessionsRevoked(w.ctx, ada.id);
    await expect(w.run("auth.notMe", GUEST, { token })).rejects.toBeInstanceOf(ValidationError);
  });

  test("a forged, altered or foreign token does nothing", async () => {
    const w = await accounts({ mail: true });
    const ada = await w.register("Ada");
    const token = await linkFor(w);
    const [payload, signature] = token.split(".") as [string, string];
    const other = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), userId: 999 }),
    ).toString("base64url");
    for (const bad of [
      `${other}.${signature}`,
      `${payload}.${signature.slice(0, -2)}AA`,
      payload,
      "x".repeat(40),
      `${payload}.`,
      // A signature made for another kind of link never opens this one.
      await signUnsubscribe(w.ctx, ada.id, "all"),
    ])
      await expect(w.run("auth.notMe", GUEST, { token: bad })).rejects.toBeInstanceOf(
        ValidationError,
      );
    expect(w.sessions(ada.id)).toBe(3);
  });

  test("an erased account has no link", async () => {
    const w = await accounts({ mail: true });
    const ada = await w.register("Ada");
    const token = await linkFor(w);
    w.ctx.sqlite.prepare("UPDATE users SET erased_at = ?1 WHERE id = ?2").run(w.ctx.now(), ada.id);
    await expect(w.run("auth.notMe", GUEST, { token })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("retention", () => {
  const insert = (w: W, userId: number, at: number, count = 1) => {
    const statement = w.ctx.sqlite.prepare(
      "INSERT INTO ip_log (user_id, ip, ip_net, action, created_at) VALUES (?1, '203.0.113.1', '203.0.113.1', 'post', ?2)",
    );
    for (let i = 0; i < count; i++) statement.run(userId, at + i);
  };
  const total = (w: W) =>
    w.ctx.sqlite.prepare<{ n: number }, []>("SELECT count(*) AS n FROM ip_log").get()!.n;
  const DAY = 86_400_000;

  test("deletes rows older than the age, in bounded batches, and keeps the rest", async () => {
    const w = await accounts();
    const ada = await w.register("Ada");
    const now = w.ctx.now();
    insert(w, ada.id, now - 181 * DAY, IP_LOG_PURGE_BATCH * 2 + 5);
    insert(w, ada.id, now - 179 * DAY, 3);
    insert(w, ada.id, now, 2);
    expect(total(w)).toBe(IP_LOG_PURGE_BATCH * 2 + 10);
    // Each batch is its own transaction: count the write transactions the purge opens.
    let begins = 0;
    const transaction = w.ctx.db.transaction.bind(w.ctx.db);
    w.ctx.db.transaction = ((...args: Parameters<typeof transaction>) => {
      begins++;
      return transaction(...args);
    }) as typeof w.ctx.db.transaction;
    expect(await purgeIpLog(w.ctx)).toBe(IP_LOG_PURGE_BATCH * 2 + 5);
    w.ctx.db.transaction = transaction;
    expect(begins).toBe(3);
    expect(total(w)).toBe(5);
  });

  test("the age is a configuration value, 180 days by default", async () => {
    const w = await accounts();
    const ada = await w.register("Ada");
    const now = w.ctx.now();
    insert(w, ada.id, now - 100 * DAY);
    insert(w, ada.id, now - 10 * DAY);
    expect(await purgeIpLog(w.ctx)).toBe(0);
    configureSecurity(w.ctx, { ipLogRetentionDays: 30 });
    expect(await purgeIpLog(w.ctx)).toBe(1);
    expect(total(w)).toBe(1);
    expect((await w.run("privacy.logRetention", GUEST, {})).days).toBe(30);
  });

  test("the daily job runs it and the delete reads the created_at index", async () => {
    const w = await accounts();
    const ada = await w.register("Ada");
    insert(w, ada.id, w.ctx.now() - 400 * DAY, 4);
    registerSecurityJobs(w.ctx);
    const { runDailyTasks } = await import("../jobs/scheduler");
    runDailyTasks(w.ctx);
    runDailyTasks(w.ctx);
    expect(
      w.ctx.sqlite
        .prepare<{ n: number }, []>(
          "SELECT count(*) AS n FROM jobs WHERE type = 'security.retention'",
        )
        .get()!.n,
    ).toBe(1);
    await runDueJobs(w.ctx);
    expect(total(w)).toBe(0);
    const plan = w.ctx.sqlite
      .prepare<{ detail: string }, [number, number]>(`EXPLAIN QUERY PLAN ${retentionSql.purge}`)
      .all(0, 10)
      .map((row) => row.detail)
      .join(" ");
    expect(plan).toContain("ip_log_created_at");
  });
});
