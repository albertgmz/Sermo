import { afterEach, expect, test } from "bun:test";
import type { Ctx } from "@sermo/core";
import { closeContext } from "@sermo/core";
import { createTestContext } from "@sermo/core/testing";
import { buildOpenApiDocument } from "./openapi";

const contexts: Ctx[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

type Security = Record<string, unknown>[];
async function documentedSecurity(): Promise<Map<string, Security>> {
  const ctx = createTestContext();
  contexts.push(ctx);
  const document = (await buildOpenApiDocument(ctx)) as {
    paths: Record<string, Record<string, { operationId: string; security?: Security }>>;
  };
  const byId = new Map<string, Security>();
  for (const [path, methods] of Object.entries(document.paths))
    if (path.startsWith("/api/v1/"))
      for (const endpoint of Object.values(methods))
        byId.set(endpoint.operationId, endpoint.security ?? []);
  return byId;
}

test("guest-capable operations list anonymous access as an alternative", async () => {
  const security = await documentedSecurity();
  for (const id of ["nodes.list", "threads.list", "push.publicKey", "notifications.unsubscribe"]) {
    const entry = security.get(id);
    expect(entry, id).toBeDefined();
    expect(entry).toContainEqual({});
    expect(entry!.length).toBeGreaterThan(1);
  }
});

test("operations that need an account do not list anonymous access", async () => {
  const security = await documentedSecurity();
  for (const id of ["threads.create", "files.upload", "settings.update"]) {
    const entry = security.get(id);
    expect(entry, id).toBeDefined();
    expect(entry).not.toContainEqual({});
    expect(entry!.length).toBeGreaterThan(0);
  }
});
