import { expect, spyOn, test } from "bun:test";
import { createTestContext } from "@sermo/core/testing";
import { signJWT } from "better-auth/crypto";
import { registerEmailJobs } from "../email";
import { registerAccountEmailJobs } from "../email/account";
import { runDueJobs } from "../jobs/queue";
import { getAuth } from "./index";

const ORIGIN = "http://localhost:3000";
let clientNumber = 0;

async function setup() {
  const ip = `198.51.100.${++clientNumber}`;
  const ctx = createTestContext();
  const capture = registerEmailJobs(
    ctx,
    { driver: "capture", sender: "forum@example.test" },
    {
      defaults: {},
      securityTypes: new Set(),
    },
  )!;
  registerAccountEmailJobs(ctx);
  const auth = getAuth(ctx);
  const post = (path: string, body: unknown, cookie?: string) =>
    auth.handler(
      new Request(`${ORIGIN}/api/auth${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          "x-sermo-client-ip": ip,
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify(body),
      }),
    );
  const register = async (username: string, email: string) => {
    const response = await post("/sign-up/email", {
      name: username,
      username,
      email,
      password: "Password123!",
    });
    expect(response.status).toBe(200);
    const user = ((await response.json()) as { user: { id: string } }).user;
    return {
      id: Number(user.id),
      cookie: response.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; "),
    };
  };
  const owner = await register("Owner", "a@example.test");
  const other = await register("Other", "other@example.test");
  const link = async (email: string) => {
    expect((await post("/change-email", { newEmail: email }, owner.cookie)).status).toBe(200);
    await runDueJobs(ctx);
    const message = capture.messages.findLast(
      (message) => message.to === email && /verify-email/.test(message.text),
    )!;
    const url = new URL(message.text.match(/https?:\/\/[^\s]+/)![0]);
    url.searchParams.delete("callbackURL");
    return url;
  };
  const follow = (url: URL, cookie?: string) =>
    auth.handler(
      new Request(url, { headers: { "x-sermo-client-ip": ip, ...(cookie ? { cookie } : {}) } }),
    );
  const emailOf = (id: number) =>
    ctx.sqlite
      .prepare<{ email: string }, [number]>("SELECT email FROM auth_user WHERE id = ?1")
      .get(id)?.email;
  const pending = () =>
    ctx.sqlite
      .query<{ n: number }, []>(
        "SELECT count(*) AS n FROM auth_verification WHERE identifier LIKE 'change-email:%'",
      )
      .get()!.n;
  return { ctx, auth, capture, owner, other, link, follow, emailOf, pending };
}

test("change-email confirmation never reselects the account by email after its ownership check", async () => {
  const { ctx, auth, owner, other, link, follow, emailOf } = await setup();
  const toB = await link("b@example.test");
  await link("c@example.test");
  const adapter = (await auth.$context).internalAdapter;
  const find = adapter.findUserByEmail.bind(adapter);
  // Deterministic seam at the built-in endpoint's second lookup: another confirmation frees A
  // and another account takes it. The replacement endpoint must never reach this lookup.
  const lookup = spyOn(adapter, "findUserByEmail").mockImplementation(async (email, options) => {
    if (email === "a@example.test") {
      ctx.sqlite
        .prepare("UPDATE auth_user SET email = 'c@example.test' WHERE id = ?1")
        .run(owner.id);
      ctx.sqlite
        .prepare("UPDATE auth_user SET email = 'a@example.test' WHERE id = ?1")
        .run(other.id);
    }
    return find(email, options);
  });
  const updateByEmail = spyOn(adapter, "updateUserByEmail");
  try {
    const response = await follow(toB);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: true,
      user: { id: String(owner.id), email: "b@example.test", emailVerified: true },
    });
    expect(emailOf(owner.id)).toBe("b@example.test");
    expect(emailOf(other.id)).toBe("other@example.test");
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    expect((await auth.api.getSession({ headers: new Headers({ cookie }) }))?.user.id).toBe(
      String(owner.id),
    );
    expect(lookup).not.toHaveBeenCalled();
    expect(updateByEmail).not.toHaveBeenCalled();
  } finally {
    lookup.mockRestore();
    updateByEmail.mockRestore();
  }
});

test("opening a change-email link as another account preserves it for its owner", async () => {
  const { owner, other, link, follow, emailOf, pending } = await setup();
  const url = await link("b@example.test");
  expect(pending()).toBe(1);
  const wrong = await follow(url, other.cookie);
  expect(wrong.status).toBe(401);
  expect(await wrong.json()).toMatchObject({ code: "INVALID_USER" });
  expect(pending()).toBe(1);
  expect(emailOf(owner.id)).toBe("a@example.test");
  expect(emailOf(other.id)).toBe("other@example.test");
  expect((await follow(url, owner.cookie)).status).toBe(200);
  expect(emailOf(owner.id)).toBe("b@example.test");
  expect(pending()).toBe(0);
  expect((await follow(url, owner.cookie)).status).toBe(401);
});

test("an occupied target address rolls back change-email consumption", async () => {
  const { ctx, owner, other, link, follow, emailOf, pending } = await setup();
  const url = await link("b@example.test");
  ctx.sqlite.prepare("UPDATE auth_user SET email = 'b@example.test' WHERE id = ?1").run(other.id);
  expect((await follow(url, owner.cookie)).status).toBe(409);
  expect(pending()).toBe(1);
  expect(emailOf(owner.id)).toBe("a@example.test");
  ctx.sqlite
    .prepare("UPDATE auth_user SET email = 'other@example.test' WHERE id = ?1")
    .run(other.id);
  expect((await follow(url, owner.cookie)).status).toBe(200);
  expect(pending()).toBe(0);
});

test("change-email checks expiry and callback origin before consuming and returns redirect cookies", async () => {
  const { ctx, auth, owner, link, follow, pending } = await setup();
  const url = await link("b@example.test");
  url.searchParams.set("callbackURL", "https://untrusted.example/done");
  expect((await follow(url, owner.cookie)).status).toBe(403);
  expect(pending()).toBe(1);
  url.searchParams.set("callbackURL", `${ORIGIN}/done`);
  const expiry = Date.now() + 60_000;
  ctx.sqlite
    .prepare("UPDATE auth_verification SET expires_at = ?1 WHERE identifier LIKE 'change-email:%'")
    .run(Date.now() - 1);
  expect((await follow(url, owner.cookie)).status).toBe(401);
  expect(pending()).toBe(1);
  ctx.sqlite
    .prepare("UPDATE auth_verification SET expires_at = ?1 WHERE identifier LIKE 'change-email:%'")
    .run(expiry);
  const response = await follow(url);
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe(`${ORIGIN}/done`);
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  expect((await auth.api.getSession({ headers: new Headers({ cookie }) }))?.user.id).toBe(
    String(owner.id),
  );
  expect(pending()).toBe(0);
});

test("a change-email token with a base64url payload cannot bypass its account binding", async () => {
  const { ctx, owner, follow, emailOf } = await setup();
  const token = await signJWT(
    {
      email: "a@example.test",
      updateTo: "b@example.test",
      requestType: "change-email-verification",
      nonce: "??????",
    },
    ctx.config.auth!.secret,
  );
  expect(token.split(".")[1]).toMatch(/[-_]/);
  const url = new URL(`${ORIGIN}/api/auth/verify-email`);
  url.searchParams.set("token", token);
  // Even a correctly signed token needs a pending row bound to the requesting account.
  const response = await follow(url);
  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({ code: "INVALID_TOKEN" });
  expect(response.headers.getSetCookie()).toEqual([]);
  expect(emailOf(owner.id)).toBe("a@example.test");
});

for (const state of ["revoked", "expired", "banned"])
  test(`a ${state} session cannot consume a change-email confirmation`, async () => {
    const { ctx, owner, link, follow, emailOf, pending } = await setup();
    const url = await link("b@example.test");
    if (state === "revoked")
      ctx.sqlite.prepare("DELETE FROM auth_session WHERE user_id = ?1").run(owner.id);
    else if (state === "expired")
      ctx.sqlite
        .prepare("UPDATE auth_session SET expires_at = ?1 WHERE user_id = ?2")
        .run(Date.now() - 1, owner.id);
    else ctx.sqlite.prepare("UPDATE users SET banned_permanently = 1 WHERE id = ?1").run(owner.id);
    const rejected = await follow(url, owner.cookie);
    expect(rejected.status).toBe(state === "banned" ? 403 : 401);
    for (const cleared of rejected.headers.getSetCookie())
      expect(cleared).toMatch(/^[^=]+=;.*Max-Age=0/i);
    expect(pending()).toBe(1);
    expect(emailOf(owner.id)).toBe("a@example.test");
    if (state === "banned") {
      expect((await follow(url)).status).toBe(403);
      expect(pending()).toBe(1);
    }
    ctx.sqlite.prepare("UPDATE users SET banned_permanently = 0 WHERE id = ?1").run(owner.id);
    expect((await follow(url)).status).toBe(200);
    expect(emailOf(owner.id)).toBe("b@example.test");
    expect(pending()).toBe(0);
  });

test("a session revoked after the hook lookup cannot consume the confirmation", async () => {
  const { ctx, auth, owner, link, follow, emailOf, pending } = await setup();
  const url = await link("b@example.test");
  const adapter = (await auth.$context).internalAdapter;
  const find = adapter.findSession.bind(adapter);
  const lookup = spyOn(adapter, "findSession").mockImplementation(async (token) => {
    const session = await find(token);
    ctx.sqlite.prepare("DELETE FROM auth_session WHERE token = ?1").run(token);
    return session;
  });
  try {
    const rejected = await follow(url, owner.cookie);
    expect(rejected.status).toBe(401);
    expect(await rejected.json()).toMatchObject({ code: "UNAUTHORIZED" });
    expect(pending()).toBe(1);
    expect(emailOf(owner.id)).toBe("a@example.test");
  } finally {
    lookup.mockRestore();
  }
  expect((await follow(url)).status).toBe(200);
  expect(pending()).toBe(0);
});

test("confirmation rolls back the email update if consuming the link fails", async () => {
  const { ctx, auth, owner, link, follow, emailOf, pending } = await setup();
  const url = await link("b@example.test");
  ctx.sqlite.exec(
    "CREATE TEMP TRIGGER reject_confirmation BEFORE DELETE ON auth_verification " +
      "WHEN OLD.identifier LIKE 'change-email:%' BEGIN SELECT RAISE(ABORT, 'confirmation storage failure'); END",
  );
  try {
    await expect(
      auth.api.verifyEmail({ query: { token: url.searchParams.get("token")! } }),
    ).rejects.toThrow("confirmation storage failure");
    expect(emailOf(owner.id)).toBe("a@example.test");
    expect(pending()).toBe(1);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT count(*) AS n FROM auth_session WHERE user_id = ?1",
        )
        .get(owner.id)?.n,
    ).toBe(1);
  } finally {
    ctx.sqlite.exec("DROP TRIGGER reject_confirmation");
  }
  expect((await follow(url)).status).toBe(200);
  expect(pending()).toBe(0);
});

for (const invalid of ["expired", "signature", "requestType"])
  test(`a token with invalid ${invalid} cannot consume a pending confirmation`, async () => {
    const { ctx, auth, owner, follow, emailOf, pending } = await setup();
    const token = await signJWT(
      {
        email: "a@example.test",
        updateTo: "b@example.test",
        requestType:
          invalid === "requestType" ? "change-email-confirmation" : "change-email-verification",
      },
      invalid === "signature" ? "a-different-signing-secret" : ctx.config.auth!.secret,
      invalid === "expired" ? -60 : 3600,
    );
    await (await auth.$context).internalAdapter.createVerificationValue({
      identifier: `change-email:${new Bun.CryptoHasher("sha256").update(token).digest("base64url")}`,
      value: String(owner.id),
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const url = new URL(`${ORIGIN}/api/auth/verify-email`);
    url.searchParams.set("token", token);
    const rejected = await follow(url);
    expect(rejected.status).toBe(401);
    expect(rejected.headers.getSetCookie()).toEqual([]);
    expect(emailOf(owner.id)).toBe("a@example.test");
    expect(pending()).toBe(1);
  });

test("two outstanding confirmations can only change the requesting account once", async () => {
  const { ctx, owner, other, link, follow, emailOf, pending } = await setup();
  const toB = await link("b@example.test");
  const toC = await link("c@example.test");
  const responses = await Promise.all([follow(toB), follow(toC)]);
  expect(responses.map((response) => response.status).sort()).toEqual([200, 401]);
  const winner = responses.find((response) => response.status === 200)!;
  const result = (await winner.json()) as { user: { id: string; email: string } };
  expect(result.user.id).toBe(String(owner.id));
  expect(emailOf(owner.id)).toBe(result.user.email);
  expect(emailOf(other.id)).toBe("other@example.test");
  expect(pending()).toBe(1);
  expect(
    ctx.sqlite
      .prepare<{ n: number }, [number]>("SELECT count(*) AS n FROM auth_session WHERE user_id = ?1")
      .get(owner.id)?.n,
  ).toBe(2);
});
