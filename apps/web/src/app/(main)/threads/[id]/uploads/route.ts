import { getTranslations } from "next-intl/server";
import { parseId } from "@/lib/sermo/ids";
import { receiveUpload, type UploadRefusal } from "@/lib/sermo/upload";
import { megabytes } from "@/lib/sermo/upload-limit";

const failure = (error: string, status: number) =>
  Response.json(
    { error },
    { status, headers: { "Cache-Control": "no-store" } },
  );

// Takes one file for a post and hands it on to the backend as the visitor, through the same
// `receiveUpload` as the other upload routes: it streams the body, never reads it here, and
// refuses before reading when there is no session cookie, the origin is not this site's, the
// body is not multipart or its declared length is missing or above the ceiling. A file does not
// go through a server action, whose body the app would have to allow at a large size. The answer
// is the id the backend stored the file under, which the post then names when it is saved.
//
// The segment is called id like its siblings, but names the forum the post is for. It is only
// checked for its shape: the backend's files endpoint cannot tell which forum a file is for, so
// whether the visitor may attach files there (`forum.uploadAttachments`) is checked by the
// operations that save the post, which name the attachments, and not here.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const t = await getTranslations("threads.uploads");
  if (parseId((await params).id) === null) return failure(t("notFound"), 404);
  const received = await receiveUpload(request, "attachment");
  if (received.ok) {
    return Response.json(
      { id: received.fileId },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  const words: Record<UploadRefusal, string> = {
    session: t("signIn"),
    origin: t("notAllowed"),
    type: t("noFile"),
    length: t("noFile"),
    size:
      received.limit === undefined
        ? t("tooLarge")
        : t("overLimit", { size: megabytes(received.limit) }),
    refused: received.message ?? t("failed"),
    failed: t("failed"),
  };
  return failure(words[received.reason], received.status);
}
