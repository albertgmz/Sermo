"use client";

import type { TurnstileForm } from "@sermo/core/contracts";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { FormError } from "@/components/forum/form-error";
import { TURNSTILE_FIELD } from "@/lib/turnstile/field";

// Cloudflare's widget for the guest forms. It is rendered only on a form the site guards, and its
// script (from Cloudflare, strictly necessary for security, so not gated behind consent) is
// fetched only then. The token goes in a hidden field of the form; the backend checks it.
type Api = {
  ready(callback: () => void): void;
  render(element: HTMLElement, options: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
};

declare global {
  interface Window {
    turnstile?: Api;
  }
}

const SCRIPT =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<Api> | undefined;

function load(): Promise<Api> {
  loading ??= new Promise<Api>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => {
      const api = window.turnstile;
      if (api) api.ready(() => resolve(api));
      else {
        loading = undefined;
        reject(new Error("Turnstile did not start"));
      }
    };
    script.onerror = () => {
      loading = undefined;
      reject(new Error("Turnstile could not be loaded"));
    };
    document.head.append(script);
  });
  return loading;
}

// `action` names the form: Cloudflare returns it with the verdict and the backend requires it to
// match, so a token solved for one form is not accepted on another.
// `retry` changes whenever an attempt comes back refused: a token is good for one use, so the
// widget asks for a new one.
export function TurnstileField({
  siteKey,
  action,
  retry,
}: {
  siteKey: string;
  action: TurnstileForm;
  retry?: unknown;
}) {
  const t = useTranslations("auth.turnstile");
  const locale = useLocale();
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | undefined>(undefined);
  const [token, setToken] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let gone = false;
    load()
      .then((api) => {
        if (gone || !box.current) return;
        widget.current = api.render(box.current, {
          sitekey: siteKey,
          action,
          language: locale,
          theme:
            document.documentElement.getAttribute("data-theme") === "light"
              ? "light"
              : "dark",
          // The flexible size needs 300px; a 360px phone leaves a little less inside the card.
          size: window.matchMedia("(max-width: 399px)").matches
            ? "compact"
            : "flexible",
          callback: (value: string) => {
            setToken(value);
            setFailed(false);
          },
          "expired-callback": () => setToken(""),
          "error-callback": () => {
            setToken("");
            setFailed(true);
          },
        });
      })
      .catch(() => setFailed(true));
    return () => {
      gone = true;
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = undefined;
    };
  }, [siteKey, action, locale]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `retry` only says an attempt ended
  useEffect(() => {
    setToken("");
    if (widget.current) window.turnstile?.reset(widget.current);
  }, [retry]);

  return (
    <div className="space-y-2">
      <div ref={box} className="min-h-16" />
      <input type="hidden" name={TURNSTILE_FIELD} value={token} />
      {failed && <FormError>{t("unavailable")}</FormError>}
    </div>
  );
}
