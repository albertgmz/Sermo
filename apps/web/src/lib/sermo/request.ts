import { routes } from "@sermo/api/route-table";

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
// parameters come out of the input, the rest is the query (GET, DELETE) or a JSON body.
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
    return encodeURIComponent(String(value));
  });
  if (route.method === "GET" || route.method === "DELETE") {
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
  return {
    method: route.method,
    path,
    query: "",
    body: JSON.stringify(rest),
  };
}
