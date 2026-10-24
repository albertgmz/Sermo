import "server-only";

import {
  ACCEPTANCE_REQUIRED_PATH,
  APPROVAL_PENDING_PATH,
  authMe,
} from "@sermo/core/contracts";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { cache } from "react";
import type * as z from "zod";
import { isSignedOut, SermoError } from "./errors";
import { placeOfPath } from "./place";
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
    const sent = await headers();
    // The proxy names the path of a page view; the page it renders is noted for who is online.
    const place = placeOfPath(sent.get("x-sermo-path")) ?? undefined;
    const forward = { ...forwardFromHeaders(sent), place };
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

// What the backend says about the visitor, settled once per request. A visitor with no session
// cookie is asked here (lazily: a page read never waits for it); when that read fails too the
// backend is out of reach and the shell is drawn for a guest, as for a session that could not be
// confirmed. `kind` says which of the two it was.
const settled = cache(
  async (): Promise<{ viewer: Viewer; kind: "session" | "site" | null }> => {
    const { forward, viewer, unconfirmed } = await visitor();
    if (unconfirmed) return { viewer: UNKNOWN, kind: "session" };
    if (viewer) return { viewer, kind: null };
    try {
      return { viewer: await callWith(forward, authMe, {}), kind: null };
    } catch (error) {
      if (!(error instanceof SermoError) || isSignedOut(error)) throw error;
      console.error("The backend could not be reached for a guest", error);
      return { viewer: UNKNOWN, kind: "site" };
    }
  },
);

// The visitor as the backend sees them: the auth.me answer, a guest for a refused session or when
// the backend cannot be reached.
export async function viewerOfRequest(): Promise<Viewer> {
  return (await settled()).viewer;
}

// Whether the backend could not say who is asking, so the page is drawn for a guest without the
// visitor being one. A page that is only for members uses `getMember`. `session`: the visitor has
// a session cookie that could not be checked; `site`: the visitor has none and the backend could
// not be reached at all.
export async function unconfirmedKind(): Promise<"session" | "site" | null> {
  return (await settled()).kind;
}

export async function sessionUnconfirmed(): Promise<boolean> {
  return (await unconfirmedKind()) !== null;
}

export async function call<I extends z.ZodType, O extends z.ZodType>(
  contract: Described<I, O>,
  input: z.input<I>,
): Promise<z.output<O>> {
  return callWith((await visitor()).forward, contract, input);
}

// For a poll: the call as the visitor, with nothing asked about them first. `call` settles who is
// asking on one auth.me read per request, which would double the requests of every poll; a poll
// carries the session as it is and a dead one is a refusal like any other, on which the caller
// stops polling.
export async function callForPoll<I extends z.ZodType, O extends z.ZodType>(
  contract: Described<I, O>,
  input: z.input<I>,
): Promise<z.output<O>> {
  return callWith(await forwardFromRequest(), contract, input);
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

// The backend refuses a post, reaction or message because the member has not accepted the current
// terms and rules: a refusal (forbidden) that names the `acceptance` issue.
export function isAcceptanceRefusal(error: SermoError): boolean {
  return (
    error.code === "forbidden" &&
    (error.issues ?? []).some(
      (issue) =>
        Array.isArray(issue.path) && issue.path[0] === ACCEPTANCE_REQUIRED_PATH,
    )
  );
}

// The backend refuses a write because the account waits for staff to approve it: a refusal
// (forbidden) that names the `approval` issue.
export function isApprovalRefusal(error: SermoError): boolean {
  return (
    error.code === "forbidden" &&
    (error.issues ?? []).some(
      (issue) =>
        Array.isArray(issue.path) && issue.path[0] === APPROVAL_PENDING_PATH,
    )
  );
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
  if (isAcceptanceRefusal(error)) {
    return (await getTranslations("lib.errors"))("acceptanceRequired");
  }
  if (isApprovalRefusal(error)) {
    return (await getTranslations("lib.errors"))("approvalPending");
  }
  if (error.code === "validation" && error.issues?.length) {
    return error.issues
      .map((issue) => issue.message)
      .filter(Boolean)
      .join(" ");
  }
  return error.message;
}
