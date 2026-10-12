import { Suspense } from "react";
import type { Components } from "react-markdown";
import { LitePlaceholder } from "@/components/forum/lite-placeholder";
import { MarkdownContent } from "@/components/forum/markdown-content";
import { blocksContentImage } from "@/lib/lite-images";
import { stripMarkdownHtml } from "@/lib/lite-markdown";
import { getLiteOrigin, getLiteState } from "@/lib/lite-mode";

async function MarkdownImage({ alt, ...props }: React.ComponentProps<"img">) {
  const [state, origin] = await Promise.all([getLiteState(), getLiteOrigin()]);
  if (
    blocksContentImage(
      state,
      typeof props.src === "string" ? props.src : "",
      origin,
    )
  ) {
    return <LitePlaceholder className="inline-flex min-h-10 w-full" />;
  }
  // biome-ignore lint/performance/noImgElement: Markdown can contain arbitrary image URLs.
  return <img alt={alt ?? ""} {...props} />;
}

const images: Pick<Components, "img"> = {
  img: ({ node, ...props }) => (
    <Suspense fallback={<span className="inline-block min-h-10 w-full" />}>
      <MarkdownImage {...props} />
    </Suspense>
  ),
};

export async function Markdown(props: {
  children: string;
  className?: string;
}) {
  const [state, origin] = await Promise.all([getLiteState(), getLiteOrigin()]);
  return (
    <MarkdownContent className={props.className} images={images}>
      {stripMarkdownHtml(props.children, state, origin)}
    </MarkdownContent>
  );
}
