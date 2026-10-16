import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Ctx } from "@sermo/core";
import { closeContext, localDriver } from "@sermo/core";
import { createTestContext } from "@sermo/core/testing";
import { createApp } from "./app";

const contexts: Ctx[] = [];
const dirs: string[] = [];
let nextIp = 1;

afterEach(async () => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "sermo-media-"));
  dirs.push(dir);
  const ctx = createTestContext();
  contexts.push(ctx);
  const app = createApp(ctx, {
    trustedProxyHeader: null,
    storage: { driver: localDriver(join(dir, "files")), tempDir: join(dir, "temp") },
  });
  const env = {
    requestIP: () => ({ address: `10.2.0.${nextIp++}`, family: "IPv4" as const, port: 1 }),
  };
  const request = (path: string, init: RequestInit = {}) => app.request(path, init, env);
  const signUp = await request("/api/auth/sign-up/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
      "x-forwarded-for": `198.51.100.${nextIp++}`,
    },
    body: JSON.stringify({
      name: "player",
      username: "player",
      email: "player@example.test",
      password: "Password123!",
    }),
  });
  expect(signUp.status).toBe(200);
  const cookie = signUp.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const { user } = (await signUp.json()) as { user: { id: string } };
  const upload = async (purpose: string, blob: Blob, name: string) => {
    const form = new FormData();
    form.append("file", blob, name);
    return request(`/api/v1/files?purpose=${purpose}`, {
      method: "POST",
      headers: { cookie, origin: "http://localhost:3000" },
      body: form,
    });
  };
  return { request, cookie, upload, userId: Number(user.id) };
}

test("a video goes up by the site's default types and plays with seeking", async () => {
  const { request, cookie, upload } = await setup();
  const video = new Uint8Array(
    Buffer.concat([
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from("ftypisom\0\0\0\0isommp41", "latin1"),
      Buffer.alloc(2048, 7),
    ]),
  );
  const uploaded = await upload("attachment", new Blob([video], { type: "video/mp4" }), "clip.mp4");
  expect(uploaded.status).toBe(201);
  const file = (await uploaded.json()) as { id: number; url: string; contentType: string };
  expect(file.contentType).toBe("video/mp4");

  const whole = await request(file.url, { headers: { cookie } });
  expect(whole.status).toBe(200);
  expect(whole.headers.get("content-type")).toBe("video/mp4");
  expect(whole.headers.get("accept-ranges")).toBe("bytes");
  expect(new Uint8Array(await whole.arrayBuffer())).toEqual(video);

  const part = await request(file.url, { headers: { cookie, range: "bytes=1024-1535" } });
  expect(part.status).toBe(206);
  expect(part.headers.get("content-range")).toBe(`bytes 1024-1535/${video.byteLength}`);
  expect(part.headers.get("content-length")).toBe("512");
  expect(new Uint8Array(await part.arrayBuffer())).toEqual(video.subarray(1024, 1536));

  const past = await request(file.url, {
    headers: { cookie, range: `bytes=${video.byteLength}-` },
  });
  expect(past.status).toBe(416);
  expect(past.headers.get("content-range")).toBe(`bytes */${video.byteLength}`);
});

test("an animated GIF avatar moves where it is shown full size and is still as a thumbnail", async () => {
  const { request, cookie, upload, userId } = await setup();
  // A 1x1 GIF of three frames: red, green, blue.
  const frame = (colour: number) => [
    ...[0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00],
    ...[0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0],
    // LZW with 2-bit codes: clear, the colour, end.
    ...[0x02, 0x02, 0x44 | (colour << 3), 0x01, 0x00],
  ];
  const gif = new Uint8Array([
    ...Buffer.from("GIF89a", "latin1"),
    ...[1, 0, 1, 0, 0xf1, 0, 0],
    ...[255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0],
    ...[0x21, 0xff, 0x0b, ...Buffer.from("NETSCAPE2.0", "latin1"), 0x03, 0x01, 0, 0, 0],
    ...frame(0),
    ...frame(1),
    ...frame(2),
    0x3b,
  ]);
  const uploaded = await upload("avatar", new Blob([gif], { type: "image/gif" }), "moving.gif");
  expect(uploaded.status).toBe(201);
  const { id } = (await uploaded.json()) as { id: number };
  const set = await request("/api/v1/profile/avatar", {
    method: "PUT",
    headers: { cookie, origin: "http://localhost:3000", "content-type": "application/json" },
    body: JSON.stringify({ fileId: id }),
  });
  expect(set.status).toBe(200);

  const cards = await request(`/api/v1/member-cards?userIds=${userId}`);
  expect(cards.status).toBe(200);
  const { items } = (await cards.json()) as {
    items: { avatar: { url: string; smallUrl: string } }[];
  };
  const { url, smallUrl } = items[0]!.avatar;
  expect(smallUrl).not.toBe(url);
  const pages = async (address: string) => {
    const response = await request(address);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    // Each frame of an animated WebP is an ANMF chunk.
    const bytes = Buffer.from(await response.arrayBuffer());
    let frames = 0;
    for (let at = bytes.indexOf("ANMF"); at !== -1; at = bytes.indexOf("ANMF", at + 4)) frames += 1;
    return frames;
  };
  expect(await pages(url)).toBe(3);
  expect(await pages(smallUrl)).toBe(0);
});
