import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { EditForm } from "@/components/staff/edit-form";
import { CRITERIA_BODY } from "@/lib/test-criteria";
import { translator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";
import { fakeBackend } from "../groups/test-backend";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));

const { ReactionFields } = await import("./reaction-fields");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

const TYPE = {
  id: 4,
  title: "Like",
  emoji: "x",
  score: -1,
  position: 1,
  isActive: true,
  image: { fileId: 9, url: "/api/v1/files/9" },
  frames: { width: 32, height: 24, count: 3, columns: 2 },
  forumIds: [3],
  hideWhenLocked: true,
  rule: { match: "all" as const, conditions: [] },
  access: "open" as const,
  lockHint: null,
};

async function draw(fields: Parameters<typeof ReactionFields>[0]) {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(true)),
    "criteria.list": () =>
      Response.json({
        items: CRITERIA_BODY,
        groups: [],
        awards: [],
        creditRules: [],
        reactionTypes: [],
      }),
    "shopCategories.list": () => Response.json({ items: [] }),
  });
  const stream = await renderToReadableStream(
    withIntl(
      <EditForm action={async () => null}>
        {await ReactionFields(fields)}
      </EditForm>,
    ),
  );
  await stream.allReady;
  return new Response(stream).text();
}

const FORUMS = [{ id: 3, label: "News" }];

// The tag of the control named `name`, whatever the order of its attributes.
const control = (html: string, name: string) =>
  html.match(new RegExp(`<(?:input|select)[^>]*name="${name}"[^>]*>`))?.[0] ??
  "";

test("the edit page holds every field of the type, the frames and access in closed cards", async () => {
  const html = await draw({ type: TYPE, forums: FORUMS, current: <b>now</b> });
  expect(control(html, "emoji")).toContain('required=""');
  expect(control(html, "emoji")).toContain('value="x"');
  expect(control(html, "title")).toContain('value="Like"');
  expect(control(html, "score")).toContain('required=""');
  expect(control(html, "score")).toContain('value="-1"');
  // A picture can be replaced or taken away.
  expect(html).toContain('name="fileId"');
  expect(html).toContain('name="fileIdRemove"');
  expect(html).toContain("<b>now</b>");
  // The sprite sheet's cut, as the backend holds it.
  expect(control(html, "frameWidth")).toContain('value="32"');
  expect(control(html, "frameHeight")).toContain('value="24"');
  expect(control(html, "frameCount")).toContain('value="3"');
  expect(html.match(/<details/g)?.length).toBe(2);
  expect(html).not.toContain("<details open");
  expect(html).toContain('name="rule"');
  expect(html).toContain('name="forumIds" value="3"');
  expect(control(html, "hideWhenLocked")).not.toBe("");
  expect(html).toContain('<option value="1" selected="">');
  // Position and offering are set from the sort page and the list.
  expect(html).not.toContain('name="position"');
  expect(html).not.toContain('name="isActive"');
});

test("the new page asks for the position after the last type and offers the type at once", async () => {
  const html = await draw({ forums: FORUMS, position: 7 });
  expect(control(html, "position")).toContain('value="7"');
  expect(control(html, "isActive")).toContain('checked=""');
  // An empty score is the backend's default.
  expect(control(html, "score")).not.toContain("required");
  expect(html).not.toContain('name="fileIdRemove"');
  expect(html).toContain('name="frameWidth"');
  expect(html).toContain('name="forumIds" value=""');
});
