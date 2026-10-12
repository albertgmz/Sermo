import type { Socials } from "@/lib/types";
import { cn } from "@/lib/utils";

const PATHS: Record<keyof Socials, string> = {
  discord:
    "M7 5.2c3.2-1.1 6.8-1.1 10 0 2.1 3.1 3.3 6.8 3.1 11.3-1.4 1.2-3 2-4.7 2.5l-1-1.9c-1.6.5-3.2.5-4.8 0l-1 1.9c-1.7-.5-3.3-1.3-4.7-2.5C3.7 12 4.9 8.3 7 5.2Zm2.3 5.3a1.6 1.9 0 1 0 0 3.8 1.6 1.9 0 0 0 0-3.8Zm5.4 0a1.6 1.9 0 1 0 0 3.8 1.6 1.9 0 0 0 0-3.8Z",
  telegram:
    "M21.4 3.3 2.9 10.5c-.9.4-.9 1.2-.1 1.5l4.7 1.5 1.8 5.6c.2.6.7.7 1.2.3l2.6-2.2 4.9 3.6c.6.4 1.2.2 1.4-.6l3.3-15.7c.3-1-.4-1.6-1.3-1.2ZM9.8 14.3l8.3-6.1-6.7 7-.3 3.2-1.3-4.1Z",
  x: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z",
};

export function SocialIcon({
  network,
  className,
}: {
  network: keyof Socials;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      fillRule="evenodd"
      aria-hidden="true"
      className={cn("size-4", className)}
    >
      <path d={PATHS[network]} />
    </svg>
  );
}
