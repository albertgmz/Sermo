import { type apiKey, defaultKeyHasher } from "@better-auth/api-key";
import { APIError, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware, isAPIError } from "better-auth/api";
import { deleteSessionCookie, setSessionCookie } from "better-auth/cookies";
import { verifyJWT } from "better-auth/crypto";
import { parseUserOutput } from "better-auth/db";
import { openAPI, type username } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { type Actor, GUEST, type Principal } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { authCounters, authMe } from "../../contracts/auth";
import {
  authPlugins,
  authSchemaOptions,
  isReservedUsername,
  isValidUsername,
  USERNAME_PATTERN,
} from "../../db/auth-options";
import * as schema from "../../db/auth-schema";
import { GROUP_IDS } from "../../db/schema";
import { writeTx } from "../../db/tx";
import {
  ConflictError,
  ForbiddenError,
  RateLimitedError,
  UnauthenticatedError,
} from "../../errors";
import { publishEvent } from "../../events";
import { type AnyOperation, implement } from "../../operation";
import {
  combinationsGranting,
  memberDisplay,
  PRINCIPAL_COLUMNS,
  type PrincipalRow,
  permissionsOf,
  principalFromRow,
  resolvedPermissions,
} from "../../permissions";
import { iso } from "../../time";
import {
  checkOwnPassword,
  forgivePasswordGuess,
  takePasswordGuess,
} from "../admin/password-guesses";
import { accountEmailEnabled, queueAccountEmail } from "../email/account";
import { queueCounts } from "../moderation";
import { usernameChange } from "./rename-marker";
import { forgiveSignInGuess, takeSignInGuess } from "./sign-in-limit";
import { staffAccess } from "./staff";

/**
 * Better Auth's change-email token names the account only by its address and can be replayed
 * until it expires. Each one is therefore recorded with the requesting account's id under a
 * digest of the token, and the record is consumed when the link is followed.
 */
function changeEmailIdentifier(token: string): string {
  return `change-email:${new Bun.CryptoHasher("sha256").update(token).digest("base64url")}`;
}

type AuthHookContext = Parameters<typeof deleteSessionCookie>[0];

/**
 * Endpoints that proceed past a dead session cookie (missing row, expired, forged or unsigned)
 * as if no cookie had been sent. An endpoint belongs here only if neither its handler nor any
 * middleware or hook that runs for it reads a session from the request, because the session
 * helpers fall back to the cookie cache when `context.session` is null. Checked against Better
 * Auth 1.7.7: none of these uses getSessionFromCtx, sessionMiddleware, freshSessionMiddleware or
 * getSession. /verify-email calls getSessionFromCtx only for change-email tokens and when
 * autoSignInAfterVerification is set (it is not), so a dead cookie proceeds there only when the
 * link is not a change-email link; change-email links act on the member's session and keep
 * answering 401. Every other endpoint answers a dead cookie with 401.
 */
export const SESSIONLESS_PATHS: ReadonlySet<string> = new Set([
  "/sign-in/email",
  "/sign-in/username",
  "/sign-up/email",
  "/request-password-reset",
  "/reset-password",
  "/reset-password/:token",
  "/verify-email",
]);

async function proceedsWithoutSession(hook: AuthHookContext): Promise<boolean> {
  if (!SESSIONLESS_PATHS.has(hook.path)) return false;
  if (hook.path !== "/verify-email") return true;
  const token: unknown = hook.query?.token;
  return typeof token !== "string" || !(await verifyJWT(token, hook.context.secret))?.updateTo;
}

/**
 * Better Auth endpoints the HTTP handler does not serve. `/verify-password` only answers "is this
 * my password" for a session, with no limit of its own; the forum's `auth.verifyPassword` is the
 * one place that asks, under the member limit.
 */
export const DISABLED_PATHS: readonly string[] = ["/verify-password"];

/** Marks, on the per-request auth context, that the request's session cookies were dead. */
const DEAD_SESSION_COOKIE = "sermoDeadSessionCookie";

/** The wrong-password guess a change-password request took, to give back when it succeeds. */
const PASSWORD_GUESS = "sermoPasswordGuess";

/** The wrong-password count a sign-in request took, to give back when it was not one. */
const SIGN_IN_GUESS = "sermoSignInGuess";

/** The member a reset-password link belongs to, to end their API keys once it is used. */
const RESET_HOLDER = "sermoResetHolder";

function withoutSessionCookies(hook: AuthHookContext) {
  const strip = (name: string) => name.toLowerCase().replace(/^__(?:secure|host)-/, "");
  const names = [
    hook.context.authCookies.sessionToken.name,
    hook.context.authCookies.sessionData.name,
  ].map(strip);
  const source = hook.headers ?? hook.request?.headers;
  const headers = new Headers(source);
  const kept = (source?.get("cookie") ?? "").split(";").filter((part) => {
    const name = strip(part.slice(0, part.indexOf("=")).replace(/^[\s,]+|\s+$/g, ""));
    return !names.some((base) => name === base || name.startsWith(`${base}.`));
  });
  headers.set("cookie", kept.join(";"));
  return { context: { headers } };
}

/**
 * Expire the dead session cookies on the response without undoing a session cookie that the
 * endpoint itself wrote in this request (a successful sign-in must end with its new cookie).
 */
function retireDeadSessionCookies(hook: AuthHookContext): void {
  // The endpoint's own headers live on the request-scoped context, not on this hook's.
  const endpointHeaders = (hook.context as { responseHeaders?: Headers }).responseHeaders;
  const scopes = new Set<Headers>([hook.responseHeaders]);
  if (endpointHeaders) scopes.add(endpointHeaders);
  const before = new Map([...scopes].map((headers) => [headers, headers.getSetCookie()]));
  deleteSessionCookie(hook);
  const nameOf = (entry: string) => entry.slice(0, entry.indexOf("="));
  const removed = [...before].map(([headers, entries]) => {
    const now = headers.getSetCookie();
    return { headers, lost: entries.filter((entry) => !now.includes(entry)) };
  });
  const rewritten = new Set(removed.flatMap(({ lost }) => lost.map(nameOf)));
  for (const { headers, lost } of removed) {
    const original = before.get(headers)!;
    const current = headers
      .getSetCookie()
      .filter((entry) => original.includes(entry) || !rewritten.has(nameOf(entry)));
    headers.delete("set-cookie");
    for (const entry of [...current, ...lost]) headers.append("set-cookie", entry);
  }
}

