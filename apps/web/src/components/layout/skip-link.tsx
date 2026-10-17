import { useTranslations } from "next-intl";

// The id of the frame's `<main>`, which takes `tabIndex={-1}` so that following the link moves the
// focus into it and not only the scroll.
export const MAIN_ID = "main-content";

// The first stop of the keyboard in every frame that has a header: a way past it to the page. Out
// of sight above the window until it holds the focus.
export function SkipLink() {
  const t = useTranslations("layout.skipLink");
  return (
    <a
      href={`#${MAIN_ID}`}
      className="fixed top-2 left-2 z-50 inline-flex h-10 -translate-y-20 items-center rounded-md border bg-popover px-4 text-sm font-medium text-popover-foreground shadow-lg focus:translate-y-0"
    >
      {t("label")}
    </a>
  );
}
