import { expect, test } from "bun:test";
import { EMBED_HOSTS } from "@/lib/consent/embeds";
import {
  contentSecurityPolicy,
  newNonce,
  type PageSecurity,
  securityHeaders,
} from "./security-headers";

const SITE: PageSecurity = {
  nonce: "bm9uY2U=",
  https: true,
  publicUrl: "https://forum.example.com",
  analytics: { provider: "none" },
  development: false,
};

// The policy as a map from directive to its sources.
function directives(security: PageSecurity) {
  return new Map(
    contentSecurityPolicy(security)
      .split("; ")
      .map((directive) => {
        const [name, ...sources] = directive.split(" ");
        return [name, sources] as const;
      }),
  );
}

const header = (security: PageSecurity, name: string) =>
  new Map(securityHeaders(security)).get(name);

test("scripts run only with the response's nonce, and what they load is trusted through it", () => {
  expect(directives(SITE).get("script-src")).toEqual([
    "'self'",
    "'nonce-bm9uY2U='",
    "'strict-dynamic'",
  ]);
  // `next dev` needs eval; a production build never gets it.
  expect(
    directives({ ...SITE, development: true }).get("script-src"),
  ).toContain("'unsafe-eval'");
  expect(contentSecurityPolicy(SITE)).not.toContain("unsafe-eval");
});

test("the page refuses plugins, a foreign base address, foreign forms and being framed", () => {
  const policy = directives(SITE);
  expect(policy.get("default-src")).toEqual(["'self'"]);
  expect(policy.get("object-src")).toEqual(["'none'"]);
  expect(policy.get("base-uri")).toEqual(["'self'"]);
  expect(policy.get("form-action")).toEqual(["'self'"]);
  expect(policy.get("frame-ancestors")).toEqual(["'none'"]);
  expect(header(SITE, "X-Frame-Options")).toBe("DENY");
});

test("styles may be inline, and the nonce is never in their list (it would turn that off)", () => {
  expect(directives(SITE).get("style-src")).toEqual([
    "'self'",
    "'unsafe-inline'",
  ]);
});

test("frames are the embedded players and the Turnstile challenge, nothing else", () => {
  expect(directives(SITE).get("frame-src")).toEqual([
    ...EMBED_HOSTS.map((host) => `https://${host}`),
    "https://challenges.cloudflare.com",
  ]);
  expect(directives(SITE).get("frame-src")).toContain(
    "https://www.youtube-nocookie.com",
  );
});

test("pictures may come from any https address or be data; fonts, the worker, the manifest and the rest from the site", () => {
  const policy = directives(SITE);
  expect(policy.get("img-src")).toEqual(["'self'", "data:", "https:"]);
  expect(policy.get("media-src")).toEqual(["'self'", "https:"]);
  expect(policy.get("font-src")).toEqual(["'self'"]);
  expect(policy.get("worker-src")).toEqual(["'self'"]);
  expect(policy.get("manifest-src")).toEqual(["'self'"]);
  expect(policy.get("connect-src")).toEqual(["'self'"]);
});

test("the analytics provider's address may be sent to", () => {
  expect(
    directives({
      ...SITE,
      analytics: { provider: "google", measurementId: "G-ABC123" },
    }).get("connect-src"),
  ).toEqual([
    "'self'",
    "https://*.google-analytics.com",
    "https://*.analytics.google.com",
    "https://*.googletagmanager.com",
  ]);
});

test("through the Google tag gateway the tag and its measurements stay on the site's own address", () => {
  const policy = directives({
    ...SITE,
    analytics: {
      provider: "google",
      measurementId: "G-ABC123",
      tagPath: "/metrics",
    },
  });
  expect(policy.get("connect-src")).toEqual(["'self'"]);
  expect(policy.get("script-src")).not.toContain(
    "https://*.googletagmanager.com",
  );
  expect(directives(SITE).get("connect-src")).toEqual(["'self'"]);
});

test("insecure requests are upgraded only when the site's address is https", () => {
  expect(directives(SITE).has("upgrade-insecure-requests")).toBe(true);
  const http = directives({
    ...SITE,
    https: false,
    publicUrl: "http://localhost:3000",
  });
  expect(http.has("upgrade-insecure-requests")).toBe(false);
  // Without the upgrade, a picture linked over http still shows.
  expect(http.get("img-src")).toContain("http:");
});

test("HSTS is sent over https or for an https site, never for a plain http one", () => {
  const hsts = "max-age=63072000; includeSubDomains";
  expect(header(SITE, "Strict-Transport-Security")).toBe(hsts);
  // Reached over http behind the tunnel, but the site's address is https.
  expect(header({ ...SITE, https: false }, "Strict-Transport-Security")).toBe(
    hsts,
  );
  expect(
    header(
      { ...SITE, publicUrl: "http://localhost:3000" },
      "Strict-Transport-Security",
    ),
  ).toBe(hsts);
  expect(
    header(
      { ...SITE, https: false, publicUrl: "http://localhost:3000" },
      "Strict-Transport-Security",
    ),
  ).toBeUndefined();
});

test("the other headers: nosniff, referrer, opener and the features the site does not use", () => {
  expect(header(SITE, "X-Content-Type-Options")).toBe("nosniff");
  expect(header(SITE, "Referrer-Policy")).toBe(
    "strict-origin-when-cross-origin",
  );
  expect(header(SITE, "Cross-Origin-Opener-Policy")).toBe("same-origin");
  const features = header(SITE, "Permissions-Policy") ?? "";
  for (const feature of ["camera", "microphone", "geolocation", "payment"])
    expect(features).toContain(`${feature}=()`);
  // The embedded players are given these by their own `allow` attribute; a list here would have
  // to name every player's address.
  for (const feature of ["fullscreen", "picture-in-picture", "encrypted-media"])
    expect(features).not.toContain(feature);
});

test("each response gets a nonce of its own, 128 random bits", () => {
  const nonces = new Set(Array.from({ length: 50 }, newNonce));
  expect(nonces.size).toBe(50);
  for (const nonce of nonces) {
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(directives({ ...SITE, nonce }).get("script-src")).toContain(
      `'nonce-${nonce}'`,
    );
  }
});