/** The parts of a hook context that decide whether a failed link goes to the web app. */
interface LinkHook {
  path: string;
  request?: Request;
  headers?: Headers;
  redirect: (url: string) => Error;
}

/**
 * A browser that follows a verify-email or change-email link and meets an error is sent to the web
 * app's /verify-email page with the error code, instead of being shown a JSON body. Only a GET that
 * asks for HTML is redirected: API callers keep the JSON error.
 */
function failedLinkRedirect(ctx: Ctx, hook: LinkHook, error: unknown): Error | null {
  if (
    hook.path !== "/verify-email" ||
    hook.request?.method !== "GET" ||
    !(hook.headers?.get("accept") ?? "").includes("text/html") ||
    !isAPIError(error) ||
    error.statusCode < 400
  )
    return null;
  const code = (error.body as { code?: string } | undefined)?.code ?? "UNKNOWN";
  const site = ctx.config.siteBaseURL ?? ctx.config.auth?.baseURL ?? "http://localhost:3000";
  return hook.redirect(new URL(`/verify-email?error=${encodeURIComponent(code)}`, site).toString());
}

async function redirectFailedLink<T>(ctx: Ctx, hook: LinkHook, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw failedLinkRedirect(ctx, hook, error) ?? error;
  }
}

function invalidToken(): APIError {
  return new APIError("UNAUTHORIZED", { message: "Invalid token", code: "INVALID_TOKEN" });
}

function accountBanned(): APIError {
  return new APIError("FORBIDDEN", { message: "This account is banned.", code: "ACCOUNT_BANNED" });
}

/** Whether the member is banned or was erased: no session may start or go on for them. */
function isClosed(ctx: Ctx, userId: number): boolean {
  const row = prepared(ctx, "auth.banState", () =>
    ctx.sqlite.prepare<
      { banned_until: number | null; banned_permanently: number; erased_at: number | null },
      [number]
    >("SELECT banned_until, banned_permanently, erased_at FROM users WHERE id = ?1"),
  ).get(userId);
  return (
    !!row &&
    (row.erased_at !== null ||
      row.banned_permanently === 1 ||
      (row.banned_until !== null && row.banned_until > ctx.now()))
  );
}

/** Whether the address belongs to an erased member, who can never reset a password again. */
function isErasedAddress(ctx: Ctx, email: string): boolean {
  return !!prepared(ctx, "auth.erasedAddress", () =>
    ctx.sqlite.prepare<{ erased_at: number | null }, [string]>(
      "SELECT u.erased_at FROM auth_user a JOIN users u ON u.id = a.id WHERE a.email = ?1 AND u.erased_at IS NOT NULL",
    ),
  ).get(email.toLowerCase());
}

/** Moves a member whose address is now verified out of the unconfirmed group, if they are in it. */
export function promoteVerifiedMember(ctx: Ctx, userId: number): boolean {
  return writeTx(ctx, () => {
    const changed =
      ctx.sqlite
        .prepare("UPDATE users SET group_id = ?1 WHERE id = ?2 AND group_id = ?3")
        .run(GROUP_IDS.member, userId, GROUP_IDS.unconfirmed).changes > 0;
    if (changed)
      publishEvent(ctx, {
        type: "member.groups_changed",
        targetType: "user",
        targetId: userId,
        payload: {
          added: [GROUP_IDS.member],
          removed: [GROUP_IDS.unconfirmed],
          source: "verification",
        },
      });
    return changed;
  });
}

function userConstraintError(error: unknown): APIError | null {
  if (!(error instanceof Error) || !/^UNIQUE constraint failed: users\./.test(error.message))
    return null;
  return /users\.username_key/.test(error.message)
    ? new APIError("BAD_REQUEST", {
        message: "Username is already taken.",
        code: "USERNAME_IS_ALREADY_TAKEN",
      })
    : new APIError("BAD_REQUEST", {
        message: "Forum profile already exists.",
        code: "USER_CONFLICT",
      });
}

function sessionCookieCache(ctx: Ctx): boolean {
  return ctx.config.auth?.sessionCookieCache !== false;
}

