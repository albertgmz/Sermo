// What a forum shows as its own on the forum list: the threads and posts of the forum and of every
// forum under it, and the newest last post among them. Pure and import-free: the web app uses it
// on the node list, which holds only the forums the viewer may open, so a private forum under a
// forum adds nothing for a viewer who cannot open it.
export interface CountedNode {
  id: number;
  threadCount: number;
  postCount: number;
  lastPost: { postedAt: string } | null;
}

export function subtreeTotals<N extends CountedNode>(
  node: N,
  childrenOf: (parentId: number) => N[],
): { threadCount: number; postCount: number; lastPost: N["lastPost"] } {
  let { threadCount, postCount, lastPost } = node;
  for (const child of childrenOf(node.id)) {
    const under = subtreeTotals(child, childrenOf);
    threadCount += under.threadCount;
    postCount += under.postCount;
    if (
      under.lastPost &&
      (!lastPost || Date.parse(under.lastPost.postedAt) > Date.parse(lastPost.postedAt))
    )
      lastPost = under.lastPost;
  }
  return { threadCount, postCount, lastPost };
}
