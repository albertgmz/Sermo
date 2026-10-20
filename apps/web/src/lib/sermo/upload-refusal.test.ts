import { afterAll, expect, mock, test } from "bun:test";
import { translator } from "@/lib/test-intl";
import {
  UPLOAD_REFUSAL_PATH,
  UPLOAD_REFUSALS,
} from "../../../../../packages/core/src/modules/storage/refusal";
import en from "../../../messages/en/lib.json";
import es from "../../../messages/es/lib.json";
import { SermoError } from "./errors";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  ...intl,
  getTranslations: async (namespace: string) => translator(namespace, true),
}));
afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

const { UPLOAD_ISSUE_PATH, UPLOAD_REASONS, refusalCause, refusalWords } =
  await import("./upload-refusal");

const refusal = (
  code: string,
  issues?: { path: unknown[]; message: string }[],
) => new SermoError(code, 400, "English words", issues);

test("the web app knows the backend's upload refusal path and every reason it gives", () => {
  expect(UPLOAD_ISSUE_PATH).toBe(UPLOAD_REFUSAL_PATH);
  expect([...UPLOAD_REASONS]).toEqual([...UPLOAD_REFUSALS]);
});

test("every cause has words in English and Spanish", () => {
  const causes = [
    ...UPLOAD_REASONS,
    "sizeUnknown",
    "approval",
    "forbidden",
    "rateLimited",
  ];
  for (const words of [en.uploadRefusals, es.uploadRefusals])
    expect(Object.keys(words).sort()).toEqual([...causes].sort());
});

test("the cause comes from the upload issue, with the size limit it names", () => {
  expect(
    refusalCause(
      refusal("validation", [{ path: ["upload"], message: "heic" }]),
    ),
  ).toEqual({
    cause: "heic",
  });
  expect(
    refusalCause(
      refusal("validation", [{ path: ["upload", 1048576], message: "size" }]),
    ),
  ).toEqual({ cause: "size", limit: 1048576 });
  // A reason this app does not know is not worded.
  expect(
    refusalCause(
      refusal("validation", [{ path: ["upload"], message: "other" }]),
    ),
  ).toBeUndefined();
  expect(refusalCause(refusal("validation"))).toBeUndefined();
});

test("a refusal without an upload issue is worded by its code", () => {
  expect(
    refusalCause(
      refusal("forbidden", [{ path: ["approval"], message: "awaiting" }]),
    ),
  ).toEqual({ cause: "approval" });
  expect(refusalCause(refusal("forbidden"))).toEqual({ cause: "forbidden" });
  expect(refusalCause(refusal("rate_limited"))).toEqual({
    cause: "rateLimited",
  });
});

test("the words fill in the limit and the reaction picture's side", async () => {
  expect(await refusalWords({ cause: "size", limit: 25 * 1024 * 1024 })).toBe(
    en.uploadRefusals.size.replace("{size}", "25"),
  );
  expect(await refusalWords({ cause: "size" })).toBe(
    en.uploadRefusals.sizeUnknown,
  );
  expect(await refusalWords({ cause: "reaction" })).toBe(
    en.uploadRefusals.reaction.replace("{side}", "2048"),
  );
  expect(await refusalWords({ cause: "quota" })).toBe(en.uploadRefusals.quota);
  expect(await refusalWords({})).toBeUndefined();
});