function buildAuth(ctx: Ctx) {
  const config = ctx.config.auth;
  if (!config) throw new Error("Better Auth requires ctx.config.auth.");
  const plugins = authPlugins();
  const usernamePlugin = plugins.find((plugin) => plugin.id === "username") as
    | ReturnType<typeof username>
    | undefined;
  const apiKeyPlugin = plugins.find((plugin) => plugin.id === "api-key") as
    | ReturnType<typeof apiKey>
    | undefined;
  if (!usernamePlugin || !apiKeyPlugin)
    throw new Error("Better Auth username and API key plugins are required.");
  const mailEnabled = accountEmailEnabled(ctx);
  const auth = betterAuth({
    ...authSchemaOptions,
    secret: config.secret,
    baseURL: config.baseURL,
    trustedOrigins: config.trustedOrigins,
    database: drizzleAdapter(ctx.db, { provider: "sqlite", schema }),
    advanced: {
      ...authSchemaOptions.advanced,
      cookiePrefix: "sermo",
      ipAddress: { ipAddressHeaders: [config.clientIpHeader] },
      disableOriginCheck: false,
    },
    emailAndPassword: {
      enabled: true,
      revokeSessionsOnPasswordReset: true,
      ...(mailEnabled
        ? {
            sendResetPassword: async ({
              user,
              url,
            }: {
              user: { id: string; email: string };
              url: string;
            }) => {
              queueAccountEmail(ctx, {
                kind: "reset",
                userId: Number(user.id),
                email: user.email,
                url,
              });
            },
            onPasswordReset: async ({ user }: { user: { id: string; email: string } }) => {
              queueAccountEmail(ctx, {
                kind: "passwordChanged",
                userId: Number(user.id),
                email: user.email,
              });
            },
          }
        : {}),
      minPasswordLength: 8,
      maxPasswordLength: 256,
      password: {
        hash: (password) => Bun.password.hash(password, ctx.config.passwordHash),
        verify: ({ password, hash }) => Bun.password.verify(password, hash),
      },
    },
    session: {
      ...authSchemaOptions.session,
      expiresIn: ctx.config.sessionTtlMs / 1000,
      disableSessionRefresh: true,
      deferSessionRefresh: true,
      // Password resets revoke sessions in the database; cached session cookies would remain
      // usable until their signature expires, so use database-backed sessions with mail enabled.
      cookieCache: { enabled: sessionCookieCache(ctx) && !mailEnabled, maxAge: 300 },
    },
    // Better Auth would answer "is this my password?" for a session without any limit of its own;
    // the forum's own `auth.verifyPassword` is the one place that asks, with the member limit.
    disabledPaths: [...DISABLED_PATHS],
    rateLimit: {
      enabled: true,
      storage: "memory",
      customRules: {
        "/send-verification-email": { window: 3_600, max: 5 },
        "/request-password-reset": { window: 3_600, max: 5 },
        "/change-email": { window: 3_600, max: 5 },
      },
    },
    user: { ...authSchemaOptions.user, changeEmail: { enabled: mailEnabled } },
    ...(mailEnabled
      ? {
          emailVerification: {
            sendOnSignUp: true,
            sendVerificationEmail: async ({
              user,
              url,
              token,
            }: {
              user: { id: string; email: string };
              url: string;
              token: string;
            }) => {
              const claim = await verifyJWT(token, config.secret);
              if (!claim) throw invalidToken();
              if (claim.updateTo)
                await (await auth.$context).internalAdapter.createVerificationValue({
                  identifier: changeEmailIdentifier(token),
                  value: String(user.id),
                  expiresAt: new Date(
                    typeof claim.exp === "number" ? claim.exp * 1000 : Date.now() + 3_600_000,
                  ),
                });
              queueAccountEmail(
                ctx,
                {
                  kind: claim.updateTo ? "changeEmail" : "verify",
                  userId: Number(user.id),
                  email: user.email,
                  url,
                },
                `email.account.verify.${url}`,
              );
            },
            afterEmailVerification: async (user: { id: string; email: string }) => {
              const userId = Number(user.id);
              const promoted = promoteVerifiedMember(ctx, userId);
              if (promoted) queueAccountEmail(ctx, { kind: "welcome", userId, email: user.email });
            },
          },
        }
      : {}),
    hooks: {
      before: createAuthMiddleware(async (hook) =>
        redirectFailedLink(ctx, hook, async () => {
          if (hook.path === "/get-session") return;
          // Use Better Auth's own signed-token reader and its database adapter, never the cache.
          // Supplying the authoritative session also prevents later middleware from caching one.
          hook.context.session = null;
          let requestWithoutCookies: ReturnType<typeof withoutSessionCookies> | undefined;
          const tokenName = hook.context.authCookies.sessionToken.name;
          const sessionToken = await hook.getSignedCookie(tokenName, hook.context.secret);
          if (sessionToken || hook.getCookie(tokenName)) {
            const session = sessionToken
              ? await hook.context.internalAdapter.findSession(sessionToken)
              : null;
            if (!session || session.session.expiresAt.getTime() <= Date.now()) {
              if (!(await proceedsWithoutSession(hook))) {
                // Refuse the request, but let the browser recover on its next sign-in attempt.
                deleteSessionCookie(hook);
                throw new APIError(
                  "UNAUTHORIZED",
                  { code: "UNAUTHORIZED", message: "Unauthorized" },
                  hook.responseHeaders,
                );
              }
              // This endpoint takes no session: treat the request as cookie-less, hide the dead
              // cookies from everything downstream, and expire them in the response (after hook).
              Object.assign(hook.context, { [DEAD_SESSION_COOKIE]: true });
              requestWithoutCookies = withoutSessionCookies(hook);
            } else {
              hook.context.session = session;
              if (hook.path !== "/sign-out" && isClosed(ctx, Number(session.user.id)))
                throw accountBanned();
            }
          }
          // The plugin's sign-in validator retains the historical rule for existing accounts.
          if (
            (hook.path === "/sign-up/email" ||
              hook.path === "/update-user" ||
              hook.path === "/is-username-available") &&
            typeof hook.body?.username === "string" &&
            !isValidUsername(hook.body.username)
          )
            throw new APIError(
              hook.path === "/is-username-available" ? "UNPROCESSABLE_ENTITY" : "BAD_REQUEST",
              {
                code: "INVALID_USERNAME",
                message: "Username is invalid",
              },
            );
          // A name kept for erased accounts is never available.
          if (
            hook.path === "/is-username-available" &&
            typeof hook.body?.username === "string" &&
            isReservedUsername(hook.body.username)
          )
            return hook.json({ available: false });
          if (hook.path === "/change-password" && hook.context.session) {
            // The current password is asked here, so guessing it is held to the limit of the
            // administration checks: five wrong answers per session and twenty per member in
            // fifteen minutes, whatever the client address. Any answer that was not a wrong
            // current password gives its guess back (after hook).
            try {
              Reflect.set(
                hook.context,
                PASSWORD_GUESS,
                takePasswordGuess(
                  ctx,
                  Number(hook.context.session.user.id),
                  Number(hook.context.session.session.id),
                ),
              );
            } catch (error) {
              if (!(error instanceof RateLimitedError)) throw error;
              throw new APIError("TOO_MANY_REQUESTS", {
                code: "TOO_MANY_ATTEMPTS",
                message: error.message,
              });
            }
          }
          if (hook.path === "/sign-in/email" || hook.path === "/sign-in/username") {
            // Better Auth's own limit is three requests per ten seconds per address. This one
            // counts wrong passwords per account and address: ten in fifteen minutes, then the
            // sign-in answers as rate limited for that account from that address only.
            const tried: unknown =
              hook.path === "/sign-in/email" ? hook.body?.email : hook.body?.username;
            const ip = (hook.headers ?? hook.request?.headers)?.get(
              ctx.config.auth?.clientIpHeader ?? "x-sermo-client-ip",
            );
            if (typeof tried === "string" && ip)
              try {
                Reflect.set(hook.context, SIGN_IN_GUESS, takeSignInGuess(ctx, tried, ip));
              } catch (error) {
                if (!(error instanceof RateLimitedError)) throw error;
                throw new APIError("TOO_MANY_REQUESTS", {
                  code: "TOO_MANY_ATTEMPTS",
                  message: error.message,
                });
              }
          }
          if (hook.path === "/api-key/create" && hook.context.session) {
            // A key acts without the password rule, so minting one from a session takes the
            // member's current password, under the same wrong-answer limits as everywhere else.
            const password: unknown = hook.body?.password;
            if (typeof password !== "string" || !password)
              throw new APIError("BAD_REQUEST", {
                code: "PASSWORD_REQUIRED",
                message: "Your current password is required to create an API key.",
              });
            try {
              await checkOwnPassword(
                ctx,
                hook.context,
                Number(hook.context.session.user.id),
                Number(hook.context.session.session.id),
                password,
                "password",
              );
            } catch (error) {
              if (error instanceof RateLimitedError)
                throw new APIError("TOO_MANY_REQUESTS", {
                  code: "TOO_MANY_ATTEMPTS",
                  message: error.message,
                });
              if (error instanceof ForbiddenError)
                throw new APIError("FORBIDDEN", {
                  code: "INVALID_PASSWORD",
                  message: error.message,
                });
              throw error;
            }
          }
          if (hook.path === "/reset-password") {
            // An erased member's link is dead even if one survived the erasure.
            const token: unknown = hook.body?.token ?? hook.query?.token;
            const pending =
              typeof token === "string"
                ? await hook.context.internalAdapter.findVerificationValue(
                    `reset-password:${token}`,
                  )
                : null;
            const holder = Number(pending?.value);
            if (Number.isSafeInteger(holder)) Reflect.set(hook.context, RESET_HOLDER, holder);
            if (
              Number.isSafeInteger(holder) &&
              prepared(ctx, "auth.erasedMember", () =>
                ctx.sqlite.prepare<{ id: number }, [number]>(
                  "SELECT id FROM users WHERE id = ?1 AND erased_at IS NOT NULL",
                ),
              ).get(holder)
            )
              throw invalidToken();
          }
          if (hook.path === "/request-password-reset") {
            const email: unknown = hook.body?.email;
            // Answered like any other address, but no link is made for an erased member.
            if (typeof email === "string" && isErasedAddress(ctx, email))
              return hook.json({
                status: true,
                message: "If this email exists in our system, check your email for the reset link",
              });
            const redirectTo: unknown = hook.body?.redirectTo;
            if (typeof redirectTo !== "string" || !redirectTo.trim())
              throw new APIError("BAD_REQUEST", {
                message: "redirectTo is required.",
                code: "REDIRECT_REQUIRED",
              });
          }
          if (hook.path !== "/verify-email") return requestWithoutCookies;
          const token: unknown = hook.query?.token;
          if (typeof token !== "string") return requestWithoutCookies;
          // Classify the verified JWT payload, including base64url and UTF-8, with the same
          // decoder that validates it. A separate, fallible classifier could bypass this flow.
          const verified = await verifyJWT(token, hook.context.secret);
          if (!verified?.updateTo) return requestWithoutCookies;
          // Returning here bypasses Better Auth's email-based lookup/update. Check its callback
          // policy too: the endpoint middleware will not run after a before-hook response.
          const callbackURL: unknown = hook.query?.callbackURL;
          if (
            callbackURL !== undefined &&
            (typeof callbackURL !== "string" ||
              (callbackURL &&
                !hook.context.isTrustedOrigin(callbackURL, { allowRelativePaths: true })))
          )
            throw new APIError("FORBIDDEN", {
              code: "INVALID_CALLBACK_URL",
              message: "Invalid callbackURL",
            });
          if (
            typeof verified.email !== "string" ||
            typeof verified.updateTo !== "string" ||
            verified.requestType !== "change-email-verification" ||
            typeof verified.exp !== "number"
          )
            throw invalidToken();
          const { email, updateTo, exp } = verified;
          const identifier = changeEmailIdentifier(token);
          const session = hook.context.session;
          const user = writeTx(ctx, () => {
            const now = Date.now();
            const pending = ctx.sqlite
              .prepare<{ value: string; expires_at: number }, [string]>(
                "SELECT value, expires_at FROM auth_verification WHERE identifier = ?1 ORDER BY created_at DESC, id DESC LIMIT 1",
              )
              .get(identifier);
            if (!pending || pending.expires_at <= now || exp * 1000 <= now) throw invalidToken();
            const userId = Number(pending.value);
            if (!Number.isSafeInteger(userId) || userId <= 0) throw invalidToken();
            const holder = ctx.db
              .select()
              .from(schema.auth_user)
              .where(eq(schema.auth_user.id, userId))
              .get();
            if (!holder || holder.email !== email) throw invalidToken();
            if (session && session.user.id !== String(userId))
              throw new APIError("UNAUTHORIZED", { code: "INVALID_USER", message: "Invalid user" });
            if (
              session &&
              !ctx.sqlite
                .prepare(
                  "SELECT 1 FROM auth_session WHERE token = ?1 AND user_id = ?2 AND expires_at > ?3",
                )
                .get(session.session.token, userId, now)
            )
              throw new APIError("UNAUTHORIZED", { code: "UNAUTHORIZED", message: "Unauthorized" });
            if (isClosed(ctx, userId)) throw accountBanned();
            if (
              ctx.sqlite
                .prepare("SELECT 1 FROM auth_user WHERE email = ?1 AND id <> ?2")
                .get(updateTo, userId)
            )
              throw new APIError("CONFLICT", {
                code: "EMAIL_ALREADY_IN_USE",
                message: "Email is already in use",
              });
            // These two credential writes intentionally share one synchronous transaction. The
            // async internal adapter cannot atomically condition the update on the original email.
            const changed = ctx.sqlite
              .prepare(
                "UPDATE auth_user SET email = ?1, email_verified = 1, updated_at = ?2 WHERE id = ?3 AND email = ?4",
              )
              .run(updateTo, now, userId, email).changes;
            if (changed !== 1) throw invalidToken();
            ctx.sqlite
              .prepare("DELETE FROM auth_verification WHERE identifier = ?1")
              .run(identifier);
            const promoted = !holder.emailVerified && promoteVerifiedMember(ctx, userId);
            for (const address of new Set([email, updateTo]))
              queueAccountEmail(ctx, { kind: "emailChanged", userId, email: address });
            if (promoted) queueAccountEmail(ctx, { kind: "welcome", userId, email: updateTo });
            return {
              ...holder,
              id: String(userId),
              email: updateTo,
              emailVerified: true,
              updatedAt: new Date(now),
            };
          });
          const activeSession =
            session?.session ?? (await hook.context.internalAdapter.createSession(user.id));
          if (!activeSession)
            throw new APIError("INTERNAL_SERVER_ERROR", {
              code: "FAILED_TO_CREATE_SESSION",
              message: "Failed to create session",
            });
          await setSessionCookie(hook, { session: activeSession, user });
          if (callbackURL) throw hook.redirect(callbackURL as string);
          return hook.json({ status: true, user: parseUserOutput(hook.context.options, user) });
        }),
      ),
      after: createAuthMiddleware(async (hook) => {
        if (Reflect.get(hook.context, DEAD_SESSION_COOKIE) === true) retireDeadSessionCookies(hook);
        const failed =
          hook.context.returned instanceof APIError ||
          (hook.context.returned instanceof Response && !hook.context.returned.ok);
        const guess = Reflect.get(hook.context, PASSWORD_GUESS);
        // Only Better Auth's refusal of the CURRENT password is a wrong guess: a rejected new
        // password (too short or long) or a missing credential account says nothing about it.
        const returned: unknown = hook.context.returned;
        const wrongPassword =
          returned instanceof APIError &&
          (returned.body as { code?: unknown } | undefined)?.code === "INVALID_PASSWORD";
        if (typeof guess === "number" && !wrongPassword) forgivePasswordGuess(ctx, guess);
        const signIn = Reflect.get(hook.context, SIGN_IN_GUESS);
        const wrongSignIn =
          returned instanceof APIError &&
          /^INVALID_(?:EMAIL|USERNAME)_OR_PASSWORD$/.test(
            String((returned.body as { code?: unknown } | undefined)?.code),
          );
        if (typeof signIn === "number" && !wrongSignIn) forgiveSignInGuess(ctx, signIn);
        // A new password also ends the member's API keys: they are credentials too.
        if (!failed && (hook.path === "/change-password" || hook.path === "/reset-password")) {
          const holder = Reflect.get(hook.context, RESET_HOLDER) ?? hook.context.session?.user.id;
          if (holder !== undefined) await revokeApiKeys(ctx, Number(holder));
        }
        if (!mailEnabled) return;
        if (failed) return;
        if (hook.path === "/change-password") {
          const user = hook.context.session?.user;
          if (user)
            queueAccountEmail(ctx, {
              kind: "passwordChanged",
              userId: Number(user.id),
              email: user.email,
            });
        }
        if (hook.path === "/api-key/create") {
          const result = hook.context.returned as { id?: string; referenceId?: string } | undefined;
          const userId = Number(result?.referenceId);
          if (!result?.id || !Number.isSafeInteger(userId)) return;
          const user = ctx.sqlite
            .prepare<{ email: string }, [number]>("SELECT email FROM auth_user WHERE id = ?1")
            .get(userId);
          if (user)
            queueAccountEmail(
              ctx,
              { kind: "apiKeyCreated", userId, email: user.email },
              `email.account.key.${result.id}`,
            );
        }
      }),
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            if (isClosed(ctx, Number(session.userId))) throw accountBanned();
          },
        },
      },
      user: {
        create: {
          before: async (user, hookContext) => {
            const username = typeof user.username === "string" ? user.username : null;
            if (!username)
              throw new APIError("BAD_REQUEST", {
                message: "Username is required.",
                code: "USERNAME_REQUIRED",
              });
            const display =
              typeof user.displayUsername === "string" ? user.displayUsername : username;
            if (!USERNAME_PATTERN.test(display) || display.toLowerCase() !== username.toLowerCase())
              throw new APIError("BAD_REQUEST", {
                message: "Display username must match username apart from letter case.",
                code: "INVALID_DISPLAY_USERNAME",
              });
            const existing = ctx.sqlite
              .prepare("SELECT id FROM users WHERE username_key = ?1")
              .get(username.toLowerCase());
            if (existing || isReservedUsername(username))
              throw new APIError("BAD_REQUEST", {
                message: "Username is already taken.",
                code: "USERNAME_IS_ALREADY_TAKEN",
              });
            if (ctx.config.spamChecker) {
              const headerName = ctx.config.auth?.clientIpHeader ?? "x-sermo-client-ip";
              const ip = (hookContext as { headers?: Headers } | undefined)?.headers?.get(
                headerName,
              );
              if (!ip)
                throw new APIError("BAD_REQUEST", {
                  message: "Client IP is required for spam checks.",
                  code: "SPAM_IP_REQUIRED",
                });
              const verdict = await ctx.config.spamChecker.check({
                ip,
                email: typeof user.email === "string" ? user.email : undefined,
                username,
                kind: "signup",
              });
              if (verdict.spam)
                throw new APIError("BAD_REQUEST", {
                  message: "Registration requires review.",
                  code: "SPAM_REJECTED",
                });
            }
          },
          after: async (user) => {
            const normalized = typeof user.username === "string" ? user.username : null;
            const display =
              typeof user.displayUsername === "string" ? user.displayUsername : normalized;
            if (!normalized || !display || display.toLowerCase() !== normalized)
              throw new APIError("BAD_REQUEST", {
                message: "Username is required.",
                code: "USERNAME_REQUIRED",
              });
            try {
              writeTx(ctx, () => {
                ctx.sqlite
                  .prepare(
                    "INSERT INTO users (id, username, username_key, group_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                  )
                  .run(
                    Number(user.id),
                    display,
                    normalized,
                    mailEnabled ? GROUP_IDS.unconfirmed : GROUP_IDS.member,
                    ctx.now(),
                  );
                publishEvent(ctx, {
                  type: "member.registered",
                  targetType: "user",
                  targetId: Number(user.id),
                });
              });
            } catch (error) {
              const mapped = userConstraintError(error);
              if (mapped) throw mapped;
              throw error;
            }
          },
        },
        update: {
          before: async (user, context) => {
            if ("username" in user && user.username === null)
              throw new APIError("BAD_REQUEST", {
                message: "Username cannot be cleared.",
                code: "USERNAME_REQUIRED",
              });
            if ("displayUsername" in user && user.displayUsername === null)
              throw new APIError("BAD_REQUEST", {
                message: "Display username cannot be cleared.",
                code: "INVALID_DISPLAY_USERNAME",
              });
            const typedUsername =
              typeof context?.body?.username === "string"
                ? context.body.username
                : typeof user.username === "string"
                  ? user.username
                  : null;
            const requested = typedUsername?.toLowerCase() ?? null;
            const display =
              typeof user.displayUsername === "string" ? user.displayUsername : typedUsername;
            if (!requested && !display) return;
            const change = usernameChange.getStore();
            const currentId = change?.userId ?? Number(context?.context?.session?.user?.id);
            const current =
              Number.isSafeInteger(currentId) && currentId > 0
                ? ctx.sqlite
                    .prepare<{ username: string }, [number]>(
                      "SELECT username FROM auth_user WHERE id = ?1",
                    )
                    .get(currentId)
                : null;
            const normalized = requested ?? current?.username;
            if (
              !normalized ||
              (display && (!USERNAME_PATTERN.test(display) || display.toLowerCase() !== normalized))
            )
              throw new APIError("BAD_REQUEST", {
                message: "Display username must match username apart from letter case.",
                code: "INVALID_DISPLAY_USERNAME",
              });
            const existing = ctx.sqlite
              .prepare<{ id: number }, [string]>("SELECT id FROM users WHERE username_key = ?1")
              .get(normalized);
            if (
              (existing && existing.id !== currentId) ||
              (isReservedUsername(normalized) && !change?.reserved)
            )
              throw new APIError("BAD_REQUEST", {
                message: "Username is already taken.",
                code: "USERNAME_IS_ALREADY_TAKEN",
              });
            // A username changes only through users.changeUsername, which pays for it first.
            if (!change)
              throw new APIError("FORBIDDEN", {
                message: "Change your username with users.changeUsername.",
                code: "USERNAME_CHANGE_NOT_ALLOWED",
              });
            if (typedUsername && user.displayUsername === undefined)
              return { data: { ...user, displayUsername: typedUsername } };
          },
          after: async (user) => {
            const normalized = typeof user.username === "string" ? user.username : null;
            const display = typeof user.displayUsername === "string" ? user.displayUsername : null;
            if (!normalized) return;
            const username = display?.toLowerCase() === normalized ? display : normalized;
            try {
              ctx.sqlite
                .prepare("UPDATE users SET username = ?1, username_key = ?2 WHERE id = ?3")
                .run(username, normalized, Number(user.id));
            } catch (error) {
              const mapped = userConstraintError(error);
              if (mapped) throw mapped;
              throw error;
            }
          },
        },
      },
    },
    plugins: [usernamePlugin, apiKeyPlugin, openAPI()],
  });
  return auth;
}

