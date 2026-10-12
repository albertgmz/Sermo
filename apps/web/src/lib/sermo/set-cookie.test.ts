import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSetCookie } from "./set-cookie";

test("reads the value and every attribute", () => {
  assert.deepEqual(
    parseSetCookie(
      "sermo.session_token=abc%2Bdef.ghi; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax",
    ),
    {
      name: "sermo.session_token",
      value: "abc+def.ghi",
      options: {
        maxAge: 604800,
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "lax",
      },
    },
  );
});

test("an Expires date keeps its comma", () => {
  const parsed = parseSetCookie(
    "sermo.session_data=x; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/; SameSite=Strict",
  );
  assert.equal(
    parsed?.options.expires?.toISOString(),
    "2026-10-21T07:28:00.000Z",
  );
  assert.equal(parsed?.options.sameSite, "strict");
  assert.equal(parsed?.options.httpOnly, undefined);
});

test("a deletion keeps Max-Age=0 and an empty value", () => {
  assert.deepEqual(parseSetCookie("sermo.session_token=; Max-Age=0; Path=/"), {
    name: "sermo.session_token",
    value: "",
    options: { maxAge: 0, path: "/" },
  });
});

test("a header without a name is ignored", () => {
  assert.equal(parseSetCookie("=oops"), null);
  assert.equal(parseSetCookie("nothing"), null);
});
