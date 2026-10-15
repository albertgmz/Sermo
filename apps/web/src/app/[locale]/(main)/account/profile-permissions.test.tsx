import { expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { translator, withIntl } from "@/lib/test-intl";

mock.module("server-only", () => ({}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace, true),
  getFormatter: async () => ({
    dateTime: (date: Date) => date.toISOString().slice(0, 10),
  }),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));

let permissions: Record<string, boolean | number> = {};
let usernameChange: {
  reason: "approval" | "limit" | null;
  availableAt: string | null;
} = {
  reason: null,
  availableAt: null,
};
mock.module("@/lib/sermo/session", () => ({
  getViewer: async () => ({ resolvedPermissions: permissions }),
}));
mock.module("@/app/[locale]/(main)/account/data", () => ({
  getSelf: async () => ({
    profile: { username: "ember", avatar: null, cover: null, card: {} },
    usernameChange,
  }),
  getWorn: async () => ({ coverPresetId: null }),
  getRenameUnits: async () => 2,
  shopHref: "/credits",
}));
// The rows are drawn by client components; their props are what the page decides.
mock.module("@/app/[locale]/(main)/account/picture-row", () => ({
  PictureRow: (props: { kind: string; canUpload?: boolean }) =>
    createElement("div", {
      "data-picture": props.kind,
      "data-upload": String(props.canUpload),
    }),
}));
mock.module("@/app/[locale]/(main)/account/username-form", () => ({
  UsernameForm: () => createElement("form", { id: "username-form" }),
}));
mock.module("@/components/forum/user-avatar", () => ({
  UserAvatar: () => null,
}));
mock.module("@/components/forum/art", () => ({ Art: () => null }));

const { Pictures, Username } = await import("./profile-forms");

async function markup(element: React.ReactNode) {
  return new Response(await renderToReadableStream(withIntl(element))).text();
}

test("the avatar and cover rows are told whether the groups allow uploading them", async () => {
  permissions = { "profile.uploadAvatar": false, "profile.uploadCover": true };
  const html = await markup(await Pictures());
  expect(html).toContain('data-picture="avatar" data-upload="false"');
  expect(html).toContain('data-picture="cover" data-upload="true"');
});

test("a member whose groups need staff to rename them is told so, not offered the form", async () => {
  permissions = {};
  usernameChange = { reason: "approval", availableAt: null };
  const html = await markup(await Username());
  expect(html).toContain("Only staff can change your username.");
  expect(html).not.toContain("username-form");
});

test("a used-up limit says when the next change is free, or that none is left", async () => {
  permissions = {};
  usernameChange = { reason: "limit", availableAt: "2026-05-01T00:00:00.000Z" };
  expect(await markup(await Username())).toContain("again on 2026-05-01.");
  usernameChange = { reason: "limit", availableAt: null };
  expect(await markup(await Username())).toContain(
    "used all the username changes",
  );
});

test("a member who may rename gets the form", async () => {
  permissions = {};
  usernameChange = { reason: null, availableAt: null };
  expect(await markup(await Username())).toContain("username-form");
});