export type SermoAuth = ReturnType<typeof buildAuth>;
const instances = new WeakMap<
  Ctx,
  { auth: SermoAuth; mailEnabled: boolean; cookieCache: boolean }
>();

/** The Better Auth instance for this context. */
export function getAuth(ctx: Ctx): SermoAuth {
  const mailEnabled = accountEmailEnabled(ctx);
  let instance = instances.get(ctx);
  const cookieCache = sessionCookieCache(ctx);
  if (!instance || instance.mailEnabled !== mailEnabled || instance.cookieCache !== cookieCache) {
    instance = { auth: buildAuth(ctx), mailEnabled, cookieCache };
    instances.set(ctx, instance);
  }
  return instance.auth;
}

/** Revoke a banned user's Better Auth sessions and API keys through Better Auth's adapters. */
export async function revokeUserCredentials(ctx: Ctx, userId: number): Promise<void> {
  const authContext = await getAuth(ctx).$context;
  await authContext.internalAdapter.deleteUserSessions(String(userId));
  await revokeApiKeys(ctx, userId);
}

/** Deletes every API key of the member: a key is a credential that outlives a password change. */
export async function revokeApiKeys(ctx: Ctx, userId: number): Promise<void> {
  const authContext = await getAuth(ctx).$context;
  await authContext.adapter.deleteMany({
    model: "apikey",
    where: [{ field: "referenceId", value: String(userId) }],
  });
}

