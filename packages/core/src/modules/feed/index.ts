import { postsByAuthorOp, threadsByAuthorOp } from "./authors";
import { threadsFeaturedOp } from "./features";
import { feedListOp, feedNewCountOp } from "./feed";
import { mediaListOp } from "./media";
import { threadsRankedOp } from "./rankings";

export { refreshRankings, registerRankingJobs } from "./rankings";

export const operations = [
  feedListOp,
  feedNewCountOp,
  mediaListOp,
  threadsRankedOp,
  threadsFeaturedOp,
  threadsByAuthorOp,
  postsByAuthorOp,
];
