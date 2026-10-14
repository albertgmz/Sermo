import { routes } from "@sermo/api/route-table";

// The fake backend of this section's action tests: `fakeBackend` replaces `fetch`, finds the
// operation each request is for in the API's route table, records it, and answers with what the
// test gave for that operation. A request for an operation with no answer fails the test.
export type Asked = { operation: string; path: string; body: unknown };

const patterns = routes.map((route) => ({
  operation: route.operation,
  method: route.method,
  pattern: new RegExp(
    `^/api/v1${route.path
      .replace(/[.*+?^$()|[\]\\]/g, "\\$&")
      .replace(/\{\w+\}/g, "[^/]+")}$`,
  ),
}));

export function fakeBackend(answers: Record<string, () => Response>) {
  const asked: Asked[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string, init: RequestInit) => {
    const path = new URL(input).pathname;
    const method = init.method ?? "GET";
    const route = patterns.find(
      (entry) => entry.method === method && entry.pattern.test(path),
    );
    const answer = route && answers[route.operation];
    if (!route || !answer) throw new Error(`Unexpected ${method} ${path}`);
    asked.push({
      operation: route.operation,
      path,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    return answer();
  }) as unknown as typeof fetch;
  return {
    asked,
    restore: () => {
      globalThis.fetch = realFetch;
    },
  };
}

export const refusal = (
  status: number,
  code: string,
  message = code,
  issues?: { path: string[]; message: string }[],
) => Response.json({ error: { code, message, issues } }, { status });

// The two refusals of an administrator's password, as the backend gives them: each names the field.
export const wrongPassword = () =>
  refusal(403, "forbidden", "That is not your password.", [
    { path: ["actorPassword"], message: "Wrong password" },
  ]);
export const tooManyWrongPasswords = () =>
  refusal(429, "rate_limited", "Too many wrong passwords. Try again later.", [
    { path: ["actorPassword"], message: "Too many wrong passwords" },
  ]);
