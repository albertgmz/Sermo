// The specification the reference is built from: public and the same for everyone.
export const SPEC_PATH = "/api/v1/openapi.json";

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// The specification as the page shows it. The server is the site itself (every path in the
// document already carries its own prefix). A browser cannot set a cookie by hand, so the session
// cookie schemes are left out of the Authorize dialog and of each operation's alternatives: the
// session is sent by the browser on its own, and a pasted API key is the one thing to enter.
// The input is not changed.
export function forBrowser(spec: Json, origin: string): Json {
  const components = isRecord(spec.components) ? spec.components : {};
  const schemes = isRecord(components.securitySchemes)
    ? components.securitySchemes
    : {};
  const cookie = new Set(
    Object.entries(schemes)
      .filter(([, scheme]) => isRecord(scheme) && scheme.in === "cookie")
      .map(([name]) => name),
  );

  const without = (security: unknown) =>
    Array.isArray(security)
      ? security.flatMap((requirement) => {
          if (!isRecord(requirement)) return [requirement];
          const all = Object.entries(requirement);
          const kept = all.filter(([name]) => !cookie.has(name));
          // An alternative that named only cookies is gone; the empty one (no credentials) stays.
          return all.length > 0 && kept.length === 0
            ? []
            : [Object.fromEntries(kept)];
        })
      : security;

  const operation = (value: unknown) =>
    isRecord(value) && "security" in value
      ? { ...value, security: without(value.security) }
      : value;

  const paths = isRecord(spec.paths) ? spec.paths : {};
  return {
    ...spec,
    servers: [{ url: origin }],
    paths: Object.fromEntries(
      Object.entries(paths).map(([path, methods]) => [
        path,
        isRecord(methods)
          ? Object.fromEntries(
              Object.entries(methods).map(([method, value]) => [
                method,
                operation(value),
              ]),
            )
          : methods,
      ]),
    ),
    components: {
      ...components,
      securitySchemes: Object.fromEntries(
        Object.entries(schemes).filter(([name]) => !cookie.has(name)),
      ),
    },
  };
}

// The part of a Try it out request that is changed here.
type TryItRequest = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
};

// A write that carries a session cookie must say it is JSON, even when it has no body (a DELETE
// with only a path parameter): the API answers 415 otherwise. Swagger UI sends no Content-Type for
// such a request, so one is added. A request with a body (a JSON one, or a multipart upload whose
// boundary the browser sets) keeps its own.
export function withJsonType<T extends TryItRequest>(request: T): T {
  const writes = !/^(?:get|head|options)$/i.test(request.method ?? "GET");
  const typed = Object.keys(request.headers ?? {}).some(
    (name) => name.toLowerCase() === "content-type",
  );
  if (!writes || typed || request.body) return request;
  request.headers = { ...request.headers, "Content-Type": "application/json" };
  return request;
}
