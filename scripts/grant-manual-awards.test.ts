import { afterEach, describe, expect, test } from "bun:test";
import { type Ctx, closeContext, ensureAdmin } from "@sermo/core";
import { createTestContext } from "@sermo/core/testing";
import { createApp } from "../packages/api/src/app";
import {
  type AwardHolders,
  credentialsFrom,
  type Dependencies,
  formatSummary,
  grantManualAwards,
  MAX_WRITES_PER_SECOND,
  parseArgs,
  parseHolders,
} from "./grant-manual-awards-lib";

const origin = "http://localhost:3000";
const password = "Password123!";
const contexts: Ctx[] = [];
let nextIp = 1;
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

async function site() {
  const ctx = createTestContext();
  contexts.push(ctx);
  const app = createApp(ctx, { trustedProxyHeader: null });
  // Better Auth limits sign-ups and sign-ins per address: every request comes from a new one.
  const env = {
    requestIP: () => ({
      address: `10.${Math.floor(nextIp / 62500) % 250}.${Math.floor(nextIp / 250) % 250}.${nextIp++ % 250}`,
      family: "IPv4" as const,
      port: 1,
    }),
  };
  const request = (path: string, init: RequestInit = {}) => app.request(path, init, env);
  const post = (path: string, body: object, cookie?: string) =>
    request(`/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
  const cookieOf = (response: Response) =>
    response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
  await ensureAdmin(ctx, { username: "admin", email: "admin@example.test", password });
  const adminCookie = cookieOf(
    await post("/sign-in/email", { email: "admin@example.test", password }),
  );
  const created = await post("/api-key/create", { name: "grants", password }, adminCookie);
  const apiKey = ((await created.json()) as { key: string }).key;
  const member = async (username: string) => {
    const response = await post("/sign-up/email", {
      name: username,
      username,
      email: `${username}@example.test`,
      password,
    });
    if (!response.ok) throw new Error(await response.text());
    return {
      id: Number(((await response.json()) as { user: { id: string } }).user.id),
      cookie: cookieOf(response),
    };
  };
  const members = [await member("anna"), await member("bruno"), await member("carla")];
  const adminJson = async (method: string, path: string, body?: object) => {
    const response = await request(`/api/v1${path}`, {
      method,
      headers: { "content-type": "application/json", origin, cookie: adminCookie },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    expect(response.status, await response.clone().text()).toBeLessThan(300);
    return (await response.json()) as { id: number };
  };
  const award = (name: string, extra: object = {}) =>
    adminJson("POST", "/awards", { name, tier: "silver", xp: 20, ...extra });
  const holdersOf = async (awardId: number) =>
    (
      (await (
        await request(`/api/v1/awards/${awardId}/holders?limit=100`, {
          headers: { "x-api-key": apiKey },
        })
      ).json()) as { items: { user: { id: number } }[] }
    ).items
      .map((grant) => grant.user.id)
      .sort((a, b) => a - b);

  const calls: { method: string; path: string }[] = [];
  const sleeps: number[] = [];
  const logs: string[] = [];
  let intercept: ((method: string, path: string) => Response | undefined) | undefined;
  let rewrite: ((path: string) => string) | undefined;
  const deps: Dependencies = {
    fetch: async (url, init) => {
      const target = new URL(url);
      const path = target.pathname + target.search;
      calls.push({ method: String(init.method), path });
      return intercept?.(String(init.method), path) ?? request(rewrite?.(path) ?? path, init);
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    log: (line) => logs.push(line),
  };
  return {
    ctx,
    apiKey,
    adminCookie,
    members,
    award,
    holdersOf,
    calls,
    sleeps,
    logs,
    deps,
    setRewrite: (fn: typeof rewrite) => {
      rewrite = fn;
    },
    setIntercept: (fn: typeof intercept) => {
      intercept = fn;
    },
  };
}

const options = { url: origin, dryRun: false, perSecond: MAX_WRITES_PER_SECOND };
const writes = (calls: { method: string }[]) => calls.filter((c) => c.method === "POST");

describe("grant manual awards", () => {
  test("grants every holder once and a second run changes nothing", async () => {
    const s = await site();
    const diverse = await s.award("Género Diverso");
    const security = await s.award("Defensor de la Seguridad", { tier: "gold", xp: 30 });
    const [anna, bruno, carla] = s.members.map((m) => m.id);
    const holders: AwardHolders[] = [
      { name: "Género Diverso", xenforoTrophyId: 18, userIds: [anna!, bruno!, carla!] },
      { name: "Defensor de la Seguridad", xenforoTrophyId: 16, userIds: [bruno!] },
    ];

    const first = await grantManualAwards(options, { apiKey: s.apiKey }, holders, s.deps);
    expect(first.map((x) => [x.granted, x.alreadyHeld, x.refused, x.failed])).toEqual([
      [3, 0, 0, 0],
      [1, 0, 0, 0],
    ]);
    expect(await s.holdersOf(diverse.id)).toEqual([anna!, bruno!, carla!].sort((a, b) => a - b));
    expect(await s.holdersOf(security.id)).toEqual([bruno!]);
    expect(writes(s.calls)).toHaveLength(4);

    s.calls.length = 0;
    const second = await grantManualAwards(options, { apiKey: s.apiKey }, holders, s.deps);
    expect(second.map((x) => [x.granted, x.alreadyHeld, x.failed])).toEqual([
      [0, 3, 0],
      [0, 1, 0],
    ]);
    expect(writes(s.calls)).toHaveLength(0);
    expect(await s.holdersOf(diverse.id)).toHaveLength(3);
    expect(formatSummary(second, false)).toContain(
      "Género Diverso: 3 holders, 0 granted, 3 already held",
    );
  });

  test("a dry run reads and writes nothing, and says who would be granted", async () => {
    const s = await site();
    const diverse = await s.award("Género Diverso");
    const [anna, bruno] = s.members.map((m) => m.id);
    const holders: AwardHolders[] = [
      { name: "Género Diverso", xenforoTrophyId: 18, userIds: [anna!, bruno!] },
    ];
    await grantManualAwards(
      options,
      { apiKey: s.apiKey },
      [{ ...holders[0]!, userIds: [anna!] }],
      s.deps,
    );
    s.calls.length = 0;

    const summary = await grantManualAwards(
      { ...options, dryRun: true },
      { apiKey: s.apiKey },
      holders,
      s.deps,
    );
    expect(summary[0]).toMatchObject({ pending: 1, alreadyHeld: 1, granted: 0 });
    expect(writes(s.calls)).toHaveLength(0);
    expect(s.logs).toContain(`  would grant to member ${bruno}`);
    expect(await s.holdersOf(diverse.id)).toEqual([anna!]);
    expect(formatSummary(summary, true)).toContain("1 to grant");
  });

  test("the current holders are read page by page, so a rerun skips all of them", async () => {
    const s = await site();
    await s.award("Género Diverso");
    const ids = s.members.map((m) => m.id);
    const holders: AwardHolders[] = [{ name: "Género Diverso", xenforoTrophyId: 18, userIds: ids }];
    await grantManualAwards(options, { apiKey: s.apiKey }, holders, s.deps);
    s.calls.length = 0;
    // The server pages by one member, so the script must follow the cursor to see all three.
    s.setRewrite((path) => path.replace("limit=100", "limit=1"));
    const second = await grantManualAwards(options, { apiKey: s.apiKey }, holders, s.deps);
    expect(second[0]).toMatchObject({ granted: 0, alreadyHeld: 3, refused: 0 });
    expect(writes(s.calls)).toHaveLength(0);
    expect(s.calls.filter((c) => c.path.includes("/holders?"))).toHaveLength(3);
  });

  test("writes are spaced at most three a second", async () => {
    const s = await site();
    await s.award("Género Diverso");
    const ids = s.members.map((m) => m.id);
    await grantManualAwards(
      options,
      { apiKey: s.apiKey },
      [{ name: "Género Diverso", xenforoTrophyId: 18, userIds: ids }],
      s.deps,
    );
    // The first write waits for nothing; each later one waits out the rest of its 1/3 s slot.
    expect(s.sleeps).toHaveLength(2);
    for (const ms of s.sleeps) {
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThanOrEqual(1000 / 3);
    }
  });

  test("a member who does not exist is refused and the run goes on", async () => {
    const s = await site();
    const diverse = await s.award("Género Diverso");
    const anna = s.members[0]!.id;
    const summary = await grantManualAwards(
      options,
      { apiKey: s.apiKey },
      [{ name: "Género Diverso", xenforoTrophyId: 18, userIds: [999999, anna] }],
      s.deps,
    );
    expect(summary[0]).toMatchObject({ granted: 1, refused: 1, failed: 0 });
    expect(await s.holdersOf(diverse.id)).toEqual([anna]);
  });

  test("a session cookie works as well as an API key", async () => {
    const s = await site();
    const diverse = await s.award("Género Diverso");
    const anna = s.members[0]!.id;
    const summary = await grantManualAwards(
      options,
      { cookie: s.adminCookie },
      [{ name: "Género Diverso", xenforoTrophyId: 18, userIds: [anna] }],
      s.deps,
    );
    expect(summary[0]).toMatchObject({ granted: 1, failed: 0 });
    expect(await s.holdersOf(diverse.id)).toEqual([anna]);
  });

  test("a 429 waits for the time the server names and tries the same grant again", async () => {
    const s = await site();
    const diverse = await s.award("Género Diverso");
    const anna = s.members[0]!.id;
    let limited = false;
    s.setIntercept((method) => {
      if (method !== "POST" || limited) return undefined;
      limited = true;
      return new Response("{}", { status: 429, headers: { "retry-after": "7" } });
    });
    const summary = await grantManualAwards(
      options,
      { apiKey: s.apiKey },
      [{ name: "Género Diverso", xenforoTrophyId: 18, userIds: [anna] }],
      s.deps,
    );
    expect(s.sleeps).toContain(7000);
    expect(summary[0]).toMatchObject({ granted: 1, failed: 0 });
    expect(await s.holdersOf(diverse.id)).toEqual([anna]);
  });

  test("a credential without the permission stops the run before any write", async () => {
    const s = await site();
    const diverse = await s.award("Género Diverso");
    const [anna, bruno] = s.members;
    const holders: AwardHolders[] = [
      { name: "Género Diverso", xenforoTrophyId: 18, userIds: [bruno!.id] },
    ];
    await expect(
      grantManualAwards(options, { cookie: anna!.cookie }, holders, s.deps),
    ).rejects.toThrow(/answered (401|403)/);
    expect(await s.holdersOf(diverse.id)).toEqual([]);
  });

  test("an award that is missing, doubled or inactive stops the run", async () => {
    const s = await site();
    const holders = (name: string): AwardHolders[] => [
      { name, xenforoTrophyId: 1, userIds: [s.members[0]!.id] },
    ];
    await expect(
      grantManualAwards(options, { apiKey: s.apiKey }, holders("Género Diverso"), s.deps),
    ).rejects.toThrow('0 awards are named "Género Diverso"');
    await s.award("Género Diverso");
    await s.award("Género Diverso");
    await expect(
      grantManualAwards(options, { apiKey: s.apiKey }, holders("Género Diverso"), s.deps),
    ).rejects.toThrow('2 awards are named "Género Diverso"');
    await s.award("Fiesta de Cumpleaños", { isActive: false });
    await expect(
      grantManualAwards(options, { apiKey: s.apiKey }, holders("Fiesta de Cumpleaños"), s.deps),
    ).rejects.toThrow("inactive");
    expect(writes(s.calls)).toHaveLength(0);
  });
});

describe("arguments, credentials and the holders file", () => {
  test("the rate cannot pass three writes a second", () => {
    expect(parseArgs([]).perSecond).toBe(3);
    expect(parseArgs(["--rate", "1", "--dry-run"])).toMatchObject({ perSecond: 1, dryRun: true });
    expect(() => parseArgs(["--rate", "4"])).toThrow("at most 3");
    expect(() => parseArgs(["--rate", "0"])).toThrow();
    expect(() => parseArgs(["--cookie", "x"])).toThrow("Unknown argument");
  });

  test("the credential is read from the environment, one kind only", () => {
    expect(credentialsFrom({ SERMO_API_KEY: " k " })).toEqual({ apiKey: "k" });
    expect(credentialsFrom({ SERMO_SESSION_COOKIE: "a=b" })).toEqual({ cookie: "a=b" });
    expect(() => credentialsFrom({})).toThrow("SERMO_API_KEY");
    expect(() => credentialsFrom({ SERMO_API_KEY: "k", SERMO_SESSION_COOKIE: "a=b" })).toThrow(
      "not both",
    );
  });

  test("the shipped holders file names the four awards with their counts", async () => {
    const text = await Bun.file(new URL("./manual-award-holders.json", import.meta.url)).text();
    expect(parseHolders(text).map((a) => [a.name, a.xenforoTrophyId, a.userIds.length])).toEqual([
      ["Género Diverso", 18, 156],
      ["Maestro de la Integración", 14, 18],
      ["Fiesta de Cumpleaños", 13, 9],
      ["Defensor de la Seguridad", 16, 1],
    ]);
    expect(() =>
      parseHolders('{"awards":[{"name":"x","xenforoTrophyId":1,"userIds":[0]}]}'),
    ).toThrow("malformed");
  });
});
