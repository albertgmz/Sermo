import "server-only";

import { cookies } from "next/headers";
import { forwardFromRequest } from "./client";
import { parseSetCookie } from "./set-cookie";
import { send } from "./transport";

export type AuthResult = {
  ok: boolean;
  // Better Auth's error code, e.g. INVALID_USERNAME_OR_PASSWORD.
  code?: string;
  status: number;
  // A session cookie came back: the visitor is signed in.
  signedIn: boolean;
};

async function post(path: string, body?: unknown): Promise<AuthResult> {
  const response = await send(
    "POST",
    `/api/auth/${path}`,
    await forwardFromRequest(),
    body === undefined ? undefined : JSON.stringify(body),
  );
  // Every cookie is delivered, also on a failed attempt.
  const store = await cookies();
  let signedIn = false;
  for (const header of response.headers.getSetCookie()) {
    const parsed = parseSetCookie(header);
    if (!parsed) continue;
    store.set({ name: parsed.name, value: parsed.value, ...parsed.options });
    if (
      /session_token$/.test(parsed.name) &&
      parsed.value !== "" &&
      parsed.options.maxAge !== 0
    ) {
      signedIn = true;
    }
  }
  let code: string | undefined;
  if (!response.ok) {
    try {
      const error = (await response.json()) as { code?: unknown };
      if (typeof error.code === "string") code = error.code;
    } catch {}
    if (response.status === 429) code = "RATE_LIMITED";
  }
  return { ok: response.ok, code, status: response.status, signedIn };
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

export const signUp = (input: {
  username: string;
  email: string;
  password: string;
}) => post("sign-up/email", { ...input, name: input.username });

export const signOut = () => post("sign-out");
