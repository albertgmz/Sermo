import { postsByAuthorOp, threadsByAuthorOp } from "./authors";
import { threadsFeaturedOp } from "./features";
import { feedListOp, feedNewCountOp } from "./feed";
import { mediaListOp } from "./media";
import { threadsRankedOp } from "./rankings";
import { feedDeleteFilterOp, feedHideForumOp, feedOptionsOp, feedSaveFilterOp } from "./saved";

export { refreshRankings, registerRankingJobs } from "./rankings";

export const operations = [
  feedListOp,
  feedNewCountOp,
  feedOptionsOp,
  feedSaveFilterOp,
  feedDeleteFilterOp,
  feedHideForumOp,
  mediaListOp,
  threadsRankedOp,
  threadsFeaturedOp,
  threadsByAuthorOp,
  postsByAuthorOp,
];
