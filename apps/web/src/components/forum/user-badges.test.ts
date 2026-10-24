import { expect, test } from "bun:test";
import { titleBesideBadges } from "./user-badges";

const badge = (label: string) => ({ label, color: null, style: "tint" });

test("a title is kept unless a badge beside it already says it, ignoring case and spaces", () => {
  const user = (title: string, ...labels: string[]) => ({
    title,
    badges: labels.map(badge),
  });
  expect(titleBesideBadges(user("Moderator", "Moderator"))).toBe("");
  expect(titleBesideBadges(user(" moderator ", "Moderator"))).toBe("");
  // Any of the badges counts, not only the first.
  expect(titleBesideBadges(user("Donor", "Moderator", "Donor"))).toBe("");
  // A title that says more, a title with no badge, no title at all.
  expect(titleBesideBadges(user("Garden moderator", "Moderator"))).toBe(
    "Garden moderator",
  );
  expect(titleBesideBadges(user("Newcomer"))).toBe("Newcomer");
  expect(titleBesideBadges(user("", "Moderator"))).toBe("");
});
