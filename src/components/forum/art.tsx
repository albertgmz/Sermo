import { cn } from "@/lib/utils";

// A decorative picture drawn as a background, so it never shifts the layout:
// the caller gives the box its size (an aspect ratio or absolute insets).
export function Art({ src, className }: { src: string; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none bg-cover bg-center", className)}
      style={{ backgroundImage: `url("${src}")` }}
    />
  );
}