/**
 * Cuts off every session the member has now, the ones a cookie cache still holds included: a
 * session issued at or before this moment is refused by `resolveActor`. Run it inside the
 * transaction that decides the cut, and again once the session rows are gone, so a session that
 * started in between is cut too.
 */
export function markSessionsRevoked(ctx: Ctx, userId: number): void {
  prepared(ctx, "auth.sessionsRevoked", () =>
    ctx.sqlite.prepare("UPDATE users SET sessions_revoked_at = ?1 WHERE id = ?2"),
  ).run(ctx.now(), userId);
}

/**
 * Deletes the member's pending password-reset and change-email tokens (Better Auth keys both by a
 * random identifier and holds the member's id as the value). A link requested earlier then stops
 * working. Email verification links are signed tokens that name an address, not a member, and
 * stop matching once the address changes.
 */
export async function deletePendingTokens(ctx: Ctx, userId: number): Promise<void> {
  const authContext = await getAuth(ctx).$context;
  await authContext.adapter.deleteMany({
    model: "verification",
    where: [{ field: "value", value: String(userId) }],
  });
}

type ForumUser = { group_id: number };
type MemberRow = PrincipalRow & {
  pv: number | null;
  tv: number | null;
  erased_at: number | null;
  sessions_revoked_at: number | null;
};
const MEMBER_SQL =
  `SELECT ${PRINCIPAL_COLUMNS}, u.erased_at, u.sessions_revoked_at, ` +
  "(SELECT version FROM cache_versions WHERE key = 'permissions') AS pv, " +
  "(SELECT version FROM cache_versions WHERE key = 'node_tree') AS tv FROM users u WHERE u.id = ?1";

