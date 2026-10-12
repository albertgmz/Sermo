import { EditorDemoClient } from "@/app/(main)/ui/editor-demo-client";
import { isLiteMode } from "@/lib/lite-mode";

export async function EditorDemo({ defaultValue }: { defaultValue: string }) {
  return (
    <EditorDemoClient lite={await isLiteMode()} defaultValue={defaultValue} />
  );
}
