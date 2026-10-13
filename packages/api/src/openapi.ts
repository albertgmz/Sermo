import { type Ctx, getAuth } from "@sermo/core";
import * as z from "zod";
import { routeOperations } from "./routes";

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
  return result;
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

export async function buildOpenApiDocument(ctx: Ctx): Promise<object> {
  const auth = await getAuth(ctx).api.generateOpenAPISchema();
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
      const operation = endpoint as JsonObject;
      prefixed[method] = {
        ...operation,
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
        parameters.push({
          name,
          in: pathFields.includes(name) ? "path" : "query",
          required: pathFields.includes(name) || required.includes(name),
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
      responses[status] = {
        description: "Error",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      };
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
  paths["/api/v1/files"] = {
    post: {
      operationId: "files.upload",
      summary: "Upload one file as multipart form data.",
      tags: ["files"],
      security: [{ sessionCookie: [] }, { secureSessionCookie: [] }, { bearerApiKey: [] }],
      parameters: [
        {
          name: "purpose",
          in: "query",
          schema: {
            type: "string",
            enum: ["attachment", "avatar", "cover", "node_icon", "node_cover"],
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
        201: { description: "Uploaded file metadata" },
        400: { description: "Invalid upload" },
        401: { description: "Authentication required" },
        403: { description: "Origin rejected" },
        415: { description: "Not multipart/form-data" },
      },
    },
  };
  paths["/api/v1/files/{fileId}"] = {
    get: {
      operationId: "files.download",
      summary: "Serve a file after checking the attached content's visibility.",
      tags: ["files"],
      parameters: [
        { name: "fileId", in: "path", required: true, schema: { type: "integer", minimum: 1 } },
      ],
      responses: { 200: { description: "File bytes" }, 404: { description: "File not visible" } },
    },
  };
  for (const [path, operationId, mime] of [
    ["/robots.txt", "seo.robots", "text/plain"],
    ["/sitemap.xml", "seo.sitemapIndex", "application/xml"],
    ["/sitemaps/{name}", "seo.sitemapShard", "application/xml"],
    ["/feed.atom", "seo.siteFeed", "application/atom+xml"],
    ["/forums/{nodeId}/feed.atom", "seo.nodeFeed", "application/atom+xml"],
    ["/{key}.txt", "seo.indexNowKey", "text/plain"],
  ] as const) {
    paths[path] = {
      get: {
        operationId,
        tags: ["seo"],
        parameters: path.includes("{name}")
          ? [{ name: "name", in: "path", required: true, schema: { type: "string" } }]
          : path.includes("{key}")
            ? [{ name: "key", in: "path", required: true, schema: { type: "string" } }]
            : path.includes("{nodeId}")
              ? [
                  {
                    name: "nodeId",
                    in: "path",
                    required: true,
                    schema: { type: "integer", minimum: 1 },
                  },
                ]
              : [],
        responses: {
          200: {
            description: "Public SEO document",
            content: { [mime]: { schema: { type: "string" } } },
          },
          404: { description: "Not found" },
        },
      },
    };
  }
  paths["/api/v1/openapi.json"] = {
    get: {
      operationId: "getOpenApiDocument",
      responses: { 200: { description: "OpenAPI document" } },
    },
  };
  paths["/health"] = {
    get: {
      operationId: "getHealth",
      responses: { 200: { description: "Healthy" }, 503: { description: "Unavailable" } },
    },
  };
  return {
    openapi: "3.1.0",
    info: { title: "Sermo API", version: "1.0.0" },
    paths,
    components: {
      schemas,
      securitySchemes: {
        ...authDocument.components?.securitySchemes,
        sessionCookie: { type: "apiKey", in: "cookie", name: "sermo.session_token" },
        secureSessionCookie: {
          type: "apiKey",
          in: "cookie",
          name: "__Secure-sermo.session_token",
        },
        bearerApiKey: { type: "http", scheme: "bearer" },
      },
    },
  };
}
