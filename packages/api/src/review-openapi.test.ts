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

test("a DELETE describes its path parameters as parameters and its other fields as a JSON body", async () => {
  const ctx = createTestContext();
  contexts.push(ctx);
  const document = (await buildOpenApiDocument(ctx)) as {
    paths: Record<
      string,
      Record<
        string,
        {
          parameters: { name: string; in: string }[];
          requestBody?: {
            required: boolean;
            content: { "application/json": { schema: { properties: Record<string, unknown> } } };
          };
        }
      >
    >;
  };
  const group = document.paths["/api/v1/groups/{groupId}"]!.delete!;
  expect(group.parameters).toEqual([expect.objectContaining({ name: "groupId", in: "path" })]);
  expect(group.requestBody?.required).toBe(false);
  expect(Object.keys(group.requestBody!.content["application/json"].schema.properties)).toContain(
    "actorPassword",
  );
  // Nothing besides the path to send: no body is described.
  expect(document.paths["/api/v1/award-grants/{memberAwardId}"]!.delete!.requestBody).toBeDefined();
  expect(document.paths["/api/v1/nodes/{nodeId}/watch"]!.delete!.requestBody).toBeUndefined();
});
