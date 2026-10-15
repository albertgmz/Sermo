import "server-only";

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { errorMessage } from "./client";
import { SermoError } from "./errors";

export type Outcome<T> = { ok: true; value: T } | { ok: false; error: string };

// For actions: runs one backend call. A visitor who must sign in is sent to the login page and
// back to `returnTo`; any other refusal comes back as the backend's message for the form.
export async function attempt<T>(
  returnTo: string,
  run: () => Promise<T>,
): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    if (error instanceof SermoError && error.code === "unauthenticated") {
      redirect(`/login?next=${encodeURIComponent(returnTo)}`);
    }
    return { ok: false, error: await errorMessage(error) };
  }
}

// For an action whose client has already changed the screen (a reaction, a bookmark, a follow):
// like `attempt`, but a visitor who must sign in is not redirected, which would leave the change
// standing on the screen. The answer says where to sign in (`signIn`) and the client puts the
// change back and goes there.
export async function attemptInPlace<T>(
  returnTo: string,
  run: () => Promise<T>,
): Promise<
  { ok: true; value: T } | { ok: false; error: string; signIn?: string }
> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    const message = await errorMessage(error);
    if (error instanceof SermoError && error.code === "unauthenticated") {
      return {
        ok: false,
        error: message,
        signIn: `/login?next=${encodeURIComponent(returnTo)}`,
      };
    }
    return { ok: false, error: message };
  }
}

// For actions: what a client that forged an argument is told. It is not worth an explanation.
export async function invalidArgument(): Promise<string> {
  return (await getTranslations("lib.errors"))("generic");
}
