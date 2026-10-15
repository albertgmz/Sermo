import type { Ctx } from "../../context";
import { ValidationError } from "../../errors";

/** How long the "This wasn't me" link in a new-sign-in mail works. */
export const NOT_ME_TTL_MS = 7 * 24 * 60 * 60_000;

export interface NotMeClaim {
  userId: number;
  /** When the sign-in the mail is about happened; the link dies once the member's sessions were cut after it. */
  issuedAt: number;
  expiresAt: number;
}

async function key(ctx: Ctx): Promise<CryptoKey> {
  const secret = ctx.config.auth?.secret;
  if (!secret) throw new Error("Security links require an authentication secret.");
  const source = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  // A key of its own for this purpose: a signature made for another link never verifies here.
  const derived = await crypto.subtle.sign(
    "HMAC",
    source,
    new TextEncoder().encode("sermo:not-me:v1"),
  );
  return crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

/**
 * A signed, expiring token for the link in the new-sign-in mail. It carries no state of its own:
 * it works once, because using it cuts the member's sessions and a token issued before that is
 * refused afterwards (see `authNotMe`).
 */
export async function signNotMe(ctx: Ctx, userId: number): Promise<string> {
  const issuedAt = ctx.now();
  const payload = Buffer.from(
    JSON.stringify({ userId, issuedAt, expiresAt: issuedAt + NOT_ME_TTL_MS }),
  ).toString("base64url");
  const signature = await crypto.subtle.sign(
    "HMAC",
    await key(ctx),
    new TextEncoder().encode(payload),
  );
  return `${payload}.${Buffer.from(signature).toString("base64url")}`;
}

export async function verifyNotMe(ctx: Ctx, token: string): Promise<NotMeClaim> {
  const invalid = () => new ValidationError("Expired or invalid link.");
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw invalid();
  const [payload, encoded] = parts as [string, string];
  if (!/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw invalid();
  const signature = Buffer.from(encoded, "base64url");
  if (
    signature.byteLength !== 32 ||
    !(await crypto.subtle.verify(
      "HMAC",
      await key(ctx),
      signature,
      new TextEncoder().encode(payload),
    ))
  )
    throw invalid();
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw invalid();
  }
  const claim = value as Partial<Record<keyof NotMeClaim, unknown>> | null;
  if (
    !claim ||
    !Number.isSafeInteger(claim.userId) ||
    Number(claim.userId) < 1 ||
    !Number.isSafeInteger(claim.issuedAt) ||
    !Number.isSafeInteger(claim.expiresAt) ||
    Number(claim.expiresAt) <= ctx.now()
  )
    throw invalid();
  return {
    userId: Number(claim.userId),
    issuedAt: Number(claim.issuedAt),
    expiresAt: Number(claim.expiresAt),
  };
}
