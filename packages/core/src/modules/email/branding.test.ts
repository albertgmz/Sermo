import { expect, test } from "bun:test";
import { createTestContext, expectNoTableScan, insertUser } from "@sermo/core/testing";
import { invalidate } from "../../context";
import { DEFAULT_ACCENT } from "../../mail/template";
import { readSiteSettings } from "../settings";
import { siteBranding } from "./branding";

function setup() {
  const ctx = createTestContext();
  ctx.config.siteBaseURL = "https://forum.example.test";
  ctx.sqlite.prepare("DELETE FROM palette_colors WHERE kind = 'accent'").run();
  invalidate(ctx, "appearance");
  return ctx;
}

const addAccent = (
  ctx: ReturnType<typeof setup>,
  color: string,
  foreground: string,
  position: number,
  active = true,
) => {
  ctx.sqlite
    .prepare(
      "INSERT INTO palette_colors (kind, name, color, foreground, position, is_active, created_at, updated_at) VALUES ('accent', ?1, ?1, ?2, ?3, ?4, 0, 0)",
    )
    .run(color, foreground, position, active ? 1 : 0);
  invalidate(ctx, "appearance");
};

test("the accent is the palette's first active one, else Sermo's own", () => {
  const ctx = setup();
  const settings = readSiteSettings(ctx);
  expect(siteBranding(ctx, settings)).toMatchObject({
    accent: DEFAULT_ACCENT.color,
    accentForeground: DEFAULT_ACCENT.foreground,
  });
  addAccent(ctx, "#111111", "#eeeeee", 0, false);
  addAccent(ctx, "#f59e0b", "#1c1304", 2);
  addAccent(ctx, "#10b981", "#022c22", 1);
  expect(siteBranding(ctx, settings)).toMatchObject({
    accent: "#10b981",
    accentForeground: "#022c22",
  });
});

test("pictures are absolute addresses on the public file origin when there is one", () => {
  const ctx = setup();
  const settings = { ...readSiteSettings(ctx), siteName: "Foros", logoFileId: 5, iconFileId: 6 };
  expect(siteBranding(ctx, settings)).toMatchObject({
    name: "Foros",
    url: "https://forum.example.test",
    logoUrl: "https://forum.example.test/api/v1/files/5",
    iconUrl: "https://forum.example.test/api/v1/files/6",
    preferencesUrl: "https://forum.example.test/account/notifications",
  });
  ctx.config.publicFileBaseURL = "https://files.example.test";
  expect(siteBranding(ctx, settings).logoUrl).toBe("https://files.example.test/api/v1/files/5");
  expect(siteBranding(ctx, { ...settings, logoFileId: null, iconFileId: null })).toMatchObject({
    logoUrl: null,
    iconUrl: null,
  });
});

test("the contact link appears only while the contact page is published", () => {
  const ctx = setup();
  const settings = readSiteSettings(ctx);
  expect(siteBranding(ctx, settings).contactUrl).toBeNull();
  ctx.sqlite
    .prepare(
      "INSERT INTO static_pages (slug, title, body_source, body_html, is_published, created_at, updated_at) VALUES ('contact', 'Contact', 'x', 'x', 0, 1, 1)",
    )
    .run();
  expect(siteBranding(ctx, settings).contactUrl).toBeNull();
  ctx.sqlite.prepare("UPDATE static_pages SET is_published = 1 WHERE slug = 'contact'").run();
  expect(siteBranding(ctx, settings).contactUrl).toBe("https://forum.example.test/contact");
});

test("the icon is its 192 px copy when there is one, found by index", () => {
  const ctx = setup();
  const owner = insertUser(ctx, { username: "Owner" });
  const file = (variant: string | null, parent: number | null) =>
    ctx.sqlite
      .prepare<{ id: number }, [string, number, number | null, string | null, number]>(
        "INSERT INTO files (driver, storage_key, byte_size, content_type, sha256, uploader_id, purpose, visibility, parent_file_id, variant, created_at) VALUES ('local', ?1, 1, 'image/png', 'x', ?2, 'site_icon', 'public', ?3, ?4, ?5) RETURNING id",
      )
      .get(crypto.randomUUID(), owner.id, parent, variant, ctx.now())!.id;
  const icon = file(null, null);
  file("icon_48", icon);
  const settings = { ...readSiteSettings(ctx), iconFileId: icon };
  expect(siteBranding(ctx, settings).iconUrl).toBe(
    `https://forum.example.test/api/v1/files/${icon}`,
  );
  const small = file("icon_192", icon);
  expect(siteBranding(ctx, settings).iconUrl).toBe(
    `https://forum.example.test/api/v1/files/${small}`,
  );
  ctx.sqlite.prepare("UPDATE files SET deleted_at = 1 WHERE id = ?1").run(small);
  expect(siteBranding(ctx, settings).iconUrl).toBe(
    `https://forum.example.test/api/v1/files/${icon}`,
  );
  expectNoTableScan(
    ctx,
    "SELECT id FROM files WHERE parent_file_id = ?1 AND variant = 'icon_192' AND deleted_at IS NULL",
    [icon],
  );
  expectNoTableScan(ctx, "SELECT id FROM static_pages WHERE slug = ?1 AND is_published = 1", [
    "contact",
  ]);
});
