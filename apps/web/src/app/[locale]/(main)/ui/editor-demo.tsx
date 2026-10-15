import { EditorDemoClient } from "@/app/[locale]/(main)/ui/editor-demo-client";
import { filterLiteBbCode } from "@/lib/lite-mode";

export async function EditorDemo({ defaultValue }: { defaultValue: string }) {
  return (
    <EditorDemoClient defaultValue={await filterLiteBbCode(defaultValue)} />
  );
}
