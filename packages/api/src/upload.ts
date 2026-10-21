import { PassThrough, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  type Actor,
  type Ctx,
  createStorage,
  requireAuthenticated,
  SermoError,
  type StorageConfig,
  schema,
  uploadLimit,
  ValidationError,
} from "@sermo/core";
import busboy from "busboy";
import { HTTPException } from "hono/http-exception";

const purposes = new Set<string>(schema.FILE_PURPOSES);
type Purpose = (typeof schema.FILE_PURPOSES)[number];

/**
 * Thrown for a non-multipart content type. Carries its own response (the same envelope as the
 * other errors); the app's error handler must return `getResponse()` for status 415.
 */
function unsupportedMediaType(): HTTPException {
  return new HTTPException(415, {
    res: Response.json(
      {
        error: {
          code: "unsupported_media_type",
          message: "Content-Type must be multipart/form-data.",
        },
      },
      { status: 415 },
    ),
  });
}

/** How long a refused upload's remaining body is read for before the connection is given up. */
const DRAIN_MS = 30_000;

/**
 * Reads what is left of a request body and drops it. A browser that is still sending when the
 * answer arrives sees the connection reset, not the answer, so a refusal that comes while a large
 * body is arriving (a size limit, a rejected part) is sent only once the body is in. A body that
 * has not ended by `DRAIN_MS` is cut off.
 */
async function drain(source: Readable): Promise<void> {
  if (source.destroyed || source.readableEnded) return;
  source.unpipe();
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      source.destroy();
      resolve();
    }, DRAIN_MS);
    const finish = () => {
      clearTimeout(timer);
      resolve();
    };
    source.once("end", finish);
    source.once("close", finish);
    source.once("error", finish);
    source.resume();
  });
}

/**
 * Stream one `file` part into storage. The storage upload only sees the end of the file after the
 * whole request has been validated, so a request rejected for any reason (extra part, malformed
 * or truncated body, aborted connection) makes the upload fail and clean up after itself: it is
 * always awaited before this function returns or throws.
 */
export async function uploadMultipart(
  ctx: Ctx,
  actor: Actor,
  request: Request,
  config: StorageConfig,
  purpose: string,
) {
  // A guest is refused before anything about the request is looked at (storage refuses it too).
  requireAuthenticated(actor);
  if (!purposes.has(purpose)) throw new ValidationError("Invalid file purpose.");
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*(?:;|$)/i.test(contentType)) throw unsupportedMediaType();
  if (!request.body) throw new ValidationError("A file is required.");
  let parser: ReturnType<typeof busboy>;
  try {
    parser = busboy({
      headers: { "content-type": contentType },
      // Browsers send file names as raw UTF-8.
      defParamCharset: "utf8",
      limits: {
        files: 2,
        fields: 1,
        parts: 2,
        fileSize: uploadLimit(purpose as Purpose, config.maxBytes) + 1,
      },
    });
  } catch {
    throw new ValidationError("Malformed multipart request.");
  }
  let body = null as PassThrough | null;
  type Stored = Awaited<ReturnType<ReturnType<typeof createStorage>["upload"]>>;
  let upload = null as Promise<{ ok: true; value: Stored } | { ok: false; error: unknown }> | null;
  let storageError: unknown;
  let badShape = false;
  // The error that stopped the upload from our side; storage re-throwing it is not a failure of its own.
  let abortError: Error | undefined;
  const abort = (error: Error) => {
    abortError ??= error;
    body?.destroy(error);
  };
  const reject = () => {
    badShape = true;
    abort(new ValidationError("Exactly one file part is required."));
  };
  parser.on("file", (name, file, info) => {
    file.on("error", () => abort(new ValidationError("Malformed multipart request.")));
    if (name !== "file" || upload) {
      reject();
      file.resume();
      return;
    }
    const source = new PassThrough();
    body = source;
    // The source is ended by the caller once the whole request is known to be well formed.
    file.pipe(source, { end: false });
    upload = createStorage(ctx, config)
      .upload(
        actor,
        Readable.toWeb(source) as ReadableStream<Uint8Array>,
        info.mimeType,
        purpose as Purpose,
        info.filename,
      )
      .then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => {
          storageError = error;
          parser.destroy(error as Error);
          return { ok: false as const, error };
        },
      );
  });
  parser.on("field", reject);
  parser.on("filesLimit", reject);
  parser.on("fieldsLimit", reject);
  parser.on("partsLimit", reject);

  // The parser reads the body through `tap`, so a parser that stops does not take the request's
  // own stream with it: what is left of the body can still be read before the answer.
  const source = Readable.fromWeb(request.body as never);
  const tap = new PassThrough();
  source.once("error", (error) => tap.destroy(error));
  source.once("close", () => {
    if (!source.readableEnded) tap.destroy(new Error("The request was aborted."));
  });
  source.pipe(tap);
  let failure: unknown;
  try {
    await pipeline(tap, parser);
  } catch (error) {
    failure = error;
  }
  if (failure === undefined && !badShape && upload) {
    body?.end();
    const result = await upload;
    if (result.ok) return result.value;
    throw result.error;
  }
  abort(new ValidationError("The upload was rejected."));
  await drain(source);
  if (upload) await upload;
  if (storageError !== undefined && storageError !== abortError) throw storageError;
  if (failure instanceof SermoError) throw failure;
  if (badShape || !upload) throw new ValidationError("Exactly one file part is required.");
  throw new ValidationError("Malformed multipart request.");
}
