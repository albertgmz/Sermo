import { pushSubscribe, pushUnsubscribe } from "@sermo/core/contracts";
import { call } from "@/lib/sermo/client";
import { publicUrl } from "@/lib/sermo/config";
import { SermoError } from "@/lib/sermo/errors";

const NO_STORE = { "cache-control": "no-store" };

const text = (value: unknown) => (typeof value === "string" ? value : null);

// The service worker hands the account a subscription the browser made in place of one it dropped
// (`renewSubscription` in `lib/push-worker.ts`), as the member whose session cookie the request
// carries, and the account forgets the old one. A route, not a server action, because a worker
// cannot call an action. It sits outside the language segment. A request from any other site is
// refused; whether the visitor may save a device is the backend's to say.
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(publicUrl()).origin)
    return new Response(null, { status: 403, headers: NO_STORE });
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const endpoint = text(body?.endpoint);
  const keys = (body?.keys ?? {}) as Record<string, unknown>;
  const p256dh = text(keys.p256dh);
  const auth = text(keys.auth);
  const previous = text(body?.previous);
  if (!endpoint || !p256dh || !auth)
    return new Response(null, { status: 400, headers: NO_STORE });
  try {
    await call(pushSubscribe, {
      endpoint,
      keys: { p256dh, auth },
      userAgent: (request.headers.get("user-agent") ?? "").slice(0, 500),
    });
  } catch (error) {
    if (error instanceof SermoError)
      return Response.json(
        { ok: false },
        { status: error.status, headers: NO_STORE },
      );
    throw error;
  }
  if (previous && previous !== endpoint)
    await call(pushUnsubscribe, { endpoint: previous }).catch(() => {});
  return Response.json({ ok: true }, { headers: NO_STORE });
}
