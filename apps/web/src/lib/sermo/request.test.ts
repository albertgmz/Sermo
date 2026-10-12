import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRequest } from "./request";

test("path parameters leave the input and the rest becomes the query of a read", () => {
  assert.deepEqual(buildRequest("threads.get", { threadId: 7 }), {
    method: "GET",
    path: "/threads/7",
    query: "",
    body: undefined,
  });
  const list = buildRequest("threads.list", {
    nodeId: 3,
    limit: 20,
    sticky: true,
    tags: ["a", "b c"],
    cursor: null,
    skipped: undefined,
  });
  assert.equal(list.path, "/nodes/3/threads");
  assert.equal(list.query, "?limit=20&sticky=true&tags=a&tags=b+c&cursor=null");
  assert.equal(list.body, undefined);
});

test("a write sends the rest of the input as a JSON body", () => {
  const built = buildRequest("threads.create", {
    nodeId: 3,
    title: "Hello",
    pinned: false,
    skipped: undefined,
  });
  assert.equal(built.method, "POST");
  assert.equal(built.path, "/nodes/3/threads");
  assert.equal(built.query, "");
  assert.deepEqual(JSON.parse(built.body ?? ""), {
    title: "Hello",
    pinned: false,
  });
});

test("an operation outside the route table throws at once", () => {
  assert.throws(() => buildRequest("nothing.here", {}), /Unknown operation/);
});
