import { expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));

const { UserAvatar } = await import("../src/components/forum/user-avatar");

const user = {
  username: "ember",
  avatar: { fileId: 1, url: "/big.webp", smallUrl: "/small.webp" },
  frame: null,
};

async function markup(element: React.ReactElement) {
  return new Response(await renderToReadableStream(element)).text();
}

test("an avatar is lazy unless the page says it is in the first screen", async () => {
  const html = await markup(<UserAvatar user={user} link={false} />);
  expect(html).toContain('loading="lazy"');
  expect(html).toContain('decoding="async"');
});

test("an eager avatar is fetched at once", async () => {
  const html = await markup(<UserAvatar user={user} link={false} eager />);
  expect(html).toContain('loading="eager"');
  expect(html).toContain('decoding="auto"');
  expect(html).not.toContain('loading="lazy"');
});