/**
 * The member's primary group (repairing a missing forum row), then their permission principal
 * (combination, ban and restriction state, cache versions) in one lookup. Refuses banned accounts.
 */
function memberFor(
  ctx: Ctx,
  userId: number,
): { groupId: number; principal: Principal; sessionsRevokedAt: number | null } {
  const groupId = groupFor(ctx, userId);
  const row = prepared(ctx, "auth.member", () =>
    ctx.sqlite.prepare<MemberRow, [number]>(MEMBER_SQL),
  ).get(userId);
  if (!row) throw new UnauthenticatedError();
  if (
    row.erased_at !== null ||
    row.banned_permanently ||
    (row.banned_until !== null && row.banned_until > ctx.now())
  )
    throw new ForbiddenError("This account is banned.");
  // Buffered, never written during the request (see flushActivity).
  ctx.activity.set(userId, ctx.now());
  return {
    groupId,
    principal: principalFromRow(row, { permissions: row.pv ?? 0, nodeTree: row.tv ?? 0 }),
    sessionsRevokedAt: row.sessions_revoked_at,
  };
}

function groupFor(ctx: Ctx, userId: number): number {
  const row = prepared(ctx, "auth.forumUser", () =>
    ctx.sqlite.prepare<ForumUser, [number]>("SELECT group_id FROM users WHERE id = ?1"),
  ).get(userId);
  if (row) return row.group_id;
  return writeTx(ctx, () => {
    const existing = prepared(ctx, "auth.forumUser", () =>
      ctx.sqlite.prepare<ForumUser, [number]>("SELECT group_id FROM users WHERE id = ?1"),
    ).get(userId);
    if (existing) return existing.group_id;
    const identity = prepared(ctx, "auth.identityForRepair", () =>
      ctx.sqlite.prepare<
        {
          username: string | null;
          display_username: string | null;
          name: string;
          created_at: number;
          email_verified: number;
        },
        [number]
      >(
        "SELECT username, display_username, name, created_at, email_verified FROM auth_user WHERE id = ?1",
      ),
    ).get(userId);
    if (!identity) throw new UnauthenticatedError();
    const normalized = identity.username;
    if (!normalized) throw new UnauthenticatedError();
    const username =
      identity.display_username?.toLowerCase() === normalized
        ? identity.display_username
        : normalized;
    const repairedGroup =
      accountEmailEnabled(ctx) && !identity.email_verified
        ? GROUP_IDS.unconfirmed
        : GROUP_IDS.member;
    ctx.sqlite
      .prepare(
        "INSERT INTO users (id, username, username_key, group_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
      )
      .run(userId, username, normalized, repairedGroup, identity.created_at);
    publishEvent(ctx, { type: "member.registered", targetType: "user", targetId: userId });
    return repairedGroup;
  });
}

