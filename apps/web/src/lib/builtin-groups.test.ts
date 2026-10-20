import { expect, test } from "bun:test";
import { messages } from "@/i18n/messages";
import esLib from "../../messages/es/lib.json";
import { type BuiltinGroupKey, inVisitorsLanguage } from "./builtin-groups";

const words = (key: BuiltinGroupKey) => `es:${key}`;
const group = (over: Record<string, unknown> = {}) => ({
  builtin: "registered",
  title: "Member",
  userTitle: "Member",
  description: "",
  ...over,
});

test("the default English text of a built-in group is replaced, field by field", () => {
  expect(inVisitorsLanguage(group(), words)).toMatchObject({
    title: "es:registered.title",
    userTitle: "es:registered.userTitle",
    description: "",
  });
  expect(
    inVisitorsLanguage(
      group({
        builtin: "unconfirmed",
        title: "Unconfirmed",
        userTitle: "Awaiting confirmation",
        description: "Members who have not confirmed their email address.",
      }),
      words,
    ),
  ).toMatchObject({
    title: "es:unconfirmed.title",
    userTitle: "es:unconfirmed.userTitle",
    description: "es:unconfirmed.description",
  });
});

test("text an administrator changed is kept, even when only one field was changed", () => {
  expect(inVisitorsLanguage(group({ title: "Regulars" }), words)).toMatchObject(
    { title: "Regulars", userTitle: "es:registered.userTitle" },
  );
  expect(inVisitorsLanguage(group({ title: "member" }), words).title).toBe(
    "member",
  );
});

test("a group that is not built in, or has no default for a field, is never translated", () => {
  expect(inVisitorsLanguage(group({ builtin: null }), words)).toEqual(
    group({ builtin: null }),
  );
  expect(
    inVisitorsLanguage(
      group({ builtin: "guest", title: "Guest", userTitle: "" }),
      words,
    ),
  ).toMatchObject({ title: "es:guest.title", userTitle: "" });
  expect(
    inVisitorsLanguage(group({ builtin: "unknown-key" }), words).title,
  ).toBe("Member");
});

test("the English words are the default text itself and the Spanish ones differ", () => {
  const en = messages.lib.builtinGroups;
  expect(en.registered).toEqual({ title: "Member", userTitle: "Member" });
  expect(en.admin.title).toBe("Administrator");
  expect(en.unconfirmed.userTitle).toBe("Awaiting confirmation");
  expect(esLib.builtinGroups.registered.title).toBe("Miembro");
  expect(esLib.builtinGroups.admin.title).not.toBe(en.admin.title);
});
