import { expect, test } from "bun:test";
import { execute, getOperation } from "@sermo/core";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { createApp } from "./app";

const SITE = "https://forum.example.test";

function site(at = Date.UTC(2026, 9, 17, 15, 30)) {
  const ctx = createTestContext();
  ctx.clock.set(at);
  ctx.config.siteBaseURL = SITE;
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const app = createApp(ctx, { trustedProxyHeader: null });
  const contactPage = (isPublished: boolean) =>
    execute(ctx, getOperation("pages.save"), admin, {
      slug: "contact",
      title: "Contact",
      body: "Write to the team.",
      isPublished,
    });
  return { app, contactPage };
}

test("security.txt names the published contact page, a year ahead, in the site's languages", async () => {
  const { app, contactPage } = site();
  await contactPage(true);
  const response = await app.request("/.well-known/security.txt");
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  expect(await response.text()).toBe(
    [
      `Contact: ${SITE}/contact`,
      "Expires: 2027-10-17T00:00:00.000Z",
      `Canonical: ${SITE}/.well-known/security.txt`,
      "Preferred-Languages: en, es",
      "",
    ].join("\n"),
  );
});

test("without a published contact page there is no security.txt", async () => {
  const { app, contactPage } = site();
  const missing = await app.request("/.well-known/security.txt");
  expect(missing.status).toBe(404);
  expect(missing.headers.get("content-type")).toMatch(/^text\/plain/);
  await contactPage(false);
  expect((await app.request("/.well-known/security.txt")).status).toBe(404);
  await contactPage(true);
  expect((await app.request("/.well-known/security.txt")).status).toBe(200);
});

test("the API catalog is an RFC 9727 linkset of the REST API and the MCP endpoint", async () => {
  const { app } = site();
  for (const method of ["GET", "HEAD"]) {
    const response = await app.request("/.well-known/api-catalog", { method });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
    );
    expect(response.headers.get("link")).toBe('</.well-known/api-catalog>; rel="api-catalog"');
  }
  const { linkset } = await (await app.request("/.well-known/api-catalog")).json();
  expect(linkset).toEqual([
    {
      anchor: `${SITE}/.well-known/api-catalog`,
      item: [{ href: `${SITE}/api/v1` }, { href: `${SITE}/mcp` }],
    },
    {
      anchor: `${SITE}/api/v1`,
      "service-desc": [
        { href: `${SITE}/api/v1/openapi.json`, type: "application/vnd.oai.openapi+json" },
      ],
      "service-doc": [{ href: `${SITE}/developer`, type: "text/html" }],
      status: [{ href: `${SITE}/health`, type: "application/json" }],
    },
    { anchor: `${SITE}/mcp`, status: [{ href: `${SITE}/health`, type: "application/json" }] },
  ]);
  // Each link the backend itself serves answers.
  expect((await app.request("/api/v1/openapi.json")).status).toBe(200);
  expect((await app.request("/health")).status).toBe(200);
});

test("another /.well-known path is not found", async () => {
  const { app } = site();
  for (const path of ["/.well-known/nothing", "/.well-known/security.txt/x", "/.well-known/"])
    expect({ path, status: (await app.request(path)).status }).toEqual({ path, status: 404 });
});
