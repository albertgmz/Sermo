import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { prose } from "@/components/forum/prose";
import { stripMarkdownImages } from "@/lib/lite-markdown";
import { cn } from "@/lib/utils";

const components: Components = {
  h1: ({ node, ...props }) => <h3 className={prose.h1} {...props} />,
  h2: ({ node, ...props }) => <h4 className={prose.h2} {...props} />,
  h3: ({ node, ...props }) => <h5 className={prose.h3} {...props} />,
  ul: ({ node, ...props }) => <ul className={prose.ul} {...props} />,
  ol: ({ node, ...props }) => <ol className={prose.ol} {...props} />,
  li: ({ node, ...props }) => <li className={prose.li} {...props} />,
  blockquote: ({ node, ...props }) => (
    <blockquote className={prose.blockquote} {...props} />
  ),
  a: ({ node, href = "", ...props }) => (
    <a
      className={prose.a}
      href={href}
      {...(href.startsWith("/")
        ? {}
        : { target: "_blank", rel: "noreferrer nofollow" })}
      {...props}
    />
  ),
  strong: ({ node, ...props }) => (
    <strong className={prose.strong} {...props} />
  ),
  em: ({ node, ...props }) => <em className={prose.em} {...props} />,
  del: ({ node, ...props }) => <del className={prose.del} {...props} />,
  code: ({ node, className, ...props }) => (
    <code className={cn(prose.code, className)} {...props} />
  ),
  pre: ({ node, ...props }) => (
    <pre
      className={cn(prose.pre, "[&_code]:bg-transparent [&_code]:p-0")}
      {...props}
    />
  ),
  hr: ({ node, ...props }) => <hr className={prose.hr} {...props} />,
};

export function MarkdownContent({
  children,
  className,
  images,
  skipImages = false,
}: {
  children: string;
  className?: string;
  images?: Pick<Components, "img">;
  skipImages?: boolean;
}) {
  return (
    <div className={cn(prose.root, className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{ ...components, ...images }}
        disallowedElements={skipImages ? ["img"] : undefined}
      >
        {skipImages
          ? stripMarkdownImages(children, undefined, undefined, "")
          : children}
      </ReactMarkdown>
    </div>
  );
}
