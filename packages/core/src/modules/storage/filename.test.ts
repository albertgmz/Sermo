import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { execute } from "../../operation";
import { profilePostsCreateOp, profilePostsListOp } from "../profiles";
import { cleanFilename, contentDisposition } from "./filename";
import { createStorage, localDriver, operations } from "./index";

function stream(text: string) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

describe("cleanFilename", () => {
  test("keeps ordinary and non-ASCII names", () => {
    expect(cleanFilename("report.pdf")).toBe("report.pdf");
    expect(cleanFilename("  informe económico (final).pdf ")).toBe("informe económico (final).pdf");
    expect(cleanFilename("写真.png")).toBe("写真.png");
  });

  test("drops directories, control and invisible characters", () => {
    expect(cleanFilename("C:\\Users\\me\\a.txt")).toBe("a.txt");
    expect(cleanFilename("../../etc/passwd")).toBe("passwd");
    expect(cleanFilename("a\u0000b\r\n.txt")).toBe("ab.txt");
    expect(cleanFilename("evil\u202egnp.exe")).toBe("evilgnp.exe");
  });

  test("gives nothing for an empty or dotted name, and caps the length", () => {
    for (const name of [null, undefined, "", "   ", ".", "..", "dir/"])
      expect(cleanFilename(name)).toBeNull();
    expect([...(cleanFilename("😀".repeat(300)) ?? "")]).toHaveLength(255);
  });
});

describe("contentDisposition", () => {
  test("puts the name in the header with an ASCII fallback", () => {
    expect(contentDisposition("attachment", "report.pdf", "file-1")).toBe(
      `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`,
    );
    expect(contentDisposition("inline", 'año "x"; (1).png', "file-1")).toBe(
      `inline; filename="a_o _x__ (1).png"; filename*=UTF-8''a%C3%B1o%20%22x%22%3B%20%281%29.png`,
    );
    expect(contentDisposition("attachment", null, "file-7")).toBe(
      `attachment; filename="file-7"; filename*=UTF-8''file-7`,
    );
  });
});

describe("file names on upload", () => {
  test("an upload stores the name, returns it in the metadata and uses it to download", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sermo-filename-"));
    const ctx = createTestContext();
    try {
      const owner = userActor(insertUser(ctx));
      const storage = createStorage(ctx, { driver: localDriver(join(dir, "files")), tempDir: dir });
      const named = await storage.upload(
        owner,
        stream("hello"),
        "text/plain",
        "attachment",
        "../informe económico.txt",
      );
      const unnamed = await storage.upload(owner, stream("hello"), "text/plain");
      expect(storage.get(owner, named.id).filename).toBe("informe económico.txt");
      expect(storage.get(owner, unnamed.id).filename).toBeNull();
      const meta = await execute(ctx, operations[0]!, owner, { fileId: named.id });
      expect(meta.filename).toBe("informe económico.txt");
      const served = storage.serve(owner, named.id);
      expect(served.headers.get("content-disposition")).toBe(
        `attachment; filename="informe econ_mico.txt"; filename*=UTF-8''informe%20econ%C3%B3mico.txt`,
      );
      expect(storage.serve(owner, unnamed.id).headers.get("content-disposition")).toBe(
        `attachment; filename="file-${unnamed.id}"; filename*=UTF-8''file-${unnamed.id}`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("only attachments keep a name: a picture's file name is not stored", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sermo-filename-"));
    const ctx = createTestContext();
    try {
      const owner = userActor(insertUser(ctx));
      const storage = createStorage(ctx, { driver: localDriver(join(dir, "files")), tempDir: dir });
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
        "base64",
      );
      const avatar = await storage.upload(
        owner,
        new Blob([png]).stream(),
        "image/png",
        "avatar",
        "me at home.png",
      );
      expect(storage.get(owner, avatar.id).filename).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("the name is shown on the attachment of the post it belongs to", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sermo-filename-"));
    const ctx = createTestContext();
    try {
      const owner = userActor(insertUser(ctx));
      const storage = createStorage(ctx, { driver: localDriver(join(dir, "files")), tempDir: dir });
      const file = await storage.upload(owner, stream("x"), "text/plain", "attachment", "plan.txt");
      if (owner.kind === "guest") throw new Error("fixture");
      await execute(ctx, profilePostsCreateOp, owner, {
        userId: owner.userId,
        body: "files",
        attachmentIds: [file.id],
      });
      const wall = await execute(ctx, profilePostsListOp, GUEST, {
        userId: owner.userId,
        limit: 5,
      });
      expect(wall.items[0]?.attachments[0]?.filename).toBe("plan.txt");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
