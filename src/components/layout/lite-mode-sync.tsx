"use client";

import { useEffect } from "react";
import {
  LITE_COOKIE,
  parseLiteCookie,
  parseLiteCookieHeader,
  serializeLiteCookie,
} from "@/lib/lite-preferences";
import { commitLiteValue, liteReloadKey } from "@/lib/lite-sync";

const attempted = new Set<string>();
const reloadStorageKey = `${LITE_COOKIE}:reloads`;

export function LiteModeSync({ cookieValue }: { cookieValue: string }) {
  useEffect(() => {
    const rendered = serializeLiteCookie(parseLiteCookie(cookieValue));
    const channel =
      typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel(LITE_COOKIE);
    try {
      const saved: unknown = JSON.parse(
        sessionStorage.getItem(reloadStorageKey) ?? "[]",
      );
      if (Array.isArray(saved))
        for (const key of saved)
          if (typeof key === "string") attempted.add(key);
    } catch {
      // Storage may be disabled; repeated events are still guarded in memory.
    }
    function check() {
      const cookie = document.cookie;
      const current = serializeLiteCookie(parseLiteCookieHeader(cookie));
      if (current === rendered) {
        commitLiteValue(rendered);
        // Convergence ends this reload cycle; later preference changes can sync again.
        attempted.clear();
        try {
          sessionStorage.removeItem(reloadStorageKey);
        } catch {}
        return true;
      }
      const key = liteReloadKey(rendered, cookie, attempted);
      if (!key) return false;
      attempted.add(key);
      // Persist the pair across reloads in case a stale response repeats it.
      try {
        sessionStorage.setItem(
          reloadStorageKey,
          JSON.stringify([...attempted]),
        );
      } catch {
        // The in-memory guard still covers repeated events when storage is disabled.
      }
      window.location.reload();
      return false;
    }
    function onVisible() {
      if (document.visibilityState === "visible") check();
    }
    if (channel)
      channel.onmessage = () => {
        check();
      };
    // Only a matching server render announces a committed preference.
    if (check()) channel?.postMessage(rendered);
    window.addEventListener("pageshow", check);
    window.addEventListener("popstate", check);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("pageshow", check);
      window.removeEventListener("popstate", check);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", onVisible);
      channel?.close();
    };
  }, [cookieValue]);
  return null;
}
