import { EditorDemoClient } from "@/app/[locale]/(main)/ui/editor-demo-client";
import { filterLiteMarkdown } from "@/lib/lite-mode";

export async function EditorDemo({ defaultValue }: { defaultValue: string }) {
  return (
    <EditorDemoClient defaultValue={await filterLiteMarkdown(defaultValue)} />
  );
}
