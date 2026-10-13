import { PostSkeleton } from "@/components/forum/skeletons";

// The messages of a conversation while they load: rows in one card, like the posts of a thread.
export function MessagesSkeleton() {
  return (
    <div className="divide-y divide-border overflow-hidden rounded-lg border bg-card">
      <PostSkeleton />
      <PostSkeleton />
      <PostSkeleton />
    </div>
  );
}
