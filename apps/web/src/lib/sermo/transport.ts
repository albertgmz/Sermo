import type * as z from "zod";
import { LOCALE_COOKIE, localeCookieValue } from "@/i18n/locale-cookie";
import { apiUrl, publicUrl } from "./config";
import { SermoError } from "./errors";
import { buildRequest } from "./request";

// The proxy's visitor location headers (Cloudflare's "Add visitor location headers"). They are
// passed on as they came; the backend trusts them only when it was told a proxy sets them.
export const LOCATION_HEADERS = [
  "cf-ipcountry",
  "cf-region",
  "cf-ipcity",
] as const;

// The header the backend reads the Turnstile token of a guest form from (the same name as
// `TURNSTILE_HEADER` in the backend's auth module).
export const TURNSTILE_HEADER = "x-sermo-turnstile";

// The header that names the page being rendered, for who is online (the same name as
// `PLACE_HEADER` in the backend's members module). Only a page view sends it.
export const PLACE_HEADER = "x-sermo-place";

export type Forward = {
  // The token the visitor's Turnstile widget produced, for the one sign-in or account mail
  // request that needs it.
  turnstile?: string;
  cookie?: string;
  userAgent?: string;
  clientIp?: string;
  // The language the visitor chose: their `forum_locale` cookie (the value only). The backend
  // keeps the language an account signed up in, for its mails.
  locale?: string;
  location?: Partial<Record<(typeof LOCATION_HEADERS)[number], string>>;
  // The page a page view renders (`placeOfPath`); absent for anything else.
  place?: string;
};

export type Described<I extends z.ZodType, O extends z.ZodType> = {
  readonly name: string;
  readonly input: I;
  readonly output: O;
};

// The client IP is the last entry of the forwarded chain: the one our own proxy appended.
export function lastForwardedFor(value: string | null): string | undefined {
  return value?.split(",").at(-1)?.trim() || undefined;
}

// A language code as the cookie holds it (`es`, `en-GB`), or undefined for anything else.
const languageCode = (value: string | undefined) =>
  value && /^[a-zA-Z-]{2,10}$/.test(value) ? value : undefined;

export function forwardFromHeaders(headers: Headers): Forward {
  return {
    cookie: headers.get("cookie") ?? undefined,
    userAgent: headers.get("user-agent") ?? undefined,
    clientIp: lastForwardedFor(headers.get("x-forwarded-for")),
    locale: languageCode(localeCookieValue(headers.get("cookie") ?? "")),
    location: Object.fromEntries(
      LOCATION_HEADERS.flatMap((name) => {
        const value = headers.get(name);
        return value ? [[name, value]] : [];
      }),
    ),
  };
}

const SERMO_COOKIE = /^(__Secure-)?sermo\./;

export function sermoCookies(cookie: string | undefined): string {
  return (cookie ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => SERMO_COOKIE.test(part))
    .join("; ");
}

// Headers that identify the visitor to the backend; shared by the operation and sign-in calls.
export function forwardHeaders(forward: Forward, hasBody: boolean): Headers {
  const headers = new Headers({ origin: new URL(publicUrl()).origin });
  const cookie = [
    sermoCookies(forward.cookie),
    forward.locale ? `${LOCALE_COOKIE}=${forward.locale}` : "",
  ]
    .filter(Boolean)
    .join("; ");
  if (cookie) headers.set("cookie", cookie);
  if (hasBody) headers.set("content-type", "application/json");
  if (forward.turnstile) headers.set(TURNSTILE_HEADER, forward.turnstile);
  if (forward.userAgent) headers.set("user-agent", forward.userAgent);
  if (forward.clientIp) headers.set("x-forwarded-for", forward.clientIp);
  if (forward.place) headers.set(PLACE_HEADER, forward.place);
  for (const name of LOCATION_HEADERS) {
    const value = forward.location?.[name];
    if (value) headers.set(name, value);
  }
  return headers;
}

export async function send(
  method: string,
  pathAndQuery: string,
  forward: Forward,
  body?: string,
): Promise<Response> {
  try {
    return await fetch(`${apiUrl()}${pathAndQuery}`, {
      method,
      // The backend takes a write from a signed-in visitor only as JSON, body or not.
      headers: forwardHeaders(
        forward,
        body !== undefined || method === "DELETE",
      ),
      body,
      cache: "no-store",
      redirect: "manual",
    });
  } catch (error) {
    // Only a failed connection is the API being unreachable (fetch reports it as a TypeError).
    // Anything else is not ours to rename: while a page shell is prerendered, Next rejects a
    // pending fetch on purpose and has to see its own error to leave that part for the request.
    if (!(error instanceof TypeError)) throw error;
    throw new SermoError(
      "internal",
      500,
      `The API could not be reached: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new SermoError(
      "internal",
      response.status,
      "The API answered with something that is not JSON.",
    );
  }
}

export async function callWith<I extends z.ZodType, O extends z.ZodType>(
  forward: Forward,
  contract: Described<I, O>,
  input: z.input<I>,
): Promise<z.output<O>> {
  const built = buildRequest(contract.name, input);
  const response = await send(
    built.method,
    `/api/v1${built.path}${built.query}`,
    forward,
    built.body,
  );
  const payload = await readJson(response);
  if (!response.ok) {
    const error = (payload as { error?: Record<string, unknown> } | null)
      ?.error;
    throw new SermoError(
      typeof error?.code === "string" ? error.code : "internal",
      response.status,
      typeof error?.message === "string"
        ? error.message
        : `The API answered ${response.status}.`,
      Array.isArray(error?.issues) ? error.issues : undefined,
    );
  }
  const parsed = contract.output.safeParse(payload);
  if (!parsed.success) {
    console.error(
      `Output of ${contract.name} broke its contract`,
      parsed.error.issues,
    );
    throw new SermoError(
      "internal",
      500,
      `The answer of ${contract.name} does not match its contract.`,
    );
  }
  return parsed.data;
}

// Whether the request carries a session cookie, which says nothing about whether the backend
// still accepts it: it is the cheapest thing to ask before a body is read.
export function hasSessionCookie(cookie: string | undefined): boolean {
  return /(?:^|;\s*)(?:__Secure-)?sermo\.session_token=/.test(cookie ?? "");
}
