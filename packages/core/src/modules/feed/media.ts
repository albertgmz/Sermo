import * as z from "zod";
import { type Ctx, prepared } from "../../context";
import { mediaList } from "../../contracts/feed";
import { implement } from "../../operation";
import { decodeCursor, encodeCursor } from "../../pagination";
import { can, permissionsOf } from "../../permissions";
import { iso } from "../../time";
import type { ThreadRow } from "../forums";
import { fileUrl } from "../storage/url";
import { acceptPosts, acceptWall, type PostCandidate, type WallCandidate } from "./feed";
import { scanKeyset } from "./scan";
import { visibleNodes } from "./viewer";

/** The kinds of file the listing shows: the image types a member may attach. */
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

type Candidate = {
  id: number;
  content_type: "post" | "profile_post";
  content_id: number;
  created_at: number;
};
type FileRow = {
  id: number;
  file_id: number;
  content_type: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  thumbnail_id: number | null;
};
type PostRow = PostCandidate & { position: number };

const columns = "id, content_type, content_id, created_at";

export const mediaSql = {
  /**
   * The newest attachments of one kind: one seek in `attachments_type_id`. Named, because left to
   * itself the planner walks the primary key backwards and filters by kind, which reads every
   * attachment when the kind has none (about 10 ms with 300,000 rows).
   */
  newest: `SELECT ${columns} FROM attachments INDEXED BY attachments_type_id WHERE content_type = ?1 AND id < ?2 ORDER BY id DESC LIMIT ?3`,
  files: `SELECT a.id, f.id AS file_id, f.content_type, f.byte_size, f.width, f.height, thumb.id AS thumbnail_id FROM attachments a JOIN files f ON f.id = a.file_id LEFT JOIN files thumb INDEXED BY files_variant ON thumb.parent_file_id = f.id AND thumb.variant = 'thumbnail' AND thumb.deleted_at IS NULL WHERE a.id IN (SELECT value FROM json_each(?1)) AND f.deleted_at IS NULL AND f.content_type IN (SELECT value FROM json_each(?2))`,
  posts:
    "SELECT id, thread_id, user_id, state, created_at, position FROM posts WHERE id IN (SELECT value FROM json_each(?1))",
  walls:
    "SELECT id, profile_user_id, user_id, state, created_at FROM profile_posts WHERE id IN (SELECT value FROM json_each(?1))",
};

const cursorSchema = z.tuple([z.number().int().positive()]);
const FIRST_PAGE = Number.MAX_SAFE_INTEGER;

function query<Row, Params extends (string | number)[]>(ctx: Ctx, key: keyof typeof mediaSql) {
  return prepared(ctx, `feed.media.${key}`, () => ctx.sqlite.prepare<Row, Params>(mediaSql[key]));
}

export const mediaListOp = implement(mediaList, (ctx, actor, input) => {
  const nodes = visibleNodes(ctx, actor);
  const wallsOpen = can(ctx, actor, "profile.view");
  const threads = new Map<number, ThreadRow>();
  const acceptPost = acceptPosts(ctx, actor, nodes, threads);
  // The file itself is served only where the viewer may see attachments (`forum.viewAttachments`
  // on the forum), so a picture of a forum where they may not is not listed either.
  const permissions = permissionsOf(ctx, actor);
  const acceptWalls = acceptWall(ctx, actor);
  // What `accept` learned about the rows it let through, for building the answer.
  const files = new Map<number, FileRow>();
  const posts = new Map<number, PostRow>();
  const walls = new Map<number, WallCandidate>();

  const { items, next } = scanKeyset<Candidate, number>({
    before: input.cursor ? decodeCursor(input.cursor, cursorSchema)[0] : null,
    limit: input.limit,
    // The two kinds each walk their own index; the newest `count` of both are kept, which is
    // exactly the newest `count` of the union.
    fetch: (before, count) =>
      (["post", "profile_post"] as const)
        .flatMap((type) =>
          query<Candidate, [string, number, number]>(ctx, "newest").all(
            type,
            before ?? FIRST_PAGE,
            count,
          ),
        )
        .sort((x, y) => y.id - x.id)
        .slice(0, count),
    keyOf: (row) => row.id,
    accept: (rows) => {
      // Pictures only, and not a deleted file.
      for (const file of query<FileRow, [string, string]>(ctx, "files").all(
        JSON.stringify(rows.map((row) => row.id)),
        JSON.stringify(IMAGE_TYPES),
      ))
        files.set(file.id, file);
      const pictures = rows.filter((row) => files.has(row.id));
      const ids = (type: Candidate["content_type"]) =>
        JSON.stringify(
          pictures.filter((row) => row.content_type === type).map((row) => row.content_id),
        );
      const postRows = query<PostRow, [string]>(ctx, "posts").all(ids("post"));
      for (const row of postRows) posts.set(row.id, row);
      const wallRows = wallsOpen
        ? query<WallCandidate, [string]>(ctx, "walls").all(ids("profile_post"))
        : [];
      for (const row of wallRows) walls.set(row.id, row);
      const postOk = acceptPost(postRows);
      const wallOk = acceptWalls(wallRows);
      return new Set(
        pictures.filter((row) => {
          if (row.content_type === "post") {
            const post = posts.get(row.content_id);
            const thread = post && threads.get(post.thread_id);
            return (
              post !== undefined &&
              thread !== undefined &&
              postOk.has(post) &&
              permissions.can("forum.viewAttachments", { nodeId: thread.node_id })
            );
          }
          const wall = walls.get(row.content_id);
          return wall !== undefined && wallOk.has(wall);
        }),
      );
    },
  });

  return {
    items: items.map((row) => {
      const file = files.get(row.id)!;
      const base = {
        id: row.id,
        createdAt: iso(row.created_at),
        file: {
          fileId: file.file_id,
          url: fileUrl(file.file_id),
          contentType: file.content_type,
          byteSize: file.byte_size,
          width: file.width,
          height: file.height,
          thumbnailUrl: file.thumbnail_id === null ? null : fileUrl(file.thumbnail_id),
        },
      };
      if (row.content_type === "post") {
        const post = posts.get(row.content_id)!;
        return {
          type: "post" as const,
          ...base,
          postId: post.id,
          position: post.position,
          threadId: post.thread_id,
          threadTitle: threads.get(post.thread_id)!.title,
        };
      }
      const wall = walls.get(row.content_id)!;
      return {
        type: "profilePost" as const,
        ...base,
        profilePostId: wall.id,
        profileUserId: wall.profile_user_id,
      };
    }),
    nextCursor: next === null ? null : encodeCursor([next]),
  };
});
