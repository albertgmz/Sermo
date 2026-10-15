import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { groupBody } from "@/lib/test-bodies";
import { formattedTranslator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";
import { fakeBackend } from "../../groups/test-backend";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
const nextIntl = await import("next-intl");
const useIntl = await import("use-intl");
mock.module("next-intl", () => ({
  ...nextIntl,
  useLocale: () => "en",
  useTranslations: useIntl.useTranslations,
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => formattedTranslator(namespace),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));

const { BatchView, keepAnswers } = await import("./batch-form");
const { BatchScreen } = await import("./batch-screen");
const { BATCH_ACTIONS } = await import("./state");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

const b = messages.adminUsers.batch;
const GROUPS = [
  { id: 2, title: "Members" },
  { id: 5, title: "Veterans" },
];

// Whether a control with this name and value is in the markup, whatever the order of its attributes.
const has = (html: string, name: string, value: string) =>
  new RegExp(
    `<(?:input|button)[^>]*name="${name}"[^>]*value="${value}"|<(?:input|button)[^>]*value="${value}"[^>]*name="${name}"`,
  ).test(html);

type Answers = Parameters<typeof BatchView>[0]["answers"];
type State = Parameters<typeof BatchView>[0]["state"];

// The form after the answers in order, as the client keeps them.
const after = (...states: State[]) =>
  states.reduce<Answers>((kept, state) => keepAnswers(kept, state), {
    round: 0,
  });

const draw = (state: State, answers: Answers = after(state)) =>
  renderToStaticMarkup(
    withIntl(
      <BatchView
        groups={GROUPS}
        actions={BATCH_ACTIONS}
        limit={100}
        criteria={<p>RULE BUILDER</p>}
        state={state}
        answers={answers}
        formAction={() => {}}
      />,
    ),
  );

test("the form opens on the choice of members, with the rule builder and a preview, and nothing to apply yet", () => {
  const html = draw(null);
  expect(html).toContain(b.who.heading.replace("{count}", "100"));
  expect(html).toContain("RULE BUILDER");
  expect(has(html, "selection", "criteria")).toBe(true);
  expect(has(html, "selection", "list")).toBe(true);
  expect(html).toContain('name="members"');
  expect(has(html, "step", "preview")).toBe(true);
  expect(has(html, "step", "apply")).toBe(false);
  expect(html).not.toContain(b.what.heading);
});

test("the list of ids and names is the other way to choose, and says its limit", () => {
  const html = draw(null);
  expect(html).toContain("at most 100");
  // Only the way chosen is shown; both are in the form.
  expect(html).toMatch(/<div hidden="">[\s\S]*name="members"/);
});

test("a preview shows how many, the first names, the names nobody has and that more may follow", () => {
  const html = draw({
    preview: {
      count: 120,
      names: ["wren", "robin"],
      unknown: ["ghost"],
      next: 400,
    },
  });
  expect(html).toContain("120 members match.");
  expect(html).toContain("wren, robin");
  expect(html).toContain("and 118 more");
  expect(html).toContain("Not found: ghost");
  expect(html).toContain(b.preview.next);
  // Now there is something to apply the change to.
  expect(html).toContain(b.what.heading);
  expect(has(html, "step", "apply")).toBe(true);
  expect(html).toContain(b.actions.setGroup);
  expect(html).toContain(b.actions.delete);
});

test("a preview that finds nobody offers no change", () => {
  const html = draw({
    preview: { count: 0, names: [], unknown: ["ghost"], next: null },
  });
  expect(html).toContain("Nobody matches.");
  expect(html).not.toContain(b.what.heading);
});

test("the answer of a refused step shows under the control it is about, and the form stays", () => {
  const html = draw({
    fields: { members: "Type at least one username or id." },
  });
  expect(html).toContain("Type at least one username or id.");
  expect(has(html, "step", "preview")).toBe(true);
  expect(draw({ error: "Not allowed." })).toContain("Not allowed.");
});

test("the result lists each member with what happened, and offers the next stretch of a rule", () => {
  const html = draw({
    result: {
      items: [
        { name: "wren", status: "done", message: null },
        { name: "robin", status: "skipped", message: "Outranks you." },
        {
          name: "ghost",
          status: "failed",
          message: "No member goes by that name.",
        },
      ],
      done: 1,
      skipped: 1,
      failed: 1,
      next: 321,
    },
  });
  expect(html).toContain("1 member changed, 1 skipped, 1 failed.");
  expect(html).toContain("Outranks you.");
  expect(html).toContain("No member goes by that name.");
  expect(html).toContain(messages.admin.memberOutcomes.status.skipped);
  expect(has(html, "step", "apply@321")).toBe(true);
  expect(html).toContain(b.result.continue);
  // The change stays on the page to repeat on the next members.
  expect(html).toContain(b.what.heading);
});

test("a result with nothing more to follow does not offer to continue", () => {
  const html = draw({
    result: {
      items: [{ name: "wren", status: "done", message: null }],
      done: 1,
      skipped: 0,
      failed: 0,
      next: null,
    },
  });
  expect(html).not.toContain(b.result.continue);
  expect(html).not.toContain("apply@");
});

// The screen: which groups and which changes the viewer is offered ------------------------------

function backendFor(held: Record<string, boolean>) {
  backend = fakeBackend({
    "groups.list": () =>
      Response.json({
        items: [
          groupBody({ id: 1, title: "Guests", builtin: "guest" }),
          groupBody({ id: 2, title: "Members", builtin: "registered" }),
          groupBody({ id: 5, title: "Veterans" }),
        ],
      }),
  });
  const base = globalThis.fetch;
  globalThis.fetch = (async (input: string, init: RequestInit) => {
    if (new URL(input).pathname === "/api/v1/me") {
      return Response.json({ ...viewerBody(true), resolvedPermissions: held });
    }
    return base(input, init);
  }) as unknown as typeof fetch;
}

async function props(held: Record<string, boolean>) {
  backendFor(held);
  const element = (await BatchScreen()) as {
    props: Parameters<typeof BatchView>[0];
  };
  return element.props;
}

test("the screen offers every group but the guest group, and bans only to a viewer who may ban", async () => {
  const banner = await props({ "admin.members": true, "member.ban": true });
  expect(banner.groups).toEqual([
    { id: 2, title: "Members" },
    { id: 5, title: "Veterans" },
  ]);
  expect(banner.actions).toContain("ban");
  expect(banner.actions).toContain("liftBans");
  expect(banner.limit).toBe(100);

  const editor = await props({ "admin.members": true });
  expect(editor.actions).not.toContain("ban");
  expect(editor.actions).not.toContain("liftBans");
  expect(editor.actions).toContain("setGroup");
  expect(editor.actions).toContain("delete");
});

const PREVIEW = { count: 3, names: ["wren"], unknown: [], next: null };
const RESULT = {
  items: [{ name: "wren", status: "done" as const, message: null }],
  done: 1,
  skipped: 0,
  failed: 0,
  next: 321,
};

test("a refused apply keeps the choice of change on the page, with its message next to the button", () => {
  const preview = { preview: PREVIEW };
  const refused = {
    fields: { reason: "Give a reason." },
    error: "Not allowed.",
  };
  const html = draw(refused, after(preview, refused));
  expect(html).toContain(b.what.heading);
  expect(has(html, "step", "apply")).toBe(true);
  expect(html).toContain("Not allowed.");
  // The error is drawn once, by the button that was refused, not by the preview.
  expect(html.split("Not allowed.")).toHaveLength(2);
  // Without the kept preview the section would be gone: the form as a bare refusal shows.
  expect(draw(refused)).not.toContain(b.what.heading);
});

test("the answers kept: a refusal changes nothing, a preview replaces the result, a result raises the round", () => {
  const first = after({ preview: PREVIEW });
  expect(keepAnswers(first, { error: "No." })).toBe(first);
  expect(keepAnswers(first, null)).toBe(first);
  const done = keepAnswers(first, { result: RESULT });
  expect(done.preview).toBe(PREVIEW);
  expect(done.result).toBe(RESULT);
  expect(done.round).toBe(first.round + 1);
  const again = keepAnswers(done, { preview: { ...PREVIEW, count: 2 } });
  expect(again.result).toBeUndefined();
  expect(again.round).toBe(done.round);
});

test("a stretch of a rule that found nobody but may go on offers to look further", () => {
  const html = draw({
    preview: { count: 0, names: [], unknown: [], next: 400 },
  });
  expect(html).not.toContain("Nobody matches.");
  expect(html).toContain(b.preview.noneYet);
  expect(html).toContain(b.preview.further);
  expect(has(html, "step", "preview@400")).toBe(true);
  // Still nothing to apply.
  expect(html).not.toContain(b.what.heading);
});
