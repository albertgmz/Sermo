import { expect, test } from "bun:test";
import { Settings } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { LinkCard, LinkCards } from "./link-cards";

test("a card is one link with its icon, title and line; its own links stay above it", () => {
  const html = renderToStaticMarkup(
    <LinkCards label="Setup">
      <LinkCard
        href="/admin/settings"
        icon={Settings}
        title="General"
        description="Site name and language."
      />
      <LinkCard href="/admin/sections/users" title="Users">
        <a href="/admin/users">Members</a>
      </LinkCard>
      <LinkCard title="Moderation" />
    </LinkCards>,
  );
  expect(html).toContain('<ul aria-label="Setup"');
  expect(html.match(/<li/g)?.length).toBe(3);
  expect(html).toContain('href="/admin/settings"');
  expect(html).toContain("after:absolute after:inset-0");
  expect(html).toContain("<svg");
  expect(html).toContain("Site name and language.");
  expect(html).toContain('<div class="relative mt-2"><a href="/admin/users">');
  // Without an address the card is plain.
  const plain = html.slice(html.lastIndexOf("<li"));
  expect(plain).toContain("Moderation");
  expect(plain).not.toContain("<a");
});
