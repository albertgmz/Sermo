import { afterEach, expect, test } from "bun:test";
import type { Ctx } from "@sermo/core";
import { closeContext } from "@sermo/core";
import { createTestContext } from "@sermo/core/testing";
import { createApp } from "./app";

const contexts: Ctx[] = [];
let nextIp = 1;
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

const PASSWORD = "Password123!";
const ORIGIN = "http://localhost:3000";
const cookieOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");

/** One member with two separate sessions, each on its own client address. */
async function setup() {
  const ctx = createTestContext();
  contexts.push(ctx);
  const app = createApp(ctx, { trustedProxyHeader: null });
  const post = (path: string, body: object, cookie?: string) =>
    app.request(
      path,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify(body),
      },
      { requestIP: () => ({ address: `10.8.0.${nextIp++}`, family: "IPv4" as const, port: 1 }) },
    );
  const signUp = await post("/api/auth/sign-up/email", {
    name: "Owner",
    username: "Owner",
    email: "owner@example.test",
    password: PASSWORD,
  });
  expect(signUp.status).toBe(200);
  const first = cookieOf(signUp);
  const second = cookieOf(
    await post("/api/auth/sign-in/email", { email: "owner@example.test", password: PASSWORD }),
  );
  expect(second).not.toBe(first);
  const change = (cookie: string, currentPassword: string, newPassword = "Another-secret-9") =>
    post("/api/auth/change-password", { currentPassword, newPassword }, cookie);
  const counted = () =>
    ctx.sqlite
      .prepare<{ n: number }, []>("SELECT count(*) AS n FROM admin_password_failures")
      .get()!.n;
  return { first, second, change, counted };
}

test("a session that used up its wrong answers does not lock the member's other session", async () => {
  const { first, second, change } = await setup();
  for (let i = 0; i < 5; i++) expect((await change(first, "wrong-wrong-1")).status).toBe(400);
  const locked = await change(first, PASSWORD);
  expect(locked.status).toBe(429);
  expect(await locked.json()).toMatchObject({ code: "TOO_MANY_ATTEMPTS" });
  // The other session answers correctly and is let through.
  expect((await change(second, PASSWORD)).status).toBe(200);
});

test("a rejected new password is not counted as a wrong guess", async () => {
  const { first, change, counted } = await setup();
  for (let i = 0; i < 8; i++) expect((await change(first, PASSWORD, "short")).status).toBe(400);
  expect(counted()).toBe(0);
  // All five wrong current passwords are still available afterwards.
  for (let i = 0; i < 5; i++) expect((await change(first, "wrong-wrong-1")).status).toBe(400);
  expect(counted()).toBe(5);
  expect((await change(first, PASSWORD)).status).toBe(429);
});
