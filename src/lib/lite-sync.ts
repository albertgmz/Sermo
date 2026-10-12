import {
  parseLiteCookie,
  parseLiteCookieHeader,
  serializeLiteCookie,
} from "./lite-preferences";

export function liteReloadKey(
  rendered: string,
  cookieHeader: string,
  attempted: ReadonlySet<string>,
): string | null {
  const server = serializeLiteCookie(parseLiteCookie(rendered));
  const current = serializeLiteCookie(parseLiteCookieHeader(cookieHeader));
  const key = JSON.stringify([server, current]);
  return server === current || attempted.has(key) ? null : key;
}

let committed = "";
const listeners = new Set<() => void>();

export function getCommittedLiteValue() {
  return committed;
}

export function subscribeLiteValue(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function commitLiteValue(value: string) {
  const next = serializeLiteCookie(parseLiteCookie(value));
  if (next === committed) return;
  committed = next;
  for (const listener of listeners) listener();
}
