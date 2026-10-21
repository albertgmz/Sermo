import { readFileSync } from "node:fs";
import { type Ctx, getAuth, schema } from "@sermo/core";
import * as z from "zod";
import { routeOperations } from "./routes";

// Read at load so a missing file stops the server at boot. The repository root is three levels
// up from here, in a checkout and in the image.
const VERSION = readFileSync(new URL("../../../VERSION", import.meta.url), "utf8").trim();

type JsonObject = Record<string, unknown>;

function relocateRefs(value: unknown, schemas: Record<string, unknown>): unknown {
  if (Array.isArray(value)) return value.map((item) => relocateRefs(item, schemas));
  if (!value || typeof value !== "object") return value;
  const object = value as JsonObject;
  const defs = object.$defs as Record<string, unknown> | undefined;
  if (defs) {
    for (const [name, schema] of Object.entries(defs)) {
      if (!(name in schemas)) schemas[name] = relocateRefs(schema, schemas);
    }
  }
  const result: JsonObject = {};
  for (const [key, item] of Object.entries(object)) {
    if (key === "$defs" || key === "$schema") continue;
    result[key] =
      key === "$ref" && typeof item === "string"
        ? item.replace(/^#\/\$defs\//, "#/components/schemas/")
        : relocateRefs(item, schemas);
  }
  // A record keyed by an enum lists its keys as `required` without declaring them as properties.
  const keys = (object.propertyNames as { enum?: string[] } | undefined)?.enum;
  if (keys && object.additionalProperties && !object.properties) {
    result.properties = Object.fromEntries(keys.map((key) => [key, result.additionalProperties]));
    result.additionalProperties = false;
    delete result.propertyNames;
  }
  return result;
}

/** Better Auth writes OpenAPI 3.0 `nullable`; this document is 3.1, where null is a type. */
function nullableToType(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(nullableToType);
  if (!value || typeof value !== "object") return value;
  const result: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    if (key !== "nullable") result[key] = nullableToType(item);
  }
  if ((value as JsonObject).nullable === true) {
    if (typeof result.type === "string") result.type = [result.type, "null"];
    if (Array.isArray(result.enum)) result.enum = [...result.enum, null];
  }
  return result;
}

function errorResponse(description: string): JsonObject {
  return {
    description,
    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
  };
}

/** Every `$ref` to a component schema reachable from `value`. */
function collectSchemaRefs(value: unknown, found: Set<string>, schemas: Record<string, unknown>) {
  if (Array.isArray(value)) {
    for (const item of value) collectSchemaRefs(item, found, schemas);
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      const name = typeof item === "string" ? /^#\/components\/schemas\/(.+)$/.exec(item)?.[1] : "";
      if (key === "$ref" && name && !found.has(name)) {
        found.add(name);
        collectSchemaRefs(schemas[name], found, schemas);
      } else collectSchemaRefs(item, found, schemas);
    }
  }
}

const credentialSchemes = [
  { sessionCookie: [] },
  { secureSessionCookie: [] },
  { bearerApiKey: [] },
];

/**
 * Operations a guest may call, for the "anonymous" security alternative. A guest's access is
 * decided per call by the permission engine, which the route table cannot see; the contracts do
 * not say it either (an operation marked `public` only skips the permission check, and many of
 * those, such as conversations.list, still need a signed-in actor). So the documented rule is
 * deliberately wide: every read (GET) operation plus every operation marked `public`. The
 * response is still a 401 or an empty result where a guest has no access.
 */
function allowsAnonymous(method: string, op: { public?: string }): boolean {
  return method === "GET" || Boolean(op.public);
}

const errorSchema = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        issues: {
          type: "array",
          items: {
            type: "object",
            required: ["path", "message"],
            properties: {
              path: { type: "array", items: { oneOf: [{ type: "string" }, { type: "number" }] } },
              message: { type: "string" },
            },
          },
        },
      },
    },
  },
};

