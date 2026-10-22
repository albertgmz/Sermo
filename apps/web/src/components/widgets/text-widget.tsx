import { HtmlContent } from "@/components/forum/html-content";
import { SectionHeader } from "@/components/forum/section-card";
import { TextSkeleton } from "@/components/forum/skeletons";
import type { WidgetBodyProps } from "@/components/widgets/widget-types";

// A block of the administrator's own text, as the backend rendered it when it was saved. The frame
// has a heading only when the widget was given a title.
export function TextWidget({ widget, title }: WidgetBodyProps<"text">) {
  if (!widget.bodyHtml) return null;
  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      {widget.title !== null && <SectionHeader title={title} />}
      <HtmlContent className="px-4 py-3 text-sm">{widget.bodyHtml}</HtmlContent>
    </section>
  );
}

export function TextWidgetSkeleton() {
  return (
    <div aria-hidden="true" className="rounded-lg border bg-card px-4 py-3">
      <TextSkeleton />
    </div>
  );
}
