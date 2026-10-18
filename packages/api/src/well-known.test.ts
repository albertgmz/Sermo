import { expect, test } from "bun:test";
import { execute, getOperation } from "@sermo/core";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { createApp } from "./app";

const SITE = "https://forum.example.test";

function site(siteURL = SITE, at = Date.UTC(2026, 9, 17, 15, 30)) {
  const ctx = createTestContext();
  ctx.clock.set(at);
  ctx.config.siteBaseURL = siteURL;
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const app = createApp(ctx, { trustedProxyHeader: null });
  const contactPage = (isPublished: boolean) =>
    execute(ctx, getOperation("pages.save"), admin, {
      slug: "contact",
      title: "Contact",
      body: "Write to the team.",
      isPublished,
    });
  const superAdmin = (username: string) => {
    const user = insertUser(ctx, { username, groupId: 4 });
    ctx.sqlite.prepare("UPDATE users SET is_super_admin = 1 WHERE id = ?1").run(user.id);
    return user;
  };
  const securityTxt = async () => {
    const response = await app.request("/.well-known/security.txt");
    return {
      status: response.status,
      type: response.headers.get("content-type"),
      body: await response.text(),
    };
  };
  return { ctx, app, contactPage, superAdmin, securityTxt };
}

const file = (contact: string, expires = "2027-10-01T00:00:00.000Z") =>
  [
    `Contact: ${contact}`,
    `Expires: ${expires}`,
    `Canonical: ${SITE}/.well-known/security.txt`,
    "Preferred-Languages: en, es",
    "",
  ].join("\n");

test("security.txt names the published contact page first, in the site's languages", async () => {
  const { contactPage, superAdmin, securityTxt } = site();
  superAdmin("Founder");
  await contactPage(true);
  expect(await securityTxt()).toEqual({
    status: 200,
    type: "text/plain; charset=utf-8",
    body: file(`${SITE}/contact`),
  });
});

test("without a published contact page, security.txt opens a conversation to the first super admin who can receive one", async () => {
  const { ctx, contactPage, superAdmin, securityTxt } = site();
  await contactPage(false);
  const first = superAdmin("Ana María");
  superAdmin("Second");
  expect(await securityTxt()).toEqual({
    status: 200,
    type: "text/plain; charset=utf-8",
    body: file(`${SITE}/conversations/new?to=Ana%20Mar%C3%ADa`),
  });
  // A banned super admin cannot be reached, nor an erased one.
  ctx.sqlite.prepare("UPDATE users SET banned_permanently = 1 WHERE id = ?1").run(first.id);
  expect((await securityTxt()).body).toBe(file(`${SITE}/conversations/new?to=Second`));
  ctx.sqlite.prepare("UPDATE users SET erased_at = ?1 WHERE username = 'Second'").run(ctx.now());
  const none = await securityTxt();
  expect(none.status).toBe(404);
  expect(none.type).toMatch(/^text\/plain/);
});

test("with no contact page and no super admin there is no security.txt", async () => {
  const { contactPage, securityTxt } = site();
  expect((await securityTxt()).status).toBe(404);
  await contactPage(false);
  expect((await securityTxt()).status).toBe(404);
  await contactPage(true);
  expect((await securityTxt()).status).toBe(200);
});

test("security.txt is published only on an https address, or a loopback one for local checks", async () => {
  const plain = site("http://forum.example.test");
  await plain.contactPage(true);
  expect((await plain.securityTxt()).status).toBe(404);
  for (const local of ["http://localhost:3000", "http://127.0.0.1:4200", "http://[::1]:4200"]) {
    const loopback = site(local);
    await loopback.contactPage(true);
    const { status, body } = await loopback.securityTxt();
    expect({ local, status }).toEqual({ local, status: 200 });
    expect(body).toContain(`Contact: ${local}/contact\n`);
  }
});

test("Expires stays the same all month, between 11 and 12 months ahead", async () => {
  for (const [at, expires] of [
    [Date.UTC(2026, 9, 1), "2027-10-01T00:00:00.000Z"],
    [Date.UTC(2026, 9, 31, 23, 59), "2027-10-01T00:00:00.000Z"],
    [Date.UTC(2026, 10, 1), "2027-11-01T00:00:00.000Z"],
    [Date.UTC(2028, 1, 29, 12), "2029-02-01T00:00:00.000Z"],
  ] as const) {
    const { contactPage, securityTxt } = site(SITE, at);
    await contactPage(true);
    expect((await securityTxt()).body).toBe(file(`${SITE}/contact`, expires));
  }
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
      anchor: `${SITE}/api/v1`,
      "service-desc": [{ href: `${SITE}/api/v1/openapi.json`, type: "application/json" }],
      "service-doc": [{ href: `${SITE}/developer`, type: "text/html" }],
      status: [{ href: `${SITE}/health`, type: "application/json" }],
    },
    { anchor: `${SITE}/mcp`, status: [{ href: `${SITE}/health`, type: "application/json" }] },
  ]);
  // Every link the catalog holds answers a GET with the type it declares. The backend serves all
  // but the developer page, a page of the web app (its PAGE_ROUTES).
  const links = linkset.flatMap((entry: Record<string, unknown>) =>
    Object.entries(entry).flatMap(([relation, value]) =>
      relation === "anchor" ? [] : (value as { href: string; type: string }[]),
    ),
  );
  for (const { href, type } of links) {
    if (href === `${SITE}/developer`) continue;
    const response = await app.request(new URL(href).pathname);
    expect({ href, status: response.status }).toEqual({ href, status: 200 });
    expect(response.headers.get("content-type")?.split(";")[0]).toBe(type);
  }
});

test("another /.well-known path is not found", async () => {
  const { app } = site();
  for (const path of ["/.well-known/nothing", "/.well-known/security.txt/x", "/.well-known/"])
    expect({ path, status: (await app.request(path)).status }).toEqual({ path, status: 404 });
});
