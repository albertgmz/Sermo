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
const { ReactionButton, pickerCode } = await import("./reaction-button");
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

function recorder(load: () => Promise<{ default: string }>) {
  const seen = { arrived: [] as string[], failed: 0 };
  const code = pickerCode(
    load,
    (picker) => seen.arrived.push(picker),
    () => seen.failed++,
  );
  return { code, seen };
}

test("the first pointer over the button fetches the picker's code and opens nothing", async () => {
  let fetched = 0;
  const { code, seen } = recorder(async () => {
    fetched += 1;
    return { default: "picker" };
  });
  code.warm();
  code.warm();
  await tick();
  expect(fetched).toBe(1);
  expect(seen.arrived).toEqual([]);
  // Asked for once the code is there, it is handed over at once.
  code.want(true);
  expect(seen.arrived).toEqual(["picker"]);
});

test("a picker asked for before its code arrives opens when it does", async () => {
  const slow = deferred();
  const { code, seen } = recorder(() => slow.promise);
  code.want(true);
  expect(seen.arrived).toEqual([]);
  slow.resolve({ default: "picker" });
  await tick();
  expect(seen.arrived).toEqual(["picker"]);
});

test("a picker closed again before its code arrives does not open", async () => {
  const slow = deferred();
  const { code, seen } = recorder(() => slow.promise);
  code.want(true);
  // The pointer left, or the hold was let go.
  code.want(false);
  slow.resolve({ default: "picker" });
  await tick();
  expect(seen.arrived).toEqual([]);
});

test("a code that cannot be fetched closes the picker without throwing, and the next gesture asks again", async () => {
  let attempts = 0;
  let online = false;
  const { code, seen } = recorder(() => {
    attempts += 1;
    return online
      ? Promise.resolve({ default: "picker" })
      : Promise.reject(new Error("chunk load failed"));
  });
  code.warm();
  code.want(true);
  await tick();
  await tick();
  expect(seen.failed).toBe(1);
  expect(seen.arrived).toEqual([]);
  online = true;
  code.want(true);
  await tick();
  expect(seen.arrived).toEqual(["picker"]);
  expect(attempts).toBeGreaterThan(2);
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
