import { expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { translator, withIntl } from "@/lib/test-intl";

mock.module("server-only", () => ({}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace, true),
}));

let viewer: {
  user: { username: string } | null;
  resolvedPermissions: Record<string, boolean>;
};
mock.module("@/lib/sermo/session", () => ({ getViewer: async () => viewer }));
mock.module("@/app/[locale]/(main)/account/security/actions", () => ({
  deleteAccount: async () => null,
}));

const { DeleteAccountSection } = await import("./delete-account");

async function markup() {
  return new Response(
    await renderToReadableStream(withIntl(await DeleteAccountSection())),
  ).text();
}

test("a member whose groups allow it sees what is removed and kept, and the confirmation fields", async () => {
  viewer = {
    user: { username: "ember" },
    resolvedPermissions: { "profile.deleteAccount": true },
  };
  const html = await markup();
  expect(html).toContain("Delete account");
  expect(html).toContain("Removed:");
  expect(html).toContain("Kept:");
  expect(html).toContain("Type your username (ember) to confirm");
  expect(html).toContain('name="confirmUsername"');
  expect(html).toContain('name="actorPassword"');
});

test("nothing is drawn when the groups do not allow it, or the permission is unknown", async () => {
  viewer = {
    user: { username: "ember" },
    resolvedPermissions: { "profile.deleteAccount": false },
  };
  expect(await markup()).toBe("");
  viewer = { user: { username: "ember" }, resolvedPermissions: {} };
  expect(await markup()).toBe("");
  viewer = { user: null, resolvedPermissions: {} };
  expect(await markup()).toBe("");
});
