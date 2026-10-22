import { afterAll, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  usePathname: () => "/threads/3",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push() {}, refresh() {} }),
}));
// Another suite replaces the translator with one that fills no placeholders: use the real one.
const intl = { ...(await import("next-intl")) };
const { useTranslations } = await import("use-intl");
mock.module("next-intl", () => ({
  ...intl,
  useLocale: () => "en",
  useTranslations,
}));
afterAll(() => {
  mock.module("next/navigation", () => navigation);
  mock.module("next-intl", () => intl);
});
const { ReactionButton, createPickerControl } = await import(
  "./reaction-button"
);
const { default: ReactionPicker } = await import("./reaction-picker");

const types = [
  { id: 1, key: "1", label: "Like", emoji: "👍", picture: null },
  { id: 2, key: "2", label: "Love", emoji: "❤️", picture: null },
];

const tick = () => new Promise((done) => setTimeout(done, 0));

function deferred() {
  let resolve!: (value: { default: string }) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<{ default: string }>((ok, no) => {
    resolve = ok;
    reject = no;
  });
  return { promise, resolve, reject };
}

// A control with a stand-in for the button: what it was handed and whether it is open.
function recorder(load: () => Promise<{ default: string }>) {
  const seen = { arrived: [] as string[], open: [] as boolean[] };
  const control = createPickerControl(load, {
    arrived: (picker) => seen.arrived.push(picker),
    setOpen: (open) => seen.open.push(open),
  });
  return { control, seen };
}

function counting() {
  const calls = { fetched: 0 };
  const load = async () => {
    calls.fetched += 1;
    return { default: "picker" };
  };
  return { calls, load };
}

for (const handler of ["onPointerEnter", "onTouchStart", "onFocus"] as const) {
  test(`${handler} on the button fetches the picker's code once and opens nothing`, async () => {
    const { calls, load } = counting();
    const { control, seen } = recorder(load);
    control.handlers[handler]();
    control.handlers[handler]();
    await tick();
    expect(calls.fetched).toBe(1);
    expect(seen).toEqual({ arrived: [], open: [] });
    // Asked for once the code is there, it is handed over at once.
    control.show(true);
    expect(seen).toEqual({ arrived: ["picker"], open: [true] });
  });
}

test("opening the picker fetches its code and draws it when it arrives", async () => {
  const slow = deferred();
  const { control, seen } = recorder(() => slow.promise);
  control.show(true);
  expect(seen).toEqual({ arrived: [], open: [true] });
  // The slide toward it waits for it meanwhile.
  expect(control.asked()).toBe(true);
  slow.resolve({ default: "picker" });
  await tick();
  expect(seen.arrived).toEqual(["picker"]);
  control.show(false);
  expect(control.asked()).toBe(false);
});

test("a picker closed again before its code arrives does not open", async () => {
  const slow = deferred();
  const { control, seen } = recorder(() => slow.promise);
  control.show(true);
  // The pointer left, or the hold was let go.
  control.show(false);
  slow.resolve({ default: "picker" });
  await tick();
  expect(seen).toEqual({ arrived: [], open: [true, false] });
});

test("a code that cannot be fetched closes the picker without throwing; only the next opening asks again", async () => {
  let attempts = 0;
  let online = false;
  const { control, seen } = recorder(() => {
    attempts += 1;
    return online
      ? Promise.resolve({ default: "picker" })
      : Promise.reject(new Error("chunk load failed"));
  });
  control.show(true);
  await tick();
  await tick();
  expect(seen).toEqual({ arrived: [], open: [true, false] });
  expect(control.asked()).toBe(false);
  // A pointer passing over, a touch or focus does not fetch again after a failure.
  const tried = attempts;
  control.handlers.onPointerEnter();
  control.handlers.onTouchStart();
  control.handlers.onFocus();
  await tick();
  expect(attempts).toBe(tried);
  online = true;
  control.show(true);
  await tick();
  expect(seen.arrived).toEqual(["picker"]);
  expect(attempts).toBe(tried + 1);
});

test("a picker whose wish another button's opening took over is closed, so its next press opens it", async () => {
  const slow = deferred();
  const load = () => slow.promise;
  const first = recorder(load);
  const second = recorder(load);
  first.control.show(true);
  second.control.show(true);
  await tick();
  expect(first.control.asked()).toBe(false);
  expect(first.seen.open).toEqual([true, false]);
  slow.resolve({ default: "picker" });
  await tick();
  expect(first.seen.arrived).toEqual([]);
  expect(second.seen.arrived).toEqual(["picker"]);
  expect(second.seen.open).toEqual([true]);
});

// A static import of Base UI's popover (or of the picker) in the button's file would put its code,
// and the positioning library with it, back in the first load of every page with reactions.
test("the button's file loads the picker only on demand", () => {
  const code = readFileSync(
    join(import.meta.dir, "reaction-button.tsx"),
    "utf8",
  );
  expect(code).not.toMatch(/from "@\/components\/ui\/popover"/);
  expect(code).not.toMatch(
    /^import \{[^}]*\} from "@\/components\/forum\/reaction-picker"/m,
  );
  expect(code).toContain('import("@/components/forum/reaction-picker")');
  // The button and the plain trigger carry the handlers that fetch it.
  expect(code.split("{...control.handlers}").length - 1).toBe(2);
});

// The first element of some markup that is the picker's trigger, with its attributes.
function chooseTrigger(html: string) {
  const match =
    /<button((?:\s[^>]*)?aria-label="Choose a reaction"[^>]*)>/.exec(html);
  if (!match) throw new Error(`no picker trigger in: ${html.slice(0, 200)}`);
  const attributes: Record<string, string> = {};
  for (const [, name, value] of match[1].matchAll(
    /\s([^\s=]+)(?:="([^"]*)")?/g,
  )) {
    // What Base UI adds for its own bookkeeping.
    if (!/^(id|tabindex|data-base-ui.*|data-popup.*)$/.test(name)) {
      attributes[name] = value ?? "";
    }
  }
  return attributes;
}

test("the plain trigger is the picker's real trigger as far as the page can tell", () => {
  const plain = renderToStaticMarkup(
    withIntl(
      <ReactionButton
        stateKey="reaction:post:5"
        action={async () => undefined}
        total={0}
        viewerTypeId={null}
        types={types}
        viewerId={9}
        authorId={7}
      />,
    ),
  );
  const ref = { current: null };
  const real = renderToStaticMarkup(
    withIntl(
      <ReactionPicker
        open={false}
        onOpenChange={() => {}}
        anchor={ref}
        picker={ref}
        types={types}
        current={null}
        hovered={null}
        hover={{ onPointerEnter() {}, onPointerLeave() {} }}
        viaTrigger={{ current: false }}
        button={ref}
        choose={() => {}}
      />,
    ),
  );
  expect(chooseTrigger(plain)).toEqual(chooseTrigger(real));
});
