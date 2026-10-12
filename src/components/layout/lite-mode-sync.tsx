"use client";

import { useEffect } from "react";
import { LITE_COOKIE } from "@/lib/lite-preferences";

export function LiteModeSync({ cookieValue }: { cookieValue: string }) {
  useEffect(() => {
    function check() {
      const current =
        document.cookie
          .split(";")
          .map((cookie) => cookie.trim())
          .find((cookie) => cookie.startsWith(`${LITE_COOKIE}=`))
          ?.slice(LITE_COOKIE.length + 1) ?? "";
      if (current !== cookieValue) window.location.reload();
    }
    function onVisible() {
      if (document.visibilityState === "visible") check();
    }
    check();
    window.addEventListener("pageshow", check);
    window.addEventListener("popstate", check);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("pageshow", check);
      window.removeEventListener("popstate", check);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [cookieValue]);
  return null;
}
