import { afterEach, describe, expect, test } from "bun:test";
import { UnauthenticatedError } from "../../errors";
import { accounts, closeAll, PASSWORD } from "../admin/fixtures.test";
import { getAuth, resolveActor } from ".";

afterEach(closeAll);

const ORIGIN = "http://localhost:3000";
// Better Auth keeps its request counts per address across contexts, so addresses are not reused.
let ip = 1;

async function world() {
  const w = await accounts();
  const member = await w.register("Keeper");
  const post = (path: string, body: unknown, cookie?: string) =>
    getAuth(w.ctx).handler(
      new Request(`${ORIGIN}/api/auth${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          "x-sermo-client-ip": `198.51.100.${ip++}`,
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify(body),
      }),
    );
  const login = async () =>
    (await post("/sign-in/email", { email: "keeper@example.test", password: PASSWORD })).headers
      .getSetCookie()
      .filter((value) => !/max-age=0/i.test(value))
      .map((value) => value.split(";")[0])
      .join("; ");
  const keyIds = () =>
    w.ctx.sqlite
      .prepare<{ id: number }, [string]>(
        "SELECT id FROM auth_apikey WHERE reference_id = ?1 ORDER BY id",
      )
      .all(String(member.id))
      .map((row) => row.id);
  const create = async (cookie: string, body: Record<string, unknown> = {}) => {
    const response = await post("/api-key/create", { password: PASSWORD, ...body }, cookie);
    return {
      status: response.status,
      body: (await response.json()) as { id?: string; key?: string; code?: string },
    };
  };
  const works = async (key: string) => {
    try {
      return (await resolveActor(w.ctx, new Headers({ "x-api-key": key }))).actor.kind === "token";
    } catch (error) {
      if (error instanceof UnauthenticatedError) return false;
      throw error;
    }
  };
  return { ...w, member, post, login, keyIds, create, works };
}

describe("one API key per member", () => {
  test("a second key is refused while the first one stays and keeps working", async () => {
    const w = await world();
    const cookie = await w.login();
    const first = await w.create(cookie);
    expect(first.status).toBe(200);
    const second = await w.create(cookie);
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ code: "API_KEY_EXISTS" });
    expect(second.body.key).toBeUndefined();
    expect(w.keyIds()).toEqual([Number(first.body.id)]);
    expect(await w.works(first.body.key!)).toBe(true);
  });

  test("replace: true makes a new key and ends the old one", async () => {
    const w = await world();
    const cookie = await w.login();
    const first = await w.create(cookie);
    const replaced = await w.create(cookie, { replace: true });
    expect(replaced.status).toBe(200);
    expect(w.keyIds()).toEqual([Number(replaced.body.id)]);
    expect(await w.works(first.body.key!)).toBe(false);
    expect(await w.works(replaced.body.key!)).toBe(true);
  });

  test("a replace with a wrong password leaves the old key", async () => {
    const w = await world();
    const cookie = await w.login();
    const first = await w.create(cookie);
    const wrong = await w.create(cookie, { replace: true, password: "nope-nope-1" });
    expect(wrong.status).toBe(403);
    expect(wrong.body).toMatchObject({ code: "INVALID_PASSWORD" });
    expect(w.keyIds()).toEqual([Number(first.body.id)]);
    expect(await w.works(first.body.key!)).toBe(true);
  });

  test("the first key may be asked for with replace: true too", async () => {
    const w = await world();
    const cookie = await w.login();
    const made = await w.create(cookie, { replace: true });
    expect(made.status).toBe(200);
    expect(w.keyIds()).toEqual([Number(made.body.id)]);
  });

  test("requests sent at the same moment leave one key", async () => {
    const w = await world();
    const cookie = await w.login();
    const answers = await Promise.all([w.create(cookie), w.create(cookie), w.create(cookie)]);
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409, 409]);
    const kept = answers.find((answer) => answer.status === 200)!;
    expect(w.keyIds()).toEqual([Number(kept.body.id)]);
    expect(await w.works(kept.body.key!)).toBe(true);
  });

  test("replaces sent at the same moment leave one key, the newest answered", async () => {
    const w = await world();
    const cookie = await w.login();
    await w.create(cookie);
    const answers = await Promise.all([1, 2, 3].map(() => w.create(cookie, { replace: true })));
    expect(answers.every((answer) => [200, 409].includes(answer.status))).toBe(true);
    const made = answers.filter((answer) => answer.status === 200);
    const newest = made.reduce((a, b) => (Number(a.body.id) > Number(b.body.id) ? a : b));
    expect(w.keyIds()).toEqual([Number(newest.body.id)]);
    expect(await w.works(newest.body.key!)).toBe(true);
  });

  test("a replace that finds a newer key loses to it: its own key goes and the newer one stays", async () => {
    const w = await world();
    const cookie = await w.login();
    await w.create(cookie);
    // Another request's key, inserted between this request's insert and its check.
    w.ctx.sqlite.run(
      `CREATE TRIGGER racing_key AFTER INSERT ON auth_apikey WHEN NEW.name = 'raced'
       BEGIN
         INSERT INTO auth_apikey (reference_id, key, name, created_at, updated_at)
         VALUES (NEW.reference_id, 'other-hash', 'newer', NEW.created_at, NEW.updated_at);
       END`,
    );
    const lost = await w.create(cookie, { replace: true, name: "raced" });
    expect(lost.status).toBe(409);
    expect(lost.body).toMatchObject({ code: "API_KEY_EXISTS" });
    expect(lost.body.key).toBeUndefined();
    const left = w.ctx.sqlite
      .prepare<{ name: string | null }, [string]>(
        "SELECT name FROM auth_apikey WHERE reference_id = ?1 ORDER BY id",
      )
      .all(String(w.member.id))
      .map((row) => row.name);
    // The first key stays too: ending older keys is left to the request that wins.
    expect(left).toEqual([null, "newer"]);
  });

  test("a plain request racing a replace is refused, and one working key is left", async () => {
    const w = await world();
    const cookie = await w.login();
    const first = await w.create(cookie);
    const [plain, replace] = await Promise.all([
      w.create(cookie),
      w.create(cookie, { replace: true }),
    ]);
    expect(plain.status).toBe(409);
    // The replace wins unless the plain request's key, briefly in, was newer: then both are refused
    // and the first key stays.
    const kept = replace.status === 200 ? replace : first;
    expect(w.keyIds()).toEqual([Number(kept.body.id)]);
    expect(await w.works(kept.body.key!)).toBe(true);
  });

  test("a member who already holds several keys keeps them until replacing, which leaves one", async () => {
    const w = await world();
    // In-process calls (loaders, tests) are not held to the rule.
    for (const name of ["a", "b", "c"])
      await getAuth(w.ctx).api.createApiKey({ body: { userId: String(w.member.id), name } });
    expect(w.keyIds()).toHaveLength(3);
    const cookie = await w.login();
    expect((await w.create(cookie)).status).toBe(409);
    expect(w.keyIds()).toHaveLength(3);
    const replaced = await w.create(cookie, { replace: true });
    expect(replaced.status).toBe(200);
    expect(w.keyIds()).toEqual([Number(replaced.body.id)]);
  });

  test("revoking the key lets the member make a new one", async () => {
    const w = await world();
    const cookie = await w.login();
    const first = await w.create(cookie);
    const revoked = await w.post("/api-key/delete", { keyId: first.body.id }, cookie);
    expect(revoked.status).toBe(200);
    expect(w.keyIds()).toEqual([]);
    const again = await w.create(cookie);
    expect(again.status).toBe(200);
    expect(w.keyIds()).toEqual([Number(again.body.id)]);
  });

  test("another member's key does not count", async () => {
    const w = await world();
    const other = await w.register("Other");
    await getAuth(w.ctx).api.createApiKey({ body: { userId: String(other.id), name: "theirs" } });
    const cookie = await w.login();
    expect((await w.create(cookie)).status).toBe(200);
    expect(w.keyIds()).toHaveLength(1);
  });
});
