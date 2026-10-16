import { expect, test } from "bun:test";
import { createTestContext, insertUser } from "@sermo/core/testing";
import { getAuth } from "./index";

type TestCtx = ReturnType<typeof createTestContext>;
const ORIGIN = "http://localhost:3000";

function signIn(ctx: TestCtx, path: string, body: unknown, ip: string) {
  return getAuth(ctx).handler(
    new Request(`${ORIGIN}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, "x-sermo-client-ip": ip },
      body: JSON.stringify(body),
    }),
  );
}

/** A bcrypt hash as PHP writes it: `$2y$`, cost 4 to keep the test quick. */
async function phpHash(password: string | Uint8Array): Promise<string> {
  const hash = await Bun.password.hash(password, { algorithm: "bcrypt", cost: 4 });
  return hash.replace(/^\$2[ab]\$/, "$2y$");
}

async function member(ctx: TestCtx, username: string, hash: string) {
  const user = insertUser(ctx, { username });
  ctx.sqlite
    .prepare(
      "INSERT INTO auth_account (account_id, provider_id, user_id, password, created_at, updated_at) " +
        "VALUES (?1, 'credential', ?2, ?3, ?4, ?4)",
    )
    .run(String(user.id), user.id, hash, ctx.now());
  return {
    email: `${username}@example.test`,
    stored: () =>
      ctx.sqlite
        .prepare<{ password: string }, [number]>(
          "SELECT password FROM auth_account WHERE user_id = ?1",
        )
        .get(user.id)!.password,
  };
}

test("a bcrypt hash signs in and is replaced by an argon2id hash, which then signs in", async () => {
  const ctx = createTestContext();
  const password = "Imported-secret-1";
  const { email, stored } = await member(ctx, "carmen", await phpHash(password));
  expect(stored()).toStartWith("$2y$");

  expect((await signIn(ctx, "/sign-in/email", { email, password }, "10.77.0.1")).status).toBe(200);
  const rehashed = stored();
  expect(rehashed).toStartWith("$argon2id$");

  expect((await signIn(ctx, "/sign-in/email", { email, password }, "10.77.0.2")).status).toBe(200);
  expect(stored()).toBe(rehashed);
  expect(await Bun.password.verify(password, rehashed)).toBe(true);
});

test("username sign-in rehashes too", async () => {
  const ctx = createTestContext();
  const password = "Imported-secret-2";
  const { stored } = await member(ctx, "diego", await phpHash(password));
  const response = await signIn(
    ctx,
    "/sign-in/username",
    { username: "diego", password },
    "10.77.0.3",
  );
  expect(response.status).toBe(200);
  expect(stored()).toStartWith("$argon2id$");
});

test("a password over 72 bytes signs in on its first 72 bytes, as in PHP", async () => {
  const ctx = createTestContext();
  // Byte 72 falls inside a two-byte character: the 71 ASCII bytes and half of "ñ" count.
  const prefix = new TextEncoder().encode(`${"a".repeat(71)}ñ`).subarray(0, 72);
  const typed = `${"a".repeat(71)}ñ${"tail-the-hash-never-saw".repeat(3)}`;
  const { email, stored } = await member(ctx, "elena", await phpHash(prefix));

  // Bun alone would pre-hash the longer password and refuse it.
  expect(await Bun.password.verify(typed, stored())).toBe(false);
  expect(
    (await signIn(ctx, "/sign-in/email", { email, password: typed }, "10.77.0.4")).status,
  ).toBe(200);
  expect(stored()).toStartWith("$argon2id$");
  // Once rehashed, the whole password counts.
  expect(
    (await signIn(ctx, "/sign-in/email", { email, password: `${typed}x` }, "10.77.0.5")).status,
  ).toBe(401);
});

test("a wrong password fails and leaves the bcrypt hash untouched", async () => {
  const ctx = createTestContext();
  const hash = await phpHash("Imported-secret-3");
  const { email, stored } = await member(ctx, "felipe", hash);
  const response = await signIn(
    ctx,
    "/sign-in/email",
    { email, password: "Wrong-secret-3" },
    "10.77.0.6",
  );
  expect(response.status).toBe(401);
  expect(stored()).toBe(hash);
});

test("an argon2id account is unaffected", async () => {
  const ctx = createTestContext();
  const password = "Plain-secret-4";
  const hash = await Bun.password.hash(password, ctx.config.passwordHash);
  const { email, stored } = await member(ctx, "gloria", hash);
  expect((await signIn(ctx, "/sign-in/email", { email, password }, "10.77.0.7")).status).toBe(200);
  expect(stored()).toBe(hash);
});

test("the rehash does not overwrite a password changed after the sign-in checked it", async () => {
  const ctx = createTestContext();
  const password = "Imported-secret-5";
  const { email, stored } = await member(ctx, "hector", await phpHash(password));
  const changed = await phpHash("Changed-secret-5");
  const auth = getAuth(ctx);
  const authContext = await auth.$context;
  const original = authContext.password.verify;
  // Another request changes the password while this sign-in is verifying the old one.
  authContext.password.verify = async (data) => {
    const ok = await original(data);
    ctx.sqlite.prepare("UPDATE auth_account SET password = ?1").run(changed);
    return ok;
  };
  try {
    expect((await signIn(ctx, "/sign-in/email", { email, password }, "10.77.0.8")).status).toBe(
      200,
    );
  } finally {
    authContext.password.verify = original;
  }
  expect(stored()).toBe(changed);
});
