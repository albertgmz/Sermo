import { afterEach, expect, setSystemTime, test } from "bun:test";
import { createTestContext } from "@sermo/core/testing";
import { closeContext } from "../../context";
import { getAuth } from "./index";
import { pruneSignInFailures, SIGN_IN_WINDOW_MS } from "./sign-in-limit";

const ORIGIN = "http://localhost:3000";
const PASSWORD = "Password123!";
let next = 1;
// Better Auth keeps its own counts (three sign-ins per ten seconds per address) on the real
// clock; the test moves that clock on so one address can send more than three requests.
let real = Date.now();
const opened: ReturnType<typeof createTestContext>[] = [];
afterEach(() => {
  setSystemTime();
  for (const ctx of opened.splice(0)) closeContext(ctx);
});

function world() {
  const ctx = createTestContext();
  opened.push(ctx);
  const send = (path: string, body: unknown, ip: string) =>
    getAuth(ctx).handler(
      new Request(`${ORIGIN}/api/auth${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN, "x-sermo-client-ip": ip },
        body: JSON.stringify(body),
      }),
    );
  const address = () => `198.51.100.${next++}`;
  /** Sends `count` requests, moving Better Auth's clock past its ten-second window every three. */
  const attempt = async (path: string, body: unknown, ip: string, count = 1) => {
    const statuses: number[] = [];
    let last: Response | undefined;
    for (let i = 0; i < count; i++) {
      if (i % 3 === 0) setSystemTime((real += 11_000));
      last = await send(path, body, ip);
      statuses.push(last.status);
    }
    return { statuses, last: last! };
  };
  return { ctx, send, address, attempt };
}

async function register(w: ReturnType<typeof world>) {
  const made = await w.send(
    "/sign-up/email",
    { name: "Owner", username: "Owner", email: "owner@example.test", password: PASSWORD },
    w.address(),
  );
  expect(made.status).toBe(200);
}

const wrongEmail = { email: "owner@example.test", password: "Wrong-password-1" };
const wrongName = { username: "Owner", password: "Wrong-password-1" };

test("ten wrong passwords for an account from one address end its sign-ins from that address only", async () => {
  const w = world();
  await register(w);
  const ip = w.address();
  const wrong = await w.attempt("/sign-in/email", wrongEmail, ip, 10);
  expect(wrong.statuses).toEqual(Array(10).fill(401));
  // The eleventh is refused, and so is the right password, by address, on both routes.
  const refused = await w.attempt("/sign-in/email", wrongEmail, ip);
  expect(refused.statuses).toEqual([429]);
  const right = await w.attempt(
    "/sign-in/email",
    { email: "owner@example.test", password: PASSWORD },
    ip,
  );
  expect(right.statuses).toEqual([429]);
  // Another address is not affected: a stranger cannot lock the owner out from elsewhere.
  const other = await w.attempt(
    "/sign-in/email",
    { email: "owner@example.test", password: PASSWORD },
    w.address(),
  );
  expect(other.statuses).toEqual([200]);
  // Other accounts from the same address are not affected either.
  expect(
    (await w.attempt("/sign-in/email", { email: "x@example.test", password: "abc" }, ip)).statuses,
  ).toEqual([401]);
});

test("an unknown account is limited exactly like a known one", async () => {
  const w = world();
  await register(w);
  const unknown = { email: "nobody@example.test", password: "Wrong-password-1" };
  const answers = [];
  for (const body of [unknown, wrongEmail]) {
    const ip = w.address();
    expect((await w.attempt("/sign-in/email", body, ip, 10)).statuses).toEqual(Array(10).fill(401));
    const refused = await w.attempt("/sign-in/email", body, ip);
    expect(refused.statuses).toEqual([429]);
    answers.push(await refused.last.json());
  }
  expect(answers[0]).toEqual(answers[1]);
});

test("the username route has its own count and the same limit", async () => {
  const w = world();
  await register(w);
  const ip = w.address();
  expect((await w.attempt("/sign-in/username", wrongName, ip, 10)).statuses).toEqual(
    Array(10).fill(401),
  );
  expect((await w.attempt("/sign-in/username", wrongName, ip)).statuses).toEqual([429]);
  const lower = await w.attempt("/sign-in/username", { ...wrongName, username: "OWNER" }, ip);
  expect(lower.statuses).toEqual([429]);
});

test("answers that were not a wrong password are not counted, and the window moves on", async () => {
  const w = world();
  await register(w);
  const ip = w.address();
  // Malformed requests and right passwords do not use the allowance.
  for (let i = 0; i < 4; i++)
    expect(
      (await w.attempt("/sign-in/email", { email: "owner@example.test", password: PASSWORD }, ip))
        .statuses,
    ).toEqual([200]);
  expect((await w.attempt("/sign-in/email", wrongEmail, ip, 9)).statuses).toEqual(
    Array(9).fill(401),
  );
  expect((await w.attempt("/sign-in/email", wrongEmail, ip)).statuses).toEqual([401]);
  expect((await w.attempt("/sign-in/email", wrongEmail, ip)).statuses).toEqual([429]);
  w.ctx.clock.advance(SIGN_IN_WINDOW_MS + 1);
  expect((await w.attempt("/sign-in/email", wrongEmail, ip)).statuses).toEqual([401]);
  // The table keeps neither the address nor the account name, and the cleanup empties it.
  const rows = w.ctx.sqlite.query<{ key: string }, []>("SELECT key FROM sign_in_failures").all();
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) expect(row.key).toMatch(/^[0-9a-f]{64}$/);
  w.ctx.clock.advance(SIGN_IN_WINDOW_MS + 1);
  pruneSignInFailures(w.ctx);
  expect(w.ctx.sqlite.query("SELECT 1 FROM sign_in_failures").all()).toEqual([]);
});
