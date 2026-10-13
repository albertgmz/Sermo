import { routes } from "@sermo/api/route-table";
import { SermoError } from "./errors";

export type BuiltRequest = {
  method: string;
  path: string;
  query: string;
  body: string | undefined;
};

const byOperation = new Map(routes.map((route) => [route.operation, route]));

function append(params: URLSearchParams, key: string, value: unknown) {
  if (value === undefined) return;
  if (Array.isArray(value)) {
    for (const item of value) append(params, key, item);
    return;
  }
  params.append(key, value === null ? "null" : String(value));
}

// Turns an operation name and its input into the HTTP request the API maps back to it: path
// parameters come out of the input, the rest is the query (GET) or a JSON body.
export function buildRequest(operation: string, input: unknown): BuiltRequest {
  const route = byOperation.get(operation);
  if (!route) throw new Error(`Unknown operation ${operation}.`);
  const rest: Record<string, unknown> = {
    ...((input ?? {}) as Record<string, unknown>),
  };
  const path = route.path.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = rest[name];
    if (value === undefined || value === null) {
      throw new Error(`${operation} needs ${name}.`);
    }
    delete rest[name];
    const segment = String(value);
    // `fetch` resolves dot segments, so `..` would walk to another route. Nothing the backend
    // knows is addressed by one, and an empty segment is no address either.
    if (segment === "" || segment === "." || segment === "..") {
      throw new SermoError(
        "validation",
        422,
        `${operation} was given an unusable ${name}.`,
      );
    }
    return encodeURIComponent(segment);
  });
  if (route.method === "GET") {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(rest)) append(params, key, value);
    const query = params.toString();
    return {
      method: route.method,
      path,
      query: query ? `?${query}` : "",
      body: undefined,
    };
  }
  // A DELETE sends its fields in a body as well (the API merges it as it does for a POST): a
  // password in the query string would be recorded by every proxy and access log on the way.
  const body = JSON.stringify(rest);
  return {
    method: route.method,
    path,
    query: "",
    body: route.method === "DELETE" && body === "{}" ? undefined : body,
  };
}

// Whether an operation only reads (GET): a refusal to understand its input then means the address
// the visitor asked for cannot exist.
export function isRead(operation: string): boolean {
  return byOperation.get(operation)?.method === "GET";
}