/**
 * What Sermo's hooks read from the body of `POST /api-key/create` and Better Auth's own document
 * does not list: the member's password (a key is made from a session only with it) and `replace`
 * (ends the member's older key; without it a member who has a key is refused with a 409). Without
 * them "Try it out" can send neither.
 */
function withKeyCreateFields(operation: JsonObject): JsonObject {
  const body = operation.requestBody as JsonObject | undefined;
  const json = (body?.content as JsonObject | undefined)?.["application/json"] as
    | JsonObject
    | undefined;
  const schema = json?.schema as JsonObject | undefined;
  if (!body || !json || !schema) return operation;
  return {
    ...operation,
    requestBody: {
      ...body,
      content: {
        ...(body.content as JsonObject),
        "application/json": {
          ...json,
          schema: {
            ...schema,
            required: [...((schema.required as string[] | undefined) ?? []), "password"],
            properties: {
              password: {
                type: "string",
                description: "Your current password. A key made from a session needs it.",
              },
              replace: {
                type: "boolean",
                description:
                  "true ends your older API key; without it, a member who already has one is refused with 409.",
              },
              ...(schema.properties as JsonObject | undefined),
            },
          },
        },
      },
    },
  };
}

export async function buildOpenApiDocument(ctx: Ctx): Promise<object> {
  const auth = nullableToType(await getAuth(ctx).api.generateOpenAPISchema());
  const authDocument = auth as unknown as {
    paths: Record<string, JsonObject>;
    components?: { schemas?: Record<string, unknown>; securitySchemes?: Record<string, unknown> };
  };
  const schemas: Record<string, unknown> = {
    ...authDocument.components?.schemas,
    Error: errorSchema,
  };
  const paths: Record<string, JsonObject> = {};
  for (const [path, methods] of Object.entries(authDocument.paths)) {
    const prefixed: JsonObject = {};
    for (const [method, endpoint] of Object.entries(methods)) {
      const operation =
        method === "post" && path === "/api-key/create"
          ? withKeyCreateFields(endpoint as JsonObject)
          : (endpoint as JsonObject);
      prefixed[method] = {
        ...operation,
        summary:
          operation.summary ?? operation.description ?? `${method.toUpperCase()} /api/auth${path}`,
        operationId:
          operation.operationId ?? `auth.${method}.${path.replace(/[^a-zA-Z0-9]+/g, ".")}`,
      };
    }
    paths[`/api/auth${path}`] = prefixed;
  }

  for (const { route, op } of routeOperations) {
    const path = `/api/v1${route.path}`;
    const pathFields = [...route.path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]!);
    const input = relocateRefs(z.toJSONSchema(op.input, { io: "input" }), schemas) as JsonObject;
    const properties = (input.properties ?? {}) as Record<string, unknown>;
    const required = (input.required ?? []) as string[];
    const parameters: JsonObject[] = [];
    const bodyProperties: Record<string, unknown> = {};
    const bodyRequired: string[] = [];
    for (const [name, schema] of Object.entries(properties)) {
      if (pathFields.includes(name) || route.method === "GET") {
        const inPath = pathFields.includes(name);
        parameters.push({
          name,
          in: inPath ? "path" : "query",
          required: inPath || required.includes(name),
          // The server collects a repeated name (`?id=1&id=2`) into the array.
          ...(!inPath && (schema as JsonObject).type === "array"
            ? { style: "form", explode: true }
            : {}),
          schema,
        });
      } else {
        bodyProperties[name] = schema;
        if (required.includes(name)) bodyRequired.push(name);
      }
    }
    const output = relocateRefs(z.toJSONSchema(op.output), schemas);
    const response: JsonObject = {
      description: "Success",
      content: { "application/json": { schema: output } },
    };
    const responses: Record<string, unknown> = { [route.status]: response };
    for (const status of [400, 401, 403, 404, 409, 415, 429, 500]) {
      responses[status] = errorResponse("Error");
    }
    const endpoint: JsonObject = {
      summary: op.summary,
      operationId: op.name,
      tags: [op.name.split(".")[0]],
      security: allowsAnonymous(route.method, op) ? [...credentialSchemes, {}] : credentialSchemes,
      parameters,
      responses,
    };
    if (route.method === "DELETE" && Object.keys(bodyProperties).length > 0)
      endpoint.description =
        "Fields other than the path parameters go in the JSON body (use it for a secret); " +
        "query parameters of the same names are accepted for clients that send no body, and the " +
        "body wins when a field is in both.";
    if (
      route.method !== "GET" &&
      (route.method !== "DELETE" || Object.keys(bodyProperties).length)
    ) {
      endpoint.requestBody = {
        // A DELETE may send its fields in the query instead, so its body is never required.
        required: route.method !== "DELETE" && bodyRequired.length > 0,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: bodyProperties,
              ...(bodyRequired.length ? { required: bodyRequired } : {}),
            },
          },
        },
      };
    }
    if (!paths[path]) paths[path] = {};
    paths[path][route.method.toLowerCase()] = endpoint;
  }
  const guestOrMember = [...credentialSchemes, {}];
  const binary = { schema: { type: "string", format: "binary" } };
  paths["/api/v1/files"] = {
    post: {
      operationId: "files.upload",
      summary: "Upload one file as multipart form data.",
      tags: ["files"],
      security: credentialSchemes,
      parameters: [
        {
          name: "purpose",
          in: "query",
          schema: {
            type: "string",
            enum: [...schema.FILE_PURPOSES],
          },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "multipart/form-data": {
            schema: {
              type: "object",
              required: ["file"],
              properties: { file: { type: "string", format: "binary" } },
            },
          },
        },
      },
      responses: {
        201: {
          description: "Uploaded file metadata",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["id", "url", "byteSize", "contentType"],
                properties: {
                  id: { type: "integer", minimum: 1 },
                  url: { type: "string" },
                  byteSize: { type: "integer", minimum: 0 },
                  contentType: { type: "string" },
                },
              },
            },
          },
        },
        400: errorResponse("Invalid upload"),
        401: errorResponse("Authentication required"),
        403: errorResponse("Origin rejected"),
        415: errorResponse("Not multipart/form-data"),
        429: errorResponse("Too many requests"),
        503: errorResponse("File storage is unavailable"),
      },
    },
  };
  paths["/api/v1/files/{fileId}"] = {
    get: {
      operationId: "files.download",
      summary: "Serve a file after checking the attached content's visibility.",
      tags: ["files"],
      security: guestOrMember,
      parameters: [
        { name: "fileId", in: "path", required: true, schema: { type: "integer", minimum: 1 } },
      ],
      responses: {
        200: {
          description:
            "File bytes. The four web image types are served with their own type; every other " +
            "file is served as application/octet-stream.",
          content: {
            "application/octet-stream": binary,
            "image/png": binary,
            "image/jpeg": binary,
            "image/gif": binary,
            "image/webp": binary,
          },
        },
        400: errorResponse("Invalid file ID"),
        401: errorResponse("Credentials refused"),
        403: errorResponse("Member banned"),
        404: errorResponse("File not visible"),
        429: errorResponse("Too many requests"),
        503: errorResponse("File storage is unavailable"),
      },
    },
  };
  // The text and XML documents search engines fetch. Their errors are the JSON error body.
  const nodeFeedId = { type: "string", pattern: "^[0-9]+(-[^/]+)?$" };
  for (const [path, operationId, summary, mime, parameter, errors] of [
    ["/robots.txt", "seo.robots", "The robots.txt file.", "text/plain", null, []],
    ["/llms.txt", "seo.llms", "The llms.txt summary of the site.", "text/plain", null, []],
    ["/sitemap.xml", "seo.sitemapIndex", "The sitemap index.", "application/xml", null, []],
    [
      "/sitemaps/{name}",
      "seo.sitemapShard",
      "One sitemap shard, named `node-<n>.xml`, `thread-<n>.xml`, `profile-<n>.xml` or `tag-<n>.xml`.",
      "application/xml",
      {
        name: "name",
        schema: { type: "string", pattern: "^(node|thread|profile|tag)-[0-9]+\\.xml$" },
      },
      [400, 404],
    ],
    ["/feed.atom", "seo.siteFeed", "The Atom feed of the site.", "application/atom+xml", null, []],
    [
      "/forums/{nodeId}/feed.atom",
      "seo.nodeFeed",
      "The Atom feed of one forum; the id may be followed by a slug (`12-general`).",
      "application/atom+xml",
      { name: "nodeId", schema: nodeFeedId },
      [400, 404],
    ],
    [
      "/{key}.txt",
      "seo.indexNowKey",
      "The IndexNow key file; answers only for the configured key.",
      "text/plain",
      { name: "key", schema: { type: "string" } },
      [404],
    ],
  ] as const) {
    paths[path] = {
      get: {
        operationId,
        summary,
        tags: ["seo"],
        security: [],
        parameters: parameter ? [{ ...parameter, in: "path", required: true }] : [],
        responses: {
          200: {
            description: "Public SEO document",
            content: { [mime]: { schema: { type: "string" } } },
          },
          ...Object.fromEntries(errors.map((status) => [status, errorResponse("Error")])),
        },
      },
    };
  }
  paths["/api/v1/openapi.json"] = {
    get: {
      operationId: "getOpenApiDocument",
      summary: "This OpenAPI document.",
      security: guestOrMember,
      responses: {
        200: {
          description: "OpenAPI document",
          content: { "application/json": { schema: { type: "object" } } },
        },
        401: errorResponse("Credentials refused"),
        403: errorResponse("Member banned"),
        429: errorResponse("Too many requests"),
      },
    },
  };
  paths["/health"] = {
    get: {
      operationId: "getHealth",
      summary: "Whether the database answers.",
      security: [],
      responses: {
        200: {
          description: "Healthy",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["status"],
                properties: { status: { type: "string", enum: ["ok"] } },
              },
            },
          },
        },
        503: {
          description: "Unavailable",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["status"],
                properties: { status: { type: "string", enum: ["unavailable"] } },
              },
            },
          },
        },
      },
    },
  };
  const securitySchemes: Record<string, unknown> = {
    ...authDocument.components?.securitySchemes,
    sessionCookie: { type: "apiKey", in: "cookie", name: "sermo.session_token" },
    secureSessionCookie: {
      type: "apiKey",
      in: "cookie",
      name: "__Secure-sermo.session_token",
    },
    bearerApiKey: { type: "http", scheme: "bearer" },
  };
  // Better Auth lists schemas and schemes that no operation here uses; drop them.
  const usedSchemas = new Set<string>();
  collectSchemaRefs(paths, usedSchemas, schemas);
  for (const name of Object.keys(schemas)) if (!usedSchemas.has(name)) delete schemas[name];
  // Only operation-level `security` is read: the document has no global or path-level entry.
  const usedSchemes = new Set<string>();
  for (const methods of Object.values(paths))
    for (const endpoint of Object.values(methods))
      for (const requirement of ((endpoint as JsonObject).security ?? []) as JsonObject[])
        for (const name of Object.keys(requirement)) usedSchemes.add(name);
  for (const name of Object.keys(securitySchemes))
    if (!usedSchemes.has(name)) delete securitySchemes[name];
  return {
    openapi: "3.1.0",
    info: {
      title: "Sermo API",
      version: VERSION,
      license: { name: "MIT", identifier: "MIT" },
    },
    // Every path above already starts with its own prefix (`/api/v1`, `/api/auth`, or none), so
    // the server is the origin the document was fetched from.
    servers: [{ url: "/" }],
    paths,
    components: { schemas, securitySchemes },
  };
}
