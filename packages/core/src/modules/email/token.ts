import { type Ctx, prepared } from "../../context";
import { ValidationError } from "../../errors";

export interface UnsubscribeClaim {
  userId: number;
  scope: string;
  expiresAt: number;
}

function secret(ctx: Ctx): string {
  const value = ctx.config.auth?.secret;
  if (!value) throw new Error("Email links require an authentication secret.");
  return value;
}

async function key(ctx: Ctx): Promise<CryptoKey> {
  const source = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret(ctx)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const derived = await crypto.subtle.sign(
    "HMAC",
    source,
    new TextEncoder().encode("sermo:unsubscribe:v1"),
  );
  return crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

function currentEmail(ctx: Ctx, userId: number): string | null {
  return (
    prepared(ctx, "email.tokenAddress", () =>
      ctx.sqlite.prepare<{ email: string }, [number]>("SELECT email FROM auth_user WHERE id = ?1"),
    ).get(userId)?.email ?? null
  );
}

/**
 * The member's current address is signed with the payload but never written into the link, so a
 * link stops working when the address changes and does not disclose it. The payload is base64url
 * and cannot contain ".", so the signed text is unambiguous.
 */
function signedText(payload: string, email: string) {
  return new TextEncoder().encode(`${payload}.${email}`);
}

export async function signUnsubscribe(ctx: Ctx, userId: number, scope: string): Promise<string> {
  const email = currentEmail(ctx, userId);
  if (!email) throw new ValidationError("Invalid link.");
  const payload = Buffer.from(
    JSON.stringify({ userId, scope, expiresAt: ctx.now() + 365 * 24 * 60 * 60_000 }),
  ).toString("base64url");
  const signature = await crypto.subtle.sign("HMAC", await key(ctx), signedText(payload, email));
  return `${payload}.${Buffer.from(signature).toString("base64url")}`;
}

export async function verifyUnsubscribe(ctx: Ctx, token: string): Promise<UnsubscribeClaim> {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new ValidationError("Invalid link.");
  const [payload, encodedSignature] = parts as [string, string];
  if (!/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]+$/.test(encodedSignature))
    throw new ValidationError("Invalid link.");
  const signature = Buffer.from(encodedSignature, "base64url");
  if (signature.byteLength !== 32) throw new ValidationError("Invalid link.");
  // The address is part of the signed text, so the member id is read before the signature is
  // checked; nothing else in the payload is trusted until it is.
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new ValidationError("Invalid link.");
  }
  if (
    !value ||
    typeof value !== "object" ||
    !("userId" in value) ||
    !Number.isSafeInteger(value.userId) ||
    Number(value.userId) < 1
  )
    throw new ValidationError("Invalid link.");
  const email = currentEmail(ctx, Number(value.userId));
  if (
    !email ||
    !(await crypto.subtle.verify("HMAC", await key(ctx), signature, signedText(payload, email)))
  )
    throw new ValidationError("Expired or invalid link.");
  if (
    !("scope" in value) ||
    typeof value.scope !== "string" ||
    !value.scope ||
    !("expiresAt" in value) ||
    !Number.isSafeInteger(value.expiresAt) ||
    Number(value.expiresAt) <= ctx.now()
  )
    throw new ValidationError("Expired or invalid link.");
  return { userId: Number(value.userId), scope: value.scope, expiresAt: Number(value.expiresAt) };
}
