import { expect, test } from "bun:test";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import { invalidate } from "../../context";
import { updateSiteSettings } from "../settings";
import { LLMS_FORUM_CAP, llmsTxt } from ".";

const BASE = "https://forum.example.test";

function describeNode(ctx: ReturnType<typeof createTestContext>, id: number, text: string) {
  ctx.sqlite.prepare("UPDATE nodes SET description = ?1 WHERE id = ?2").run(text, id);
}

function hideFromGuests(ctx: ReturnType<typeof createTestContext>, nodeId: number) {
  ctx.sqlite
    .prepare(
      "INSERT INTO permission_entries (permission_id,node_id,group_id,user_id,value) VALUES ((SELECT id FROM permission_definitions WHERE key='node.view'),?1,1,0,-1)",
    )
    .run(nodeId);
}

test("llms.txt names the site, groups the guest-visible forums by category and links the interfaces", () => {
  const ctx = createTestContext();
  updateSiteSettings(ctx, userActor(insertUser(ctx, { groupId: 4 })), {
    siteName: "Acme Talk",
    siteDescription: "Where Acme\nusers  compare notes.",
  });
  const category = insertNode(ctx, { title: "Support", type: "category" });
  const help = insertNode(ctx, { title: "Help [new]", parentId: category.id });
  const nested = insertNode(ctx, { title: "Billing", parentId: help.id });
  const secret = insertNode(ctx, { title: "Staff room", parentId: category.id });
  const loose = insertNode(ctx, { title: "Off topic" });
  const emptyCategory = insertNode(ctx, { title: "Hidden category", type: "category" });
  const hiddenChild = insertNode(ctx, { title: "Quiet", parentId: emptyCategory.id });
  describeNode(ctx, help.id, "Ask  anything\nhere");
  describeNode(ctx, secret.id, "Never listed");
  invalidate(ctx, "node_tree");
  hideFromGuests(ctx, secret.id);
  hideFromGuests(ctx, emptyCategory.id);

  const text = llmsTxt(ctx, BASE);
  expect(text.startsWith("# Acme Talk\n\n> Where Acme users compare notes.\n\n")).toBe(true);
  expect(text.endsWith("\n")).toBe(true);
  expect(text).toContain(
    `## Support\n\n- [Help \\[new\\]](${BASE}/forums/${help.id}-help-new): Ask anything here\n- [Billing](${BASE}/forums/${nested.id}-billing)\n\n`,
  );
  expect(text).toContain(`## Forums\n\n- [Off topic](${BASE}/forums/${loose.id}-off-topic)\n\n`);
  expect(text.indexOf("## Support")).toBeLessThan(text.indexOf("## Forums"));
  expect(text).not.toContain("Staff room");
  expect(text).not.toContain("Never listed");
  expect(text).not.toContain("Hidden category");
  expect(text).not.toContain(`/forums/${hiddenChild.id}-`);
  expect(text).toContain(`- [OpenAPI description](${BASE}/api/v1/openapi.json):`);
  expect(text).toContain(`- [MCP server](${BASE}/mcp):`);
  expect(text).toContain(`- [Sitemap](${BASE}/sitemap.xml):`);
  expect(text).not.toContain("Only the first");
  expect(text).not.toMatch(/\bAI\b|assistant|Claude|generated/i);
});

test("llms.txt falls back to a plain summary and caps the forum list", () => {
  const ctx = createTestContext();
  for (let i = 0; i < LLMS_FORUM_CAP + 5; i++) insertNode(ctx, { title: `Forum ${i}` });
  invalidate(ctx, "node_tree");
  const text = llmsTxt(ctx, BASE);
  expect(text).toContain("# Sermo\n\n> Sermo is a discussion forum.\n");
  expect(text.match(/^- \[Forum \d+\]/gm)).toHaveLength(LLMS_FORUM_CAP);
  expect(text).toContain(`Only the first ${LLMS_FORUM_CAP} forums are listed here`);
});

test("llms.txt refuses a base URL that is not an origin", () => {
  expect(() => llmsTxt(createTestContext(), "not a url")).toThrow();
});
