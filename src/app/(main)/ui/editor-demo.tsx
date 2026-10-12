import { EditorDemoClient } from "@/app/(main)/ui/editor-demo-client";
import { stripMarkdownImages } from "@/lib/lite-markdown";
import { liteBlocks } from "@/lib/lite-mode";

export async function EditorDemo({ defaultValue }: { defaultValue: string }) {
  return (
    <EditorDemoClient
      defaultValue={
        (await liteBlocks("postImages"))
          ? stripMarkdownImages(defaultValue)
          : defaultValue
      }
    />
  );
}
