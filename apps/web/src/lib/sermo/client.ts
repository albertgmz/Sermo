import "server-only";

import { authMe } from "@sermo/core/contracts";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import type * as z from "zod";
import { isSignedOut, SermoError } from "./errors";
import { safeReturnPath } from "./return-path";
import {
  callWith,
  type Described,
  type Forward,
  forwardFromHeaders,
  sermoCookies,
} from "./transport";

type Viewer = z.output<typeof authMe.output>;

// Who is asking, settled once per request. The backend refuses every request that carries a
// session it no longer accepts (a dead cookie, a banned account), whatever is asked. So a cookie
// is tried on auth.me first and, if refused, left out of every call that follows: the visitor
// then reads the site as a guest instead of each read failing on its own. Nothing is written.
const visitor = cache(
  async (): Promise<{ forward: Forward; viewer: Viewer | null }> => {
    const forward = forwardFromHeaders(await headers());
    if (!sermoCookies(forward.cookie)) return { forward, viewer: null };
    try {
      return { forward, viewer: await callWith(forward, authMe, {}) };
    } catch (error) {
      if (!(error instanceof SermoError && isSignedOut(error))) throw error;
      return { forward: { ...forward, cookie: undefined }, viewer: null };
    }
  },
);

// What the request itself carries, unchecked. Sign-in and sign-out send this: the backend deals
// with a dead cookie on those endpoints itself.
export async function forwardFromRequest(): Promise<Forward> {
  return forwardFromHeaders(await headers());
}

// The visitor as the backend sees them: the auth.me answer, a guest for a refused session.
export async function viewerOfRequest(): Promise<Viewer> {
  const { forward, viewer } = await visitor();
  return viewer ?? callWith(forward, authMe, {});
}

export async function call<I extends z.ZodType, O extends z.ZodType>(
  contract: Described<I, O>,
  input: z.input<I>,
): Promise<z.output<O>> {
  return callWith((await visitor()).forward, contract, input);
}

// The proxy puts the path the visitor asked for in a request header; a page cannot see its URL.
async function loginPath(): Promise<string> {
  const next = safeReturnPath((await headers()).get("x-sermo-path"));
  return next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`;
}

// For pages: a missing record is a 404, a visitor who must sign in goes to the login page.
export async function read<I extends z.ZodType, O extends z.ZodType>(
  contract: Described<I, O>,
  input: z.input<I>,
): Promise<z.output<O>> {
  try {
    return await call(contract, input);
  } catch (error) {
    if (!(error instanceof SermoError)) throw error;
    if (error.code === "not_found") notFound();
    if (error.code !== "unauthenticated") throw error;
    redirect(await loginPath());
  }
}

// For actions: what a form can show for a failed call.
export function errorMessage(error: unknown): string {
  if (!(error instanceof SermoError)) throw error;
  if (error.code === "validation" && error.issues?.length) {
    return error.issues
      .map((issue) => issue.message)
      .filter(Boolean)
      .join(" ");
  }
  return error.message;
}

// The forwarding settled for this request, for the calls that are not operations (uploads).
export async function visitorForward(): Promise<Forward> {
  return (await visitor()).forward;
}
