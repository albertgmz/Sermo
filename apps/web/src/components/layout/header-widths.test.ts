import { expect, test } from "bun:test";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { HEADER_TOOLS_GAP, REGISTER_BUTTON } from "./header-widths";

// The widths themselves are measured by the end-to-end phone suite (the cookie banner's gutters
// and `expectFits`); this keeps the phone sizes from being merged away by the button's own.
test("a guest's Create Account button is smaller below md and keeps its size from md up", () => {
  const classes = cn(buttonVariants(), "h-10", REGISTER_BUTTON).split(" ");
  expect(classes).toContain("px-2");
  expect(classes).toContain("md:px-3");
  expect(classes).toContain("text-[0.8125rem]");
  expect(classes).toContain("md:text-sm");
  expect(classes).not.toContain("px-3");
  expect(classes).not.toContain("text-sm");
});

test("the header's tools sit closer together below md", () => {
  expect(HEADER_TOOLS_GAP.split(" ")).toEqual(["gap-0.5", "md:gap-2"]);
});
