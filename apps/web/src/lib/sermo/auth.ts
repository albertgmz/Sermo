import "server-only";

import { cacheLife } from "next/cache";
import { cookies } from "next/headers";
import { cache } from "react";
import * as z from "zod";
import { forwardFromRequest } from "./client";
import { publicUrl } from "./config";
import { parseSetCookie } from "./set-cookie";
import { send } from "./transport";

export type AuthResult = {
  ok: boolean;
  // Better Auth's error code, e.g. INVALID_USERNAME_OR_PASSWORD.
  code?: string;
  // A session cookie came back: the visitor is signed in.
  signedIn: boolean;
};

type Exchange = { result: AuthResult; payload: unknown };

// `deliver` says whether the cookies of the answer are written to the visitor. Only an action may
// do that: while a page renders, Next's cookie store refuses writes and throws. A read made for a
// page therefore ignores them; the backend sends them again on the next action.
async function exchange(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  deliver = true,
): Promise<Exchange> {
  const response = await send(
    method,
    `/api/auth/${path}`,
    await forwardFromRequest(),
    body === undefined ? undefined : JSON.stringify(body),
  );
  // Every cookie is delivered, also on a failed attempt.
  const store = deliver ? await cookies() : undefined;
  let signedIn = false;
  for (const header of response.headers.getSetCookie()) {
    const parsed = parseSetCookie(header);
    if (!parsed) continue;
    store?.set({ name: parsed.name, value: parsed.value, ...parsed.options });
    if (
      /session_token$/.test(parsed.name) &&
      parsed.value !== "" &&
      parsed.options.maxAge !== 0
    ) {
      signedIn = true;
    }
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {}
  let code: string | undefined;
  if (!response.ok) {
    const error = payload as { code?: unknown } | null;
    if (typeof error?.code === "string") code = error.code;
    if (response.status === 429) code = "RATE_LIMITED";
  }
  return { result: { ok: response.ok, code, signedIn }, payload };
}

async function post(path: string, body?: unknown): Promise<AuthResult> {
  return (await exchange("POST", path, body)).result;
}

export const signInWithUsername = (
  username: string,
  password: string,
  rememberMe: boolean,
) => post("sign-in/username", { username, password, rememberMe });

export const signInWithEmail = (
  email: string,
  password: string,
  rememberMe: boolean,
) => post("sign-in/email", { email, password, rememberMe });

// Where the links in the account emails come back to: this site, on the address the browser sees.
// Better Auth appends `error=<code>` to it when a link does not work.
const landing = (path: string) => `${new URL(publicUrl()).origin}${path}`;

export const signUp = (input: {
  username: string;
  email: string;
  password: string;
}) =>
  post("sign-up/email", {
    ...input,
    name: input.username,
    callbackURL: landing("/verify-email?done=1"),
  });

export const signOut = () => post("sign-out");

// What Better Auth reports about one session. The token is the credential itself: it stays on
// the server, and the page identifies a session by its id.
export type SessionRecord = {
  id: string;
  token: string;
  createdAt: string;
  expiresAt: string;
  ipAddress: string | null;
  userAgent: string | null;
};

const SessionList = z.array(
  z.object({
    id: z.string(),
    token: z.string(),
    createdAt: z.string(),
    expiresAt: z.string(),
    ipAddress: z
      .string()
      .nullish()
      .transform((value) => value ?? null),
    userAgent: z
      .string()
      .nullish()
      .transform((value) => value ?? null),
  }),
);

// Listing is refused with SESSION_NOT_FRESH once the session is a day old.
export async function listSessions(): Promise<
  AuthResult & { sessions: SessionRecord[] }
> {
  const { result, payload } = await exchange(
    "GET",
    "list-sessions",
    undefined,
    false,
  );
  const parsed = SessionList.safeParse(payload);
  return {
    ...result,
    sessions: result.ok && parsed.success ? parsed.data : [],
  };
}

const CurrentSession = z.object({
  session: z.object({ id: z.string() }),
  user: z.object({ email: z.string(), emailVerified: z.boolean() }),
});

export type CurrentAccount = {
  sessionId: string;
  email: string;
  emailVerified: boolean;
};

// The session behind the request and whether its address is confirmed, from the database rather
// than the cookie cache. Null for a visitor without a live session. Asked once per request.
export const getCurrentAccount = cache(
  async (): Promise<CurrentAccount | null> => {
    const { result, payload } = await exchange(
      "GET",
      "get-session?disableCookieCache=true",
      undefined,
      false,
    );
    const parsed = CurrentSession.safeParse(payload);
    if (!result.ok || !parsed.success) return null;
    return {
      sessionId: parsed.data.session.id,
      email: parsed.data.user.email,
      emailVerified: parsed.data.user.emailVerified,
    };
  },
);

export const revokeSession = (token: string) =>
  post("revoke-session", { token });

export const revokeOtherSessions = () => post("revoke-other-sessions", {});

// Asking for the other sessions to be revoked ends every session, this one included, and opens a
// new one: its cookie is in the answer and is delivered like any other.
export const changePassword = (input: {
  currentPassword: string;
  newPassword: string;
  revokeOtherSessions: boolean;
}) => post("change-password", input);

// Account emails exist only when the backend has a mail driver. Each of these answers
// CHANGE_EMAIL_DISABLED, VERIFICATION_EMAIL_NOT_ENABLED or RESET_PASSWORD_DISABLED when it has
// none.
export const requestEmailChange = (newEmail: string) =>
  post("change-email", {
    newEmail,
    callbackURL: landing("/verify-email?done=1"),
  });

export const sendVerificationEmail = (email: string) =>
  post("send-verification-email", {
    email,
    callbackURL: landing("/verify-email?done=1"),
  });

export const requestPasswordReset = (email: string) =>
  post("request-password-reset", {
    email,
    redirectTo: landing("/reset-password"),
  });

export const resetPassword = (token: string, newPassword: string) =>
  post("reset-password", { token, newPassword });

// An address nobody has: asking for its verification email sends nothing when mail is on and is
// refused with VERIFICATION_EMAIL_NOT_ENABLED when it is off. The one probe with no effect,
// which is why the answer is kept for a while; every mail endpoint is rate limited per address.
const PROBE_ADDRESS = "mail-check@example.invalid";

async function probeMail(): Promise<boolean> {
  "use cache";
  try {
    const response = await send(
      "POST",
      "/api/auth/send-verification-email",
      {},
      JSON.stringify({ email: PROBE_ADDRESS }),
    );
    let code: unknown;
    try {
      code = ((await response.json()) as { code?: unknown }).code;
    } catch {}
    cacheLife({ stale: 300, revalidate: 1800, expire: 3600 });
    return code !== "VERIFICATION_EMAIL_NOT_ENABLED";
  } catch {
    // Unreachable: show the forms, the attempt reports the failure. Asked again soon.
    cacheLife({ stale: 30, revalidate: 5, expire: 600 });
    return true;
  }
}

// Whether the backend can send account emails. Call after request-time data.
export const mailAvailable = probeMail;
