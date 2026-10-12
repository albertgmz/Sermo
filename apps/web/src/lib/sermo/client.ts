import "server-only";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type * as z from "zod";
import { SermoError } from "./errors";
import { safeReturnPath } from "./return-path";
import {
  callWith,
  type Described,
  type Forward,
  forwardFromHeaders,
} from "./transport";

export async function forwardFromRequest(): Promise<Forward> {
  return forwardFromHeaders(await headers());
}

export async function call<I extends z.ZodType, O extends z.ZodType>(
  contract: Described<I, O>,
  input: z.input<I>,
): Promise<z.output<O>> {
  return callWith(await forwardFromRequest(), contract, input);
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
    if (error instanceof SermoError) {
      if (error.code === "not_found") notFound();
      if (error.code === "unauthenticated") redirect(await loginPath());
    }
    throw error;
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
