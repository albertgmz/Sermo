"use client";

import "swagger-ui-dist/swagger-ui.css";
import "./reference.css";
import { useEffect, useRef, useState } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { forBrowser, SPEC_PATH, withJsonType } from "./prepare-spec";

type Labels = {
  region: string;
  loading: string;
  failed: string;
  retry: string;
};

// Swagger UI draws a dark look of its own under `html.dark-mode`. The site's theme is the `dark`
// class on the same element, so the one follows the other for as long as the reference is on the
// page.
function useSiteTheme() {
  useEffect(() => {
    const root = document.documentElement;
    const follow = () => {
      const dark = root.classList.contains("dark");
      if (root.classList.contains("dark-mode") !== dark) {
        root.classList.toggle("dark-mode", dark);
      }
    };
    follow();
    const observer = new MutationObserver(follow);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => {
      observer.disconnect();
      root.classList.remove("dark-mode");
    };
  }, []);
}

// One try at drawing the reference: the library and the specification are fetched together, and
// the library draws into the empty `host` element, which React leaves alone.
function Reference({ labels, retry }: { labels: Labels; retry: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const controller = new AbortController();
    const { signal } = controller;
    (async () => {
      const [{ default: SwaggerUI }, response] = await Promise.all([
        import("swagger-ui-dist/swagger-ui-es-bundle.js"),
        // The specification is the same for everyone, so it is read without the visitor's cookies
        // (a stale session cookie would be refused).
        fetch(SPEC_PATH, { signal, credentials: "omit" }),
      ]);
      if (!response.ok) throw new Error(`Specification: ${response.status}`);
      const spec = await response.json();
      if (signal.aborted) return;
      SwaggerUI({
        domNode: node,
        spec: forBrowser(spec, window.location.origin),
        presets: [SwaggerUI.presets.apis],
        // The address is the page's own: no fragment is added to it.
        deepLinking: false,
        docExpansion: "none",
        filter: true,
        // The library's default asks swagger.io to validate the document.
        validatorUrl: null,
        persistAuthorization: false,
        // Not the same as "no cookies": a request to this site always carries the visitor's own
        // session cookie. This only concerns requests to other origins, and there are none.
        withCredentials: false,
        requestInterceptor: withJsonType,
      });
      setState("ready");
    })().catch(() => {
      if (!signal.aborted) setState("failed");
    });
    return () => {
      controller.abort();
    };
  }, []);

  return (
    <>
      {state === "loading" && (
        <LoadingRegion label={labels.loading}>
          <div aria-hidden="true" className="space-y-3 p-4">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-full max-w-md" />
            {[1, 2, 3, 4, 5].map((row) => (
              <Skeleton key={row} className="h-10 w-full" />
            ))}
          </div>
        </LoadingRegion>
      )}
      {state === "failed" && (
        <div role="alert" className="flex flex-wrap items-center gap-3 p-4">
          <p>{labels.failed}</p>
          <Button variant="outline" className="h-10 md:h-8" onClick={retry}>
            {labels.retry}
          </Button>
        </div>
      )}
      <div ref={host} />
    </>
  );
}

// The interactive reference of the API. Swagger UI is a large script, so it is asked for here,
// after the page is drawn, and no other page loads it. It is bundled with the site (no script,
// style or font comes from another address) and asks no one but this site: the specification is
// read from the site, and "Try it out" goes to the site with the visitor's own session. Nothing is
// stored; an API key pasted into Authorize stays in the library's memory until the page is left.
export function ApiReference({ labels }: { labels: Labels }) {
  const [attempt, setAttempt] = useState(0);
  useSiteTheme();
  return (
    <section
      aria-label={labels.region}
      className="developer-reference min-w-0 rounded-lg border bg-card text-card-foreground"
    >
      <Reference
        key={attempt}
        labels={labels}
        retry={() => setAttempt((count) => count + 1)}
      />
    </section>
  );
}