/** Resolves API keys and session cookies to one actor for every caller. */
export async function resolveActor(
  ctx: Ctx,
  headers: Headers,
): Promise<{ actor: Actor; setCookies: string[] }> {
  const authorization = headers.get("authorization");
  const bearer = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (authorization !== null && !bearer) throw new UnauthenticatedError();
  const key = bearer ?? headers.get("x-api-key");
  const clientIp = headers.get(ctx.config.auth?.clientIpHeader ?? "x-sermo-client-ip") ?? undefined;
  if (key !== null && key !== undefined) {
    const hash = await defaultKeyHasher(key);
    const row = prepared(ctx, "auth.apiKey", () =>
      ctx.sqlite.prepare<
        { id: number; reference_id: string; enabled: number | null; expires_at: number | null },
        [string]
      >("SELECT id, reference_id, enabled, expires_at FROM auth_apikey WHERE key = ?1"),
    ).get(hash);
    if (!row?.enabled || (row.expires_at !== null && row.expires_at <= Date.now()))
      throw new UnauthenticatedError();
    if (!/^\d+$/.test(row.reference_id)) throw new UnauthenticatedError();
    const userId = Number(row.reference_id);
    if (!Number.isSafeInteger(userId) || userId <= 0) throw new UnauthenticatedError();
    const { groupId, principal } = memberFor(ctx, userId);
    return {
      actor: {
        kind: "token",
        userId,
        groupId,
        tokenId: row.id,
        principal,
        ...(clientIp ? { clientIp } : {}),
      },
      setCookies: [],
    };
  }
  const cookie = headers.get("cookie");
  if (!cookie || !/(?:^|;\s*)(?:__Secure-)?sermo\.session_token=/.test(cookie))
    return { actor: GUEST, setCookies: [] };
  const result = await getAuth(ctx).api.getSession({ headers, returnHeaders: true });
  const session = result.response;
  if (!session) throw new UnauthenticatedError();
  const userId = Number(session.user.id);
  const sessionId = Number(session.session.id);
  if (
    !Number.isSafeInteger(userId) ||
    userId <= 0 ||
    !Number.isSafeInteger(sessionId) ||
    sessionId <= 0
  )
    throw new UnauthenticatedError();
  const { groupId, principal, sessionsRevokedAt } = memberFor(ctx, userId);
  // The member's sessions were cut off after this one was issued: the cookie cache may still
  // hold it, so the member's own row (already loaded) decides, not the cache.
  if (
    sessionsRevokedAt !== null &&
    new Date(session.session.createdAt).getTime() <= sessionsRevokedAt
  )
    throw new UnauthenticatedError();
  return {
    actor: {
      kind: "user",
      userId,
      groupId,
      sessionId,
      principal,
      ...(clientIp ? { clientIp } : {}),
    },
    setCookies: result.headers.getSetCookie(),
  };
}

export const CREDENTIAL_PURGE_BATCH = 1000;

type CredentialCursor = { sessions: number; apiKeys: number; verifications: number };

/** Keyset scan (primary key) and conditional delete for each purged Better Auth table. */
export const credentialPurgeSql = {
  sessions: {
    scan: `SELECT id FROM auth_session WHERE id > ?1 ORDER BY id LIMIT ${CREDENTIAL_PURGE_BATCH}`,
    delete:
      "DELETE FROM auth_session WHERE id IN (SELECT value FROM json_each(?1)) AND expires_at <= ?2",
  },
  apiKeys: {
    scan: `SELECT id FROM auth_apikey WHERE id > ?1 ORDER BY id LIMIT ${CREDENTIAL_PURGE_BATCH}`,
    delete:
      "DELETE FROM auth_apikey WHERE id IN (SELECT value FROM json_each(?1)) AND expires_at IS NOT NULL AND expires_at <= ?2",
  },
  verifications: {
    scan: `SELECT id FROM auth_verification WHERE id > ?1 ORDER BY id LIMIT ${CREDENTIAL_PURGE_BATCH}`,
    delete:
      "DELETE FROM auth_verification WHERE id IN (SELECT value FROM json_each(?1)) AND expires_at <= ?2",
  },
} as const;

/**
 * Removes expired Better Auth credentials in one short write transaction. Scans at most
 * `CREDENTIAL_PURGE_BATCH` ids per table after the cursor (so tables full of live rows are
 * bounded too) and deletes the expired ones among them. `more` is true while any table may
 * hold unscanned rows; pass `after` back to continue.
 */
export function purgeExpiredCredentialsBatch(
  ctx: Ctx,
  after: CredentialCursor = { sessions: 0, apiKeys: 0, verifications: 0 },
): CredentialCursor & { more: boolean; after: CredentialCursor } {
  return writeTx(ctx, () => {
    const now = ctx.now();
    const counts = { sessions: 0, apiKeys: 0, verifications: 0 };
    const next = { ...after };
    let more = false;
    for (const table of ["sessions", "apiKeys", "verifications"] as const) {
      const sql = credentialPurgeSql[table];
      const ids = prepared(ctx, `auth.purge.${table}.scan`, () =>
        ctx.sqlite.prepare<{ id: number }, [number]>(sql.scan),
      ).all(after[table]);
      if (ids.length === 0) continue;
      counts[table] = prepared(ctx, `auth.purge.${table}.delete`, () =>
        ctx.sqlite.prepare(sql.delete),
      ).run(JSON.stringify(ids.map((row) => row.id)), now).changes;
      next[table] = ids[ids.length - 1]!.id;
      if (ids.length === CREDENTIAL_PURGE_BATCH) more = true;
    }
    return { ...counts, more, after: next };
  });
}

