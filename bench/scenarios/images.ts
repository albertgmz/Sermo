import type { Scenario } from "../harness";

const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
    "base64",
  ),
);
const text = "document bytes ".repeat(1024);

async function upload(
  env: Parameters<Scenario["run"]>[0],
  purpose: string,
  bytes: Uint8Array | string,
  type: string,
) {
  const form = new FormData();
  form.append(
    "file",
    new Blob([typeof bytes === "string" ? bytes : new Uint8Array(bytes)], { type }),
    "upload",
  );
  const response = await env.request(`/api/v1/files?purpose=${purpose}`, {
    method: "POST",
    headers: { authorization: await env.authHeader(env.actors.member(0)) },
    body: form,
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Upload -> ${response.status} ${body}`);
  return body;
}

export const scenarios: Scenario[] = [
  {
    name: "files.upload text transfer",
    kind: "write",
    iterations: 30,
    budgetExempt: "file transfer",
    run: (env) => upload(env, "attachment", text, "text/plain"),
  },
  {
    name: "images.upload avatar processing",
    kind: "write",
    iterations: 30,
    budgetExempt: "image processing",
    run: (env) => upload(env, "avatar", png, "image/png"),
  },
];
