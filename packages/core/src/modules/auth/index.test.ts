import { describe, expect, test } from "bun:test";
import {
  createTestContext,
  expectNoTableScan,
  insertUser,
  tokenActor,
  userActor,
} from "@sermo/core/testing";
import { GUEST } from "../../actor";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from "../../errors";
import { execute } from "../../operation";
import {
  authCreateTokenOp,
  authListTokensOp,
  authLoginOp,
  authLogoutOp,
  authMeOp,
  authRegisterOp,
  authRevokeTokenOp,
  ensureAdmin,
  purgeExpiredCredentials,
  resolveApiToken,
  resolveSessionToken,
} from "./index";

const registerInput = {
  username: "Alice",
  email: "Alice@Example.com",
  password: "secret-password",
};

describe("authentication", () => {
  test("register, case-insensitive login, me and session expiry", async () => {
    const ctx = createTestContext();
    const created = await execute(ctx, authRegisterOp, GUEST, registerInput);
    expect(created.user.email).toBe("alice@example.com");
    expect(created.user.groupId).toBe(2);
    const actor = resolveSessionToken(ctx, created.session.token);
    expect(actor?.kind).toBe("user");
    expect((await execute(ctx, authMeOp, actor!, {})).user?.username).toBe("Alice");
    expect((await execute(ctx, authMeOp, GUEST, {})).user).toBeNull();
    const login = await execute(ctx, authLoginOp, GUEST, {
      login: "ALICE",
      password: registerInput.password,
    });
    expect(resolveSessionToken(ctx, login.session.token)?.kind).toBe("user");
    const byEmail = await execute(ctx, authLoginOp, GUEST, {
      login: "ALICE@EXAMPLE.COM",
      password: registerInput.password,
    });
    expect(byEmail.user.id).toBe(created.user.id);
    ctx.clock.advance(ctx.config.sessionTtlMs);
    expect(resolveSessionToken(ctx, created.session.token)).toBeNull();
    expect(purgeExpiredCredentials(ctx).sessions).toBe(3);
  });

  test("registration and login reject duplicate or invalid credentials", async () => {
    const ctx = createTestContext();
    const created = await execute(ctx, authRegisterOp, GUEST, registerInput);
    await expect(
      execute(ctx, authRegisterOp, GUEST, {
        ...registerInput,
        username: "ALICE",
        email: "other@example.com",
      }),
    ).rejects.toThrow(ConflictError);
    await expect(
      execute(ctx, authRegisterOp, GUEST, { ...registerInput, username: "Other" }),
    ).rejects.toThrow(ConflictError);
    await expect(
      execute(ctx, authRegisterOp, GUEST, { ...registerInput, username: "x" }),
    ).rejects.toThrow(ValidationError);
    await expect(
      execute(ctx, authRegisterOp, resolveSessionToken(ctx, created.session.token)!, {
        ...registerInput,
        username: "Other",
      }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      execute(ctx, authRegisterOp, tokenActor({ id: created.user.id, groupId: 2 }), {
        ...registerInput,
        username: "Other",
      }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      execute(ctx, authLoginOp, GUEST, { login: "missing", password: "wrong" }),
    ).rejects.toThrow(new UnauthenticatedError("Invalid login or password."));
    await expect(
      execute(ctx, authLoginOp, GUEST, { login: "Alice", password: "wrong" }),
    ).rejects.toThrow(new UnauthenticatedError("Invalid login or password."));
  });

  test("session-only token management and revocation", async () => {
    const ctx = createTestContext();
    const created = await execute(ctx, authRegisterOp, GUEST, registerInput);
    const actor = resolveSessionToken(ctx, created.session.token)!;
    const token = await execute(ctx, authCreateTokenOp, actor, { name: "CLI", expiresInDays: 1 });
    expect(token.token.startsWith("sermo_")).toBe(true);
    expect(resolveApiToken(ctx, token.token)?.kind).toBe("token");
    expect((await execute(ctx, authListTokensOp, actor, {})).items).toHaveLength(1);
    expect((await execute(ctx, authMeOp, resolveApiToken(ctx, token.token)!, {})).user?.id).toBe(
      created.user.id,
    );
    await expect(execute(ctx, authCreateTokenOp, GUEST, { name: "no" })).rejects.toThrow(
      UnauthenticatedError,
    );
    await expect(
      execute(ctx, authCreateTokenOp, resolveApiToken(ctx, token.token)!, { name: "no" }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      execute(ctx, authListTokensOp, resolveApiToken(ctx, token.token)!, {}),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      execute(ctx, authRevokeTokenOp, resolveApiToken(ctx, token.token)!, {
        tokenId: token.apiToken.id,
      }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      execute(ctx, authRevokeTokenOp, GUEST, { tokenId: token.apiToken.id }),
    ).rejects.toThrow(UnauthenticatedError);
    const other = insertUser(ctx);
    await expect(
      execute(ctx, authRevokeTokenOp, userActor(other), { tokenId: token.apiToken.id }),
    ).rejects.toThrow(NotFoundError);
    await execute(ctx, authRevokeTokenOp, actor, { tokenId: token.apiToken.id });
    expect(resolveApiToken(ctx, token.token)).toBeNull();
    await expect(
      execute(ctx, authRevokeTokenOp, actor, { tokenId: token.apiToken.id }),
    ).rejects.toThrow(NotFoundError);
  });

  test("token expiry, permanent tokens and logout actor checks", async () => {
    const ctx = createTestContext();
    const created = await execute(ctx, authRegisterOp, GUEST, registerInput);
    const actor = resolveSessionToken(ctx, created.session.token)!;
    const expiring = await execute(ctx, authCreateTokenOp, actor, {
      name: "short",
      expiresInDays: 1,
    });
    const permanent = await execute(ctx, authCreateTokenOp, actor, { name: "forever" });
    expect(permanent.apiToken.expiresAt).toBeNull();
    await expect(execute(ctx, authLogoutOp, GUEST, {})).rejects.toThrow(UnauthenticatedError);
    await expect(
      execute(ctx, authLogoutOp, tokenActor({ id: created.user.id, groupId: 2 }), {}),
    ).rejects.toThrow(ForbiddenError);
    ctx.clock.advance(86_400_000);
    expect(resolveApiToken(ctx, expiring.token)).toBeNull();
    expect(resolveApiToken(ctx, permanent.token)?.kind).toBe("token");
    expect(purgeExpiredCredentials(ctx).tokens).toBe(1);
    await execute(ctx, authLogoutOp, actor, {});
    expect(resolveSessionToken(ctx, created.session.token)).toBeNull();
  });

  test("bootstrap creates or promotes one administrator and is idempotent", async () => {
    const ctx = createTestContext();
    const first = await ensureAdmin(ctx, {
      username: "Root",
      email: "root@example.com",
      password: "secret-password",
    });
    expect(first.created).toBe(true);
    expect(
      await ensureAdmin(ctx, {
        username: "Another",
        email: "other@example.com",
        password: "secret-password",
      }),
    ).toEqual({ userId: first.userId, created: false });
    const second = createTestContext();
    const user = insertUser(second, { username: "Root" });
    expect(
      await ensureAdmin(second, {
        username: "root",
        email: "root@example.com",
        password: "secret-password",
      }),
    ).toEqual({ userId: user.id, created: false });
    expect(
      second.sqlite
        .prepare<{ group_id: number }, [number]>("SELECT group_id FROM users WHERE id = ?1")
        .get(user.id)?.group_id,
    ).toBe(4);
  });

  test("credential lookups use indexed plans", () => {
    const ctx = createTestContext();
    expectNoTableScan(
      ctx,
      "SELECT s.id, s.user_id, u.group_id FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?1 AND s.expires_at > ?2",
      ["hash", ctx.now()],
    );
    expectNoTableScan(
      ctx,
      "SELECT t.id, t.user_id, u.group_id FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?1 AND (t.expires_at IS NULL OR t.expires_at > ?2)",
      ["hash", ctx.now()],
    );
  });
});
