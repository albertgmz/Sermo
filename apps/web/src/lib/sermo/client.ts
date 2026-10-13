import "server-only";

import { authMe } from "@sermo/core/contracts";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { cache } from "react";
import type * as z from "zod";
import { isSignedOut, SermoError } from "./errors";
import { isRead } from "./request";
import { safeReturnPath } from "./return-path";
import {
  callWith,
  type Described,
  type Forward,
  forwardFromHeaders,
  sermoCookies,
} from "./transport";

type Viewer = z.output<typeof authMe.output>;

// What the shell draws when nothing could be learned about the visitor: a guest who may do
// nothing in particular.
const UNKNOWN: Viewer = {
  user: null,
  permissions: {
    isAdmin: false,
    isModerator: false,
    canViewProfiles: false,
    canPostProfile: false,
    canStartConversations: false,
    canReact: false,
  },
  resolvedPermissions: {},
  staff: {
    panel: false,
    moderatesEverywhere: false,
    moderatedNodeIds: [],
    moderatedNodesTruncated: false,
  },
};

// Who is asking, settled once per request. The backend refuses every request that carries a
// session it no longer accepts (a dead cookie, a banned account), whatever is asked. So a cookie
// is tried on auth.me first and, if refused, left out of every call that follows: the visitor
// then reads the site as a guest instead of each read failing on its own. Nothing is written.
//
// When auth.me itself fails (throttled, an outage, an answer that makes no sense) the backend has
// said nothing about the session: the cookie stays on every call that follows, the shell is drawn
// for a guest and `unconfirmed` says so, and the page's own reads decide what they show.
const visitor = cache(
  async (): Promise<{
    forward: Forward;
    viewer: Viewer | null;
    unconfirmed: boolean;
  }> => {
    const forward = forwardFromHeaders(await headers());
    if (!sermoCookies(forward.cookie)) {
      return { forward, viewer: null, unconfirmed: false };
    }
    try {
      return {
        forward,
        viewer: await callWith(forward, authMe, {}),
        unconfirmed: false,
      };
    } catch (error) {
      if (!(error instanceof SermoError)) throw error;
      if (!isSignedOut(error)) {
        console.error("The session could not be confirmed", error);
        return { forward, viewer: null, unconfirmed: true };
      }
      return {
        forward: { ...forward, cookie: undefined },
        viewer: null,
        unconfirmed: false,
      };
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
  const { forward, viewer, unconfirmed } = await visitor();
  if (unconfirmed) return UNKNOWN;
  return viewer ?? callWith(forward, authMe, {});
}

// Whether the backend could not say who is asking, so the page is drawn for a guest without the
// visitor being one. A page that is only for members uses `getMember`.
export async function sessionUnconfirmed(): Promise<boolean> {
  return (await visitor()).unconfirmed;
}

export async function call<I extends z.ZodType, O extends z.ZodType>(
  contract: Described<I, O>,
  input: z.input<I>,
): Promise<z.output<O>> {
  return callWith((await visitor()).forward, contract, input);
}

// For a block beside a page (a ranking in a side column): the answer, or null when the backend
// does not give it to this visitor because it needs a permission or an account they lack. The
// block then shows nothing; the page neither goes to the login page nor fails. Any other failure
// is still raised.
export async function readIfAllowed<I extends z.ZodType, O extends z.ZodType>(
  contract: Described<I, O>,
  input: z.input<I>,
): Promise<z.output<O> | null> {
  try {
    return await call(contract, input);
  } catch (error) {
    if (error instanceof SermoError && isSignedOut(error)) return null;
    throw error;
  }
}

// The proxy puts the path the visitor asked for in a request header; a page cannot see its URL.
async function loginPath(): Promise<string> {
  const next = safeReturnPath((await headers()).get("x-sermo-path"));
  return next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`;
}

// For pages: a missing record is a 404, a visitor who must sign in goes to the login page. A read
// the backend cannot make sense of (a malformed cursor or page in the address) asks for something
// that cannot exist, so it is a 404 too; a write that fails validation is the caller's to report.
export async function read<I extends z.ZodType, O extends z.ZodType>(
  contract: Described<I, O>,
  input: z.input<I>,
): Promise<z.output<O>> {
  try {
    return await call(contract, input);
  } catch (error) {
    if (!(error instanceof SermoError)) throw error;
    if (error.code === "not_found") notFound();
    if (error.code === "validation" && isRead(contract.name)) notFound();
    if (error.code !== "unauthenticated") throw error;
    redirect(await loginPath());
  }
}

// For actions: what a form can show for a failed call. Only the backend's own refusals carry a
// message meant for visitors; an error raised on our side (code "internal": the API could not be
// reached, its answer made no sense) is logged and replaced by a generic line.
export async function errorMessage(error: unknown): Promise<string> {
  if (!(error instanceof SermoError)) throw error;
  if (error.code === "internal") {
    console.error("A call to the API failed", error);
    return (await getTranslations("lib.errors"))("generic");
  }
  if (error.code === "validation" && error.issues?.length) {
    return error.issues
      .map((issue) => issue.message)
      .filter(Boolean)
      .join(" ");
  }
  return error.message;
}
