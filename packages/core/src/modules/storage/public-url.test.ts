import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import sharp from "sharp";
import { GUEST } from "../../actor";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { insertCatalogImage } from "../appearance/catalog-fixtures";
import { createStorage, localDriver } from ".";

sharp.cache(false);

interface Json {
  id: number;
  items: { image: unknown }[];
  image: unknown;
  backdrop: unknown;
}
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const png = () =>
  sharp({
    create: { width: 40, height: 30, channels: 4, background: { r: 9, g: 9, b: 9, alpha: 1 } },
  })
    .png()
    .toBuffer();

/** Uploads one picture per public surface and returns the url each one is served with. */
async function urls(publicFileBaseURL: string | undefined) {
  const dir = await mkdtemp(join(tmpdir(), "sermo-public-url-"));
  dirs.push(dir);
  const ctx = createTestContext();
  ctx.config.publicFileBaseURL = publicFileBaseURL;
  const storage = createStorage(ctx, { driver: localDriver(join(dir, "files")), tempDir: dir });
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const run = (name: string, actor: typeof admin | typeof GUEST, input: object) =>
    execute(ctx, getOperation(name), actor, input) as Promise<Json>;
  const upload = async (purpose: string) => {
    const bytes = await png();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    return (await storage.upload(admin, stream, "image/png", purpose as never)).id;
  };
  const expected = (id: number) =>
    publicFileBaseURL ? `${publicFileBaseURL}/api/v1/files/${id}` : `/api/v1/files/${id}`;

  const coverFile = await upload("cover_preset");
  const entry = await run("catalogImages.create", admin, {
    kind: "profile_cover",
    name: "Dusk",
    fileId: coverFile,
  });
  const listed = await run("catalogImages.list", GUEST, { kind: "profile_cover" });

  const backdropFile = await upload("site_backdrop");
  await run("settings.update", admin, { backdropFileId: backdropFile });
  const site = await run("site.get", GUEST, {});

  const category = await run("shopCategories.create", admin, { name: "Art" });
  const awardFile = await upload("award_image");
  const award = await run("awards.create", admin, { name: "Veteran", tier: "gold" });
  await run("images.setAwardImage", admin, { awardId: award.id, fileId: awardFile });
  const item = await run("shopItems.create", admin, {
    categoryId: category.id,
    name: "Badge",
    price: 5,
    effect: { type: "frame", frameId: insertCatalogImage(ctx, "frame") },
  });
  const shopFile = await upload("shop_image");
  await run("images.setShopItemImage", admin, { itemId: item.id, fileId: shopFile });

  return [
    [entry.image, coverFile],
    [listed.items[0]!.image, coverFile],
    [site.backdrop, backdropFile],
    [(await run("awards.get", admin, { awardId: award.id })).image, awardFile],
    [(await run("shopItems.get", admin, { itemId: item.id })).image, shopFile],
  ].map(([picture, id]) => ({ picture, id: id as number, url: expected(id as number) }));
}

describe("public picture urls", () => {
  test("carry the public file origin when one is configured", async () => {
    for (const { picture, id, url } of await urls("https://cdn.example.test"))
      expect(picture).toEqual({ fileId: id, url });
  });

  test("are relative without one", async () => {
    for (const { picture, id, url } of await urls(undefined)) {
      expect(url).toBe(`/api/v1/files/${id}`);
      expect(picture).toEqual({ fileId: id, url });
    }
  });
});