/** Finds a member whose resolved permission combination grants administrator access. */
function administratorId(ctx: Ctx): number | null {
  const combinations = combinationsGranting(ctx, "admin.permissions");
  if (combinations.length === 0) return null;
  return (
    prepared(ctx, "auth.administrator", () =>
      ctx.sqlite.prepare<{ id: number }, [string]>(
        "SELECT id FROM users WHERE permission_combination_id IN (SELECT value FROM json_each(?1)) LIMIT 1",
      ),
    ).get(JSON.stringify(combinations))?.id ?? null
  );
}

/** Creates or promotes the first administrator, then remains idempotent. */
export async function ensureAdmin(
  ctx: Ctx,
  input: { username: string; email: string; password: string },
): Promise<{ userId: number; created: boolean }> {
  const admin = administratorId(ctx);
  if (admin !== null) return { userId: admin, created: false };
  const existing = ctx.sqlite
    .prepare<{ id: number; email: string }, [string]>(
      "SELECT id, email FROM auth_user WHERE username = ?1",
    )
    .get(input.username.toLowerCase());
  let created = false;
  let targetId: number;
  let verifiedHash: string | null = null;
  if (existing) {
    const account = ctx.sqlite
      .prepare<{ password: string | null }, [number]>(
        "SELECT password FROM auth_account WHERE user_id = ?1 AND provider_id = 'credential' LIMIT 1",
      )
      .get(existing.id);
    if (
      existing.email.toLowerCase() !== input.email.toLowerCase() ||
      !account?.password ||
      !(await Bun.password.verify(input.password, account.password))
    )
      throw new ConflictError("Admin bootstrap conflicts with an existing account.");
    verifiedHash = account.password;
    targetId = existing.id;
    groupFor(ctx, targetId);
  } else {
    const result = await getAuth(ctx).api.signUpEmail({
      body: {
        name: input.username,
        username: input.username,
        email: input.email,
        password: input.password,
      },
    });
    targetId = Number(result.user.id);
    created = true;
  }
  const userId = writeTx(ctx, () => {
    const current = administratorId(ctx);
    if (current !== null) return current;
    if (verifiedHash) {
      const identity = ctx.sqlite
        .prepare<{ email: string }, [number]>("SELECT email FROM auth_user WHERE id = ?1")
        .get(targetId);
      const account = ctx.sqlite
        .prepare<{ password: string | null }, [number]>(
          "SELECT password FROM auth_account WHERE user_id = ?1 AND provider_id = 'credential' LIMIT 1",
        )
        .get(targetId);
      if (
        identity?.email.toLowerCase() !== input.email.toLowerCase() ||
        account?.password !== verifiedHash
      )
        throw new ConflictError("Admin bootstrap conflicts with an existing account.");
    }
    const changed = ctx.sqlite
      .prepare("UPDATE users SET group_id = ?1 WHERE id = ?2")
      .run(GROUP_IDS.admin, targetId).changes;
    if (!changed) throw new ConflictError("Admin bootstrap account is missing its forum profile.");
    // A site always has a super admin: the first administrator is one when there is none.
    ctx.sqlite
      .prepare(
        "UPDATE users SET is_super_admin = 1 WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM users WHERE is_super_admin = 1 AND erased_at IS NULL)",
      )
      .run(targetId);
    return targetId;
  });
  return { userId, created };
}

export const authMeOp = implement(authMe, (ctx, actor) => {
  const checks = permissionsOf(ctx, actor);
  const permissions = {
    isAdmin: checks.can("admin.permissions"),
    isModerator: checks.can("moderation.access"),
    canViewProfiles: checks.can("profile.view"),
    canPostProfile: checks.can("profilePost.post"),
    canStartConversations: checks.can("conversation.start"),
    canReact: checks.can("reaction.react"),
  };
  const resolved = resolvedPermissions(ctx, actor);
  const staff = staffAccess(ctx, actor, resolved);
  if (actor.kind === "guest")
    return { user: null, permissions, resolvedPermissions: resolved, staff };
  const row = prepared(ctx, "auth.me", () =>
    ctx.sqlite.prepare<
      {
        id: number;
        username: string;
        email: string;
        group_id: number;
        created_at: number;
        language: string | null;
      },
      [number]
    >(
      "SELECT u.id, u.username, a.email, u.group_id, u.created_at, u.language FROM users u JOIN auth_user a ON a.id = u.id WHERE u.id = ?1",
    ),
  ).get(actor.userId);
  if (!row) throw new UnauthenticatedError();
  // The actor's own principal: no further lookup.
  const display = memberDisplay(ctx, actor);
  return {
    user: {
      id: row.id,
      username: row.username,
      email: row.email,
      groupId: row.group_id,
      createdAt: iso(row.created_at),
      language: row.language,
      displayGroup: display && {
        id: display.groupId,
        title: display.title,
        userTitle: display.userTitle,
        badge: display.badge,
      },
    },
    permissions,
    resolvedPermissions: resolved,
    staff,
  };
});

/**
 * Unread notifications from the member's counter, and unread conversations among the 100 most
 * recently active ones: one statement, the inbox index (user, state, last message) in order,
 * stopped after 100 rows, then a primary-key lookup of each conversation's last message.
 */
export const countersSql =
  "SELECT u.unread_notification_count AS notifications, " +
  "(SELECT count(*) FROM (SELECT cp.conversation_id, cp.last_read_message_id FROM conversation_participants cp " +
  "WHERE cp.user_id = ?1 AND cp.state = 'active' ORDER BY cp.last_message_at DESC, cp.conversation_id DESC LIMIT 100) AS recent " +
  "JOIN conversations c ON c.id = recent.conversation_id WHERE c.last_message_id > recent.last_read_message_id) AS conversations " +
  "FROM users u WHERE u.id = ?1";
export const authCountersOp = implement(
  authCounters,
  (ctx, actor) => {
    const none = { notifications: 0, conversations: 0 };
    if (actor.kind === "guest") return { ...none, ...queueCounts(ctx, actor) };
    const own =
      prepared(ctx, "auth.counters", () =>
        ctx.sqlite.prepare<{ notifications: number; conversations: number }, [number]>(countersSql),
      ).get(actor.userId) ?? none;
    return { ...own, ...queueCounts(ctx, actor) };
  },
  { public: "Every caller sees only their own counters; guests see zeros." },
);

export const operations: AnyOperation[] = [authMeOp, authCountersOp];
