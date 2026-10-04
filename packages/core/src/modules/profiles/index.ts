import {
  profileCommentsCreateOp,
  profileCommentsDeleteOp,
  profileCommentsGetOp,
  profileCommentsListOp,
  profileCommentsRestoreOp,
  profileCommentsUpdateOp,
} from "./comments";
import {
  profilePostsCreateOp,
  profilePostsDeleteOp,
  profilePostsGetOp,
  profilePostsListOp,
  profilePostsRestoreOp,
  profilePostsUpdateOp,
  profilesGetOp,
  profilesUpdateOp,
  usersSearchOp,
} from "./posts";

export { reactableProfileComment, reactableProfilePost } from "./shared";

export {
  profileCommentsCreateOp,
  profileCommentsDeleteOp,
  profileCommentsGetOp,
  profileCommentsListOp,
  profileCommentsRestoreOp,
  profileCommentsUpdateOp,
  profilePostsCreateOp,
  profilePostsDeleteOp,
  profilePostsGetOp,
  profilePostsListOp,
  profilePostsRestoreOp,
  profilePostsUpdateOp,
  profilesGetOp,
  profilesUpdateOp,
  usersSearchOp,
};

export const operations = [
  profilesGetOp,
  profilesUpdateOp,
  usersSearchOp,
  profilePostsListOp,
  profilePostsGetOp,
  profilePostsCreateOp,
  profilePostsUpdateOp,
  profilePostsDeleteOp,
  profilePostsRestoreOp,
  profileCommentsListOp,
  profileCommentsGetOp,
  profileCommentsCreateOp,
  profileCommentsUpdateOp,
  profileCommentsDeleteOp,
  profileCommentsRestoreOp,
];
