import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Ctx } from "@sermo/core";
import { closeContext } from "@sermo/core";
import { createTestContext } from "@sermo/core/testing";
import { coerceQueryValues } from "./app";
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

test("the rule editors' list is documented next to the two older criteria reads, which stay", async () => {
  const security = await documentedSecurity();
  for (const id of ["criteria.list", "promotions.criteria", "awards.criteria"])
    expect(security.has(id), id).toBe(true);
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

type Param = {
  name: string;
  in: string;
  style?: string;
  explode?: boolean;
  schema: { type?: string };
};
type Response = { content?: Record<string, { schema?: { type?: string; format?: string } }> };
type Endpoint = { operationId: string; parameters?: Param[]; responses: Record<string, Response> };
type Document = {
  info: { version: string };
  servers?: { url: string }[];
  paths: Record<string, Record<string, Endpoint>>;
};

async function document(): Promise<Document> {
  const ctx = createTestContext();
  contexts.push(ctx);
  return (await buildOpenApiDocument(ctx)) as Document;
}

function endpoints(doc: Document): Map<string, Endpoint> {
  const byId = new Map<string, Endpoint>();
  for (const methods of Object.values(doc.paths))
    for (const endpoint of Object.values(methods)) byId.set(endpoint.operationId, endpoint);
  return byId;
}

test("info.version is the version in the root VERSION file", async () => {
  const version = readFileSync(new URL("../../../VERSION", import.meta.url), "utf8").trim();
  expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  expect((await document()).info.version).toBe(version);
});

test("the document names a server, relative to where it was fetched", async () => {
  expect((await document()).servers).toEqual([{ url: "/" }]);
});

test("array query parameters are repeated names, as the route parser reads them", async () => {
  const arrays: string[] = [];
  for (const [path, methods] of Object.entries((await document()).paths))
    for (const [method, endpoint] of Object.entries(methods))
      for (const param of endpoint.parameters ?? [])
        if (param.in === "query" && param.schema.type === "array") {
          arrays.push(`${method} ${path} ${param.name}`);
          expect(param.style, `${method} ${path} ${param.name}`).toBe("form");
          expect(param.explode, `${method} ${path} ${param.name}`).toBe(true);
        }
  expect(arrays.length).toBeGreaterThan(0);
  expect(coerceQueryValues(["1", "2"], { type: "array", items: { type: "integer" } })).toEqual([
    1, 2,
  ]);
});

test("the file and SEO answers have response schemas", async () => {
  const byId = endpoints(await document());
  const download = byId.get("files.download")!.responses["200"]!.content!;
  expect(download["application/octet-stream"]!.schema).toEqual({
    type: "string",
    format: "binary",
  });
  expect(byId.get("files.upload")!.responses["201"]!.content!["application/json"]!.schema).toEqual(
    expect.objectContaining({ type: "object" }),
  );
  const seoMime = {
    "seo.robots": "text/plain",
    "seo.llms": "text/plain",
    "seo.sitemapIndex": "application/xml",
    "seo.sitemapShard": "application/xml",
    "seo.siteFeed": "application/atom+xml",
    "seo.nodeFeed": "application/atom+xml",
    "seo.indexNowKey": "text/plain",
  };
  for (const [id, mime] of Object.entries(seoMime))
    expect(byId.get(id)!.responses["200"]!.content![mime]!.schema, id).toEqual({ type: "string" });
  for (const id of ["seo.node", "seo.thread", "seo.profile", "seo.search"])
    expect(byId.get(id)!.responses["200"]!.content!["application/json"]!.schema, id).toBeDefined();
});

test("every response that has content describes it with a schema", async () => {
  for (const [path, methods] of Object.entries((await document()).paths))
    for (const endpoint of Object.values(methods))
      for (const [status, response] of Object.entries(endpoint.responses))
        for (const [mime, media] of Object.entries(response.content ?? {}))
          expect(media.schema, `${endpoint.operationId} ${status} ${mime} ${path}`).toBeDefined();
});

test("the document is OpenAPI 3.1: no 3.0 `nullable`, and enum-keyed records declare their keys", async () => {
  const doc = await document();
  expect(JSON.stringify(doc)).not.toContain('"nullable"');
  const settings = (
    doc as unknown as {
      components: {
        schemas: { SiteSettings: { properties: { allowedUploadTypes: Record<string, unknown> } } };
      };
    }
  ).components.schemas.SiteSettings.properties.allowedUploadTypes;
  expect(Object.keys(settings.properties as object)).toEqual(settings.required as string[]);
});

test("making an API key from a session documents the password and the replace flag the hooks read", async () => {
  const doc = (await document()) as unknown as {
    paths: Record<
      string,
      Record<
        string,
        {
          requestBody: {
            content: {
              "application/json": {
                schema: { required: string[]; properties: Record<string, { type: string }> };
              };
            };
          };
        }
      >
    >;
  };
  const schema =
    doc.paths["/api/auth/api-key/create"]!.post!.requestBody.content["application/json"].schema;
  expect(schema.required).toContain("password");
  expect(schema.properties.password?.type).toBe("string");
  expect(schema.properties.replace?.type).toBe("boolean");
  // Better Auth's own fields stay.
  expect(schema.properties.name?.type).toBe("string");
});
