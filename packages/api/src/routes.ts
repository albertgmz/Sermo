import { getOperation } from "@sermo/core";

export type RouteMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export interface ApiRoute {
  method: RouteMethod;
  path: string;
  operation: string;
  status: 200 | 201;
}

const definitions: readonly [RouteMethod, string, string, (200 | 201)?][] = [
  ["GET", "/settings", "settings.get"],
  ["PATCH", "/settings", "settings.update"],
  ["GET", "/files/{fileId}/metadata", "files.get"],
  ["GET", "/me", "auth.me"],
  ["GET", "/groups", "groups.list"],
  ["PATCH", "/groups/{groupId}", "groups.update"],
  ["PUT", "/users/{userId}/group", "users.setGroup"],
  ["GET", "/nodes", "nodes.list"],
  ["POST", "/nodes", "nodes.create", 201],
  ["GET", "/nodes/{nodeId}", "nodes.get"],
  ["PATCH", "/nodes/{nodeId}", "nodes.update"],
  ["GET", "/nodes/{nodeId}/permissions", "permissions.listNode"],
  ["PUT", "/nodes/{nodeId}/permissions/{groupId}", "permissions.setNode"],
  ["GET", "/nodes/{nodeId}/threads", "threads.list"],
  ["POST", "/nodes/{nodeId}/threads", "threads.create", 201],
  ["GET", "/threads/{threadId}", "threads.get"],
  ["PATCH", "/threads/{threadId}", "threads.update"],
  ["PUT", "/threads/{threadId}/sticky", "threads.setSticky"],
  ["PUT", "/threads/{threadId}/lock", "threads.setLocked"],
  ["POST", "/threads/{threadId}/move", "threads.move"],
  ["DELETE", "/threads/{threadId}", "threads.delete"],
  ["POST", "/threads/{threadId}/restore", "threads.restore"],
  ["PUT", "/threads/{threadId}/read", "threads.markRead"],
  ["GET", "/threads/{threadId}/posts", "posts.list"],
  ["POST", "/threads/{threadId}/posts", "posts.create", 201],
  ["GET", "/posts/{postId}", "posts.get"],
  ["PATCH", "/posts/{postId}", "posts.update"],
  ["DELETE", "/posts/{postId}", "posts.delete"],
  ["POST", "/posts/{postId}/restore", "posts.restore"],
  ["GET", "/users", "users.search"],
  ["GET", "/users/{userId}", "profiles.get"],
  ["PATCH", "/profile", "profiles.update"],
  ["GET", "/users/{userId}/profile-posts", "profilePosts.list"],
  ["POST", "/users/{userId}/profile-posts", "profilePosts.create", 201],
  ["GET", "/profile-posts/{profilePostId}", "profilePosts.get"],
  ["PATCH", "/profile-posts/{profilePostId}", "profilePosts.update"],
  ["DELETE", "/profile-posts/{profilePostId}", "profilePosts.delete"],
  ["POST", "/profile-posts/{profilePostId}/restore", "profilePosts.restore"],
  ["GET", "/profile-posts/{profilePostId}/comments", "profileComments.list"],
  ["POST", "/profile-posts/{profilePostId}/comments", "profileComments.create", 201],
  ["GET", "/profile-comments/{commentId}", "profileComments.get"],
  ["PATCH", "/profile-comments/{commentId}", "profileComments.update"],
  ["DELETE", "/profile-comments/{commentId}", "profileComments.delete"],
  ["POST", "/profile-comments/{commentId}/restore", "profileComments.restore"],
  ["GET", "/conversations", "conversations.list"],
  ["POST", "/conversations", "conversations.create", 201],
  ["GET", "/conversations/{conversationId}", "conversations.get"],
  ["GET", "/conversations/{conversationId}/messages", "conversations.listMessages"],
  ["POST", "/conversations/{conversationId}/messages", "conversations.reply", 201],
  ["PUT", "/conversations/{conversationId}/read", "conversations.markRead"],
  ["POST", "/conversations/{conversationId}/leave", "conversations.leave"],
  ["GET", "/reaction-types", "reactionTypes.list"],
  ["POST", "/reaction-types", "reactionTypes.create", 201],
  ["PATCH", "/reaction-types/{reactionTypeId}", "reactionTypes.update"],
  ["GET", "/reactions/{contentType}/{contentId}", "reactions.list"],
  ["PUT", "/reactions/{contentType}/{contentId}", "reactions.set"],
  ["DELETE", "/reactions/{contentType}/{contentId}", "reactions.remove"],
  ["GET", "/search", "search.query"],
];

export const routes: readonly ApiRoute[] = definitions.map(([method, path, operation, status]) => ({
  method,
  path,
  operation,
  status: status ?? 200,
}));

export const routeOperations = routes.map((route) => ({
  route,
  op: getOperation(route.operation),
}));
