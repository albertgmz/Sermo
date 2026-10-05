import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  type Actor,
  type Ctx,
  createStorage,
  type StorageConfig,
  ValidationError,
} from "@sermo/core";
import busboy from "busboy";

const purposes = new Set(["attachment", "avatar", "cover", "node_icon", "node_cover"]);

export async function uploadMultipart(
  ctx: Ctx,
  actor: Actor,
  request: Request,
  config: StorageConfig,
  purpose: string,
) {
  if (!purposes.has(purpose)) throw new ValidationError("Invalid file purpose.");
  if (!request.body) throw new ValidationError("A file is required.");
  const parser = busboy({
    headers: { "content-type": request.headers.get("content-type") ?? "" },
    limits: { files: 2, fields: 1, parts: 2, fileSize: (config.maxBytes ?? 25 * 1024 * 1024) + 1 },
  });
  let upload: Promise<Awaited<ReturnType<ReturnType<typeof createStorage>["upload"]>>> | null =
    null;
  let badShape = false;
  parser.on("file", (name, file, info) => {
    if (name !== "file" || upload) {
      badShape = true;
      file.resume();
      return;
    }
    upload = createStorage(ctx, config).upload(
      actor,
      Readable.toWeb(file) as ReadableStream<Uint8Array>,
      info.mimeType,
      purpose as "attachment" | "avatar" | "cover" | "node_icon" | "node_cover",
    );
    upload.catch((error: unknown) => parser.destroy(error as Error));
  });
  parser.on("field", () => {
    badShape = true;
  });
  parser.on("filesLimit", () => {
    badShape = true;
  });
  parser.on("fieldsLimit", () => {
    badShape = true;
  });
  parser.on("partsLimit", () => {
    badShape = true;
  });
  await pipeline(Readable.fromWeb(request.body as never), parser);
  if (badShape || !upload) throw new ValidationError("Exactly one file part is required.");
  return await upload;
}
