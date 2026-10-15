import { isIP } from "node:net";
import { type Ctx, prepared } from "../../context";
import type { TurnstileForm } from "../../contracts/settings";
import { readSiteSettings } from "./index";

/**
 * Cloudflare Turnstile on the guest forms. The secret lives in a row of its own in
 * `site_settings`, never in the configuration JSON, so no read of the settings can carry it.
 */
const SECRET_KEY = "turnstile_secret";
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** Cloudflare's own limit for a token; a longer one is refused without asking. */
const MAX_TOKEN_LENGTH = 2048;
/** The deadline for Cloudflare's answer (connect, TLS and body). */
export const SITEVERIFY_TIMEOUT_MS = 5_000;

export function storedTurnstileSecret(ctx: Ctx): string | null {
  const row = prepared(ctx, "settings.turnstileSecret", () =>
    ctx.sqlite.prepare<{ value: string }, [string]>(
      "SELECT value FROM site_settings WHERE key = ?1",
    ),
  ).get(SECRET_KEY);
  return row?.value ? row.value : null;
}

/** Stores or removes the secret. Call inside the write transaction of the settings update. */
export function storeTurnstileSecret(ctx: Ctx, secret: string | null): void {
  if (secret === null) {
    ctx.sqlite.prepare("DELETE FROM site_settings WHERE key = ?1").run(SECRET_KEY);
    return;
  }
  ctx.sqlite
    .prepare(
      "INSERT INTO site_settings (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .run(SECRET_KEY, secret, ctx.now());
}

/**
 * What the widget needs on a page: the public site key and the forms it guards, or null when
 * Turnstile is off or not fully set up (the guard then refuses nothing, because it is off).
 */
export function publicTurnstile(ctx: Ctx): { siteKey: string; forms: TurnstileForm[] } | null {
  const settings = readSiteSettings(ctx);
  if (!settings.turnstileEnabled || settings.turnstileSiteKey === "") return null;
  if (storedTurnstileSecret(ctx) === null) return null;
  return { siteKey: settings.turnstileSiteKey, forms: settings.turnstileForms };
}

export type TurnstileRefusalCode =
  | "TURNSTILE_REQUIRED"
  | "TURNSTILE_FAILED"
  | "TURNSTILE_UNAVAILABLE";

/** A form refused for the visitor's token (400) or for Cloudflare's absence (503, fails closed). */
export class TurnstileRefusal extends Error {
  constructor(
    readonly code: TurnstileRefusalCode,
    message: string,
    readonly status: 400 | 503,
  ) {
    super(message);
  }
}

/**
 * The host names the site is served on: the public origin, the site's base address and the
 * trusted origins of the configuration. A trusted origin may start its host with `*.`, which
 * stands for any sub-domain (`*.example.com` takes `forum.example.com`, not `example.com`).
 * `www.` is not folded: each host is taken as written. Cloudflare reports the host the widget
 * ran on; when no host is configured at all (tests and embedded use: a server always has its
 * public origin) the check is skipped.
 */
function siteHosts(ctx: Ctx): { hosts: Set<string>; suffixes: string[] } {
  const hosts = new Set<string>();
  const suffixes: string[] = [];
  for (const origin of [
    ctx.config.auth?.baseURL,
    ctx.config.siteBaseURL,
    ...(ctx.config.auth?.trustedOrigins ?? []),
  ]) {
    try {
      if (!origin) continue;
      const host = new URL(origin).hostname.toLowerCase();
      if (host.startsWith("*.")) suffixes.push(host.slice(1));
      else hosts.add(host);
    } catch {
      // An origin that is not an address names no host.
    }
  }
  return { hosts, suffixes };
}

const required = () =>
  new TurnstileRefusal(
    "TURNSTILE_REQUIRED",
    "Complete the security check before sending this form.",
    400,
  );
const failed = () =>
  new TurnstileRefusal(
    "TURNSTILE_FAILED",
    "The security check was not accepted. Reload the page and try it again.",
    400,
  );
const unavailable = () =>
  new TurnstileRefusal(
    "TURNSTILE_UNAVAILABLE",
    "The security check is not available right now, so this form cannot be sent. Try again in a few minutes.",
    503,
  );

/** Whether the setting guards this form. */
function turnstileGuards(ctx: Ctx, form: TurnstileForm): boolean {
  const settings = readSiteSettings(ctx);
  return settings.turnstileEnabled && settings.turnstileForms.includes(form);
}

/**
 * Verifies the visitor's token with Cloudflare when the setting guards `form`; resolves when
 * Turnstile is off for it. Fails closed: a missing or refused token, a Cloudflare error, a
 * timeout, an unreadable answer or a secret Cloudflare rejects all refuse the form. Neither the
 * secret nor the token is logged.
 */
export async function checkTurnstile(
  ctx: Ctx,
  form: TurnstileForm,
  token: string | null | undefined,
  clientIp: string | null | undefined,
): Promise<void> {
  if (!turnstileGuards(ctx, form)) return;
  const secret = storedTurnstileSecret(ctx);
  if (secret === null) throw unavailable();
  if (typeof token !== "string" || token.trim() === "") throw required();
  if (token.length > MAX_TOKEN_LENGTH) throw failed();
  let answer: unknown;
  try {
    const response = await fetch(SITEVERIFY, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret,
        response: token,
        // The adapter writes "unknown" when it has no address: Cloudflare is not sent that.
        ...(clientIp && isIP(clientIp) !== 0 ? { remoteip: clientIp } : {}),
      }),
      redirect: "error",
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
    });
    if (response.status >= 500) throw new Error(`siteverify answered ${response.status}`);
    answer = await response.json();
  } catch (error) {
    console.warn("[turnstile] siteverify could not be reached", {
      reason: error instanceof Error ? error.name : "unknown",
    });
    throw unavailable();
  }
  const result = answer as {
    success?: unknown;
    "error-codes"?: unknown;
    action?: unknown;
    hostname?: unknown;
  } | null;
  if (result?.success === true) {
    // The widget names its form as the action, so a token solved for one form is not accepted on
    // another; and it was solved on one of the site's own hosts.
    if (result.action !== form) throw failed();
    const { hosts, suffixes } = siteHosts(ctx);
    const reported = typeof result.hostname === "string" ? result.hostname.toLowerCase() : null;
    if (
      hosts.size + suffixes.length > 0 &&
      !(
        reported !== null &&
        (hosts.has(reported) || suffixes.some((tail) => reported.endsWith(tail)))
      )
    ) {
      console.warn("[turnstile] a token was solved on a host that is not the site's", {
        hostname: typeof result.hostname === "string" ? result.hostname : null,
        expected: [...hosts, ...suffixes.map((tail) => `*${tail}`)],
      });
      throw failed();
    }
    return;
  }
  const codes = Array.isArray(result?.["error-codes"])
    ? (result["error-codes"] as unknown[]).filter(
        (code): code is string => typeof code === "string",
      )
    : [];
  // These say the site, not the visitor, is at fault: the secret is wrong or Cloudflare erred.
  if (
    codes.some((code) =>
      ["missing-input-secret", "invalid-input-secret", "internal-error"].includes(code),
    ) ||
    result === null ||
    typeof result !== "object"
  ) {
    console.warn("[turnstile] siteverify refused the site's request", { codes });
    throw unavailable();
  }
  throw failed();
}
