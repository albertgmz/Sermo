# Administering Sermo

This guide is for forum operators. It explains how Sermo decides what each member may do, which
tools moderators have, and how notifications, email and Web Push behave, with the REST API call
(under `/api/v1`) and the operation name for each task. MCP clients call the same operations as
tools, with dots replaced by underscores (`users.setGroups` becomes `users_setGroups`). Every
operation is listed with its request and response schemas in `/api/v1/openapi.json`. Server
installation and configuration are in the [README](../README.md).

## Groups

Every member has one **primary group** and any number of **secondary groups**. Guests (visitors
who are not signed in) belong to the built-in Guest group.

| Group | Id | Rank | Notes |
| --- | --- | --- | --- |
| Guest | 1 | 0 | Visitors. Never receives permissions that need an account. |
| Unconfirmed | 5 | 1 | New members until they confirm their email address, when `SERMO_MAIL_DRIVER` is `capture` or `smtp`. By default they can read, report, and edit or delete their own content, but cannot start threads, reply, react, post on profiles or start conversations, and their upload quota is 0. |
| Member | 2 | 10 | Registered members. |
| Moderator | 3 | 50 | Global moderators. |
| Administrator | 4 | 100 | Administrators. |

Built-in groups can be renamed but not deleted. Renaming is rank-checked like any other group
change, so with the default ranks nobody can rename Administrator. You can create as many other groups as you need,
for example "Veterans", "Helpers" or "Sponsors". Group management needs `admin.groups`:

| Task | REST | Operation |
| --- | --- | --- |
| List groups, highest rank first | `GET /groups` | `groups.list` |
| Create a group (it starts with no permission entries) | `POST /groups` | `groups.create` |
| Rename, re-rank, set user title or badge | `PATCH /groups/{groupId}` | `groups.update` |
| Delete a custom group | `DELETE /groups/{groupId}` | `groups.delete` |

Deleting a group moves members whose primary group it was to Member, and removes its secondary
memberships, promotion grants, permission entries and its place in promotions.

A group's **rank** decides only two things:

- **Display.** A member shows the user title and badge of their highest-ranked group
  (`displayGroup` on profiles and `auth.me`).
- **Hierarchy.** See [Who can act on whom](#who-can-act-on-whom). Nobody can create, edit, delete
  or assign a group ranked at or above their own highest rank.

Rank never changes what a member is allowed to do. That comes only from permissions.

Read a member's groups with `GET /users/{userId}/groups` (`users.getGroups`) and change them with
`PUT /users/{userId}/groups` (`users.setGroups`): the primary group and/or the full list of
hand-assigned secondary groups. Both need `admin.members` over the member. The Guest group cannot
be assigned. Groups granted by promotions are listed separately and managed by promotions.

## Permissions

`GET /permissions/definitions` (`permissions.definitions`) lists every permission with its id,
whether it applies globally or per node, whether it is a yes/no permission or a number, its
category, its defaults and its conditions. Examples:

- `node.view`: see a node and its content.
- `forum.createThread`, `forum.reply`: post in a forum.
- `forum.editOwn` with `forum.editOwnTimeLimit` (minutes, -1 for no limit): edit your own posts.
- `forum.deleteAny`, `forum.approve`, `forum.lock`, `forum.move`: moderation in a forum.
- `attachment.storageQuota` (bytes, -1 for unlimited), `conversation.maxRecipients`,
  `mention.maxPerItem`: limits.
- `admin.groups`, `admin.members`, `admin.permissions`, `admin.settings`, `admin.nodes`,
  `admin.promotions`, `admin.announcements`, `admin.reactionTypes`: administration, each
  separate.

All permission operations need `admin.permissions`.

### Values

A yes/no permission is set per group (or per member) to one of:

- **unset** (no entry): this group says nothing.
- **allow**: this group grants it.
- **never**: denies it for every member of the group, whatever their other groups say.
- **no** (on nodes only): cancels an `allow` or a `never` this group inherited from a parent
  node, without blocking the member's other groups.

A member's result combines all their groups: if any group says **never**, the answer is no;
otherwise if any group says **allow**, the answer is yes; otherwise no. Rank and order do not
matter.

A number permission takes the **highest** value among the member's groups; -1 means unlimited
and beats every number. A group with no value contributes nothing; a member with no value at all
gets 0. A banned member gets 0.

### Global and node scopes

Global permissions (posting on profiles, starting conversations, reacting, administration) are
set once per group. Node permissions (viewing, posting, editing, moderating in forums) can also be
set on any category or forum and are inherited by everything beneath it. For each group, the
nearest setting wins: the node itself, then its parent, and so on up to the global setting.

Two rules hold everywhere: nothing in a node is allowed without `node.view` there, and a node is
only visible if its parent is.

Set entries with `PUT /permissions/entries` (`permissions.set`), giving a group or a member, an
optional node, and a list of `{ permission, value }` (use `unset` to remove an entry). Read them
back with `GET /permissions/entries` (`permissions.list`, one group or member, one scope) or
`GET /nodes/{nodeId}/permissions` (`permissions.listNode`, everything set directly on a node).
Changing entries is not rank-checked: anyone with `admin.permissions` can change the entries of
any group, including higher-ranked ones.

### Member-specific entries

An entry can target a single member instead of a group. This is how one person becomes the
moderator of one forum (see [Node moderators](#node-moderators-and-node-rules)). A member-specific
`never` also works, for example to stop one member using one feature.

### Conditions that are always applied

- **Bans and restrictions come first.** A banned member can do nothing. A restricted member
  loses the matching permissions until the restriction expires or is lifted, whatever their
  groups allow (see [Restrictions](#restrictions)).
- **Guests** never have permissions that need an account (posting, reacting, moderating),
  whatever the Guest group's entries say, and `permissions.set` refuses to give them one.
- **Own content** permissions apply only to the member's own content, and the edit window
  (`forum.editOwnTimeLimit`) counts from the content's creation.
- **Thread bans** stop one member replying in one thread.

### Finding out why

`GET /permissions/explain` (`permissions.explain`) answers "may this member do this here?" and
shows, for each of the member's groups (and their member-specific entries), the entry that decided
it and the node it is set on, plus any ban, restriction or condition that overrode the entries.
Use it whenever a result surprises you.

### Keeping control

Sermo refuses to delete a group, change a member's groups, or change `admin.permissions` entries
when the change would leave no active (not banned) member with `admin.permissions`. Bans are not
checked this way, so take care when banning administrators.

Responses that describe the current member (`auth.me`, `nodes.get`, `threads.get`) include
`resolvedPermissions`, the member's permissions for that context, so clients can hide controls;
the server checks every action anyway.

## Promotions

Promotions add secondary groups automatically while a member meets criteria, and remove them
when the member no longer does. They need `admin.promotions`:

| Task | REST | Operation |
| --- | --- | --- |
| List the available criteria | `GET /promotions/criteria` | `promotions.criteria` |
| List, read | `GET /promotions`, `GET /promotions/{promotionId}` | `promotions.list`, `promotions.get` |
| Create, change, delete | `POST /promotions`, `PATCH`/`DELETE /promotions/{promotionId}` | `promotions.create`, `promotions.update`, `promotions.delete` |
| Evaluate everyone now | `POST /promotions/run` | `promotions.run` |
| One member's status | `GET /users/{userId}/promotions` | `promotions.memberStatus` |
| Change one member by hand | `PUT /users/{userId}/promotions/{promotionId}` | `promotions.apply` |
| History | `GET /promotions/log` | `promotions.log` |

| Criterion | Value |
| --- | --- |
| `post_count` | at least this many posts |
| `days_registered` | registered at least this many days ago |
| `reaction_score` | at least this reaction score |
| `email_verified` | 1: must have confirmed their email; 0: must not have |
| `has_avatar` | 1: must have an avatar; 0: must not have |
| `active_within_days` | visited within this many days |
| `inactive_days` | has not visited for at least this many days (or never) |
| `warning_points_below` | active (unexpired) warning points strictly below this |

All criteria of a promotion must hold. Members are evaluated right after relevant activity (a new
post, thread, profile post or comment, a received reaction, a warning, a profile change such as a
new avatar, an administrator changing their groups) and by a daily sweep over everyone;
`promotions.run` starts a sweep immediately.

Promotions never touch a member's primary group or the groups you assigned by hand. If you also
assigned a promoted group by hand, the member keeps it when the promotion no longer applies. A
promotion cannot grant the Guest group, nor a group ranked at or above your own.

Per member and promotion (`promotions.apply`, which also needs `admin.members` over the member):

- **promote** grants the promotion's groups and keeps them whatever the criteria say;
- **demote** and **exempt** remove them and keep the member out of that promotion;
- **reset** returns the member to automatic evaluation, which runs immediately.

Every automatic and manual change is recorded in `promotions.log`. A group change takes effect
immediately, and when the member's groups actually change they get a `member.groups`
notification.

## Moderation tools

### Who can act on whom

Actions aimed at a member are rank-checked: your highest group rank must be **strictly above**
the member's. This covers warnings, bans, restrictions, spam cleanup, thread bans, reading or
changing a member's groups, and applying promotions by hand. So a moderator cannot warn another
moderator or themselves, and an administrator cannot ban another administrator. Content
moderation (deleting, approving, editing posts) is not rank-checked.

### Default holders

| Permission | What it allows | Default |
| --- | --- | --- |
| `forum.manageReports`, `forum.approve`, `forum.deleteAny`, `forum.undelete`, `forum.editAny`, `forum.viewModerated`, `forum.viewDeleted`, `forum.viewHistory`, `forum.lock`, `forum.replyLocked`, `forum.stick`, `forum.move`, `forum.merge`, `forum.split`, `forum.threadBan`, `forum.bypassNodeRules`, `forum.viewLog` | Moderation inside a node (and the nodes beneath it) | Moderator, Administrator |
| `profilePost.approve`, `profilePost.deleteAny`, `profilePost.undelete`, `profilePost.editAny`, `profilePost.viewModerated`, `profilePost.viewDeleted` | Moderating profile posts and comments | Moderator, Administrator |
| `report.manageProfiles` | Handling reports on profile content and on members | Moderator, Administrator |
| `member.warn`, `member.restrict`, `warning.view` | Warnings and restrictions; reading anyone's warnings and restrictions | Moderator, Administrator |
| `profile.bypassPrivacy` | Seeing and posting on profiles whatever their privacy settings | Moderator, Administrator |
| `wordFilter.view` | Listing word filters | Moderator, Administrator |
| `moderation.access` | Marks the member as a moderator in `auth.me` (`isModerator`) so clients can show the queues | Moderator, Administrator |
| `member.ban`, `member.spamCleanup` | Global bans and spam cleanup | Administrator |
| `conversation.moderate`, `conversation.viewHidden` | Moderating private conversation messages and their reports; seeing hidden messages there | Administrator |
| `wordFilter.manage`, `moderatorLog.view` | Managing word filters; reading the whole moderator log | Administrator |
| `member.immuneToAutoBan` | Held by the warned member: reaching the warning threshold does not ban them | Administrator |

Most moderation calls accept `notify` (default `true`) and an optional `message` (up to 1,000
characters) for the member the action concerns, plus a `reason` that goes into the moderator log.
With `notify`, the member gets a `moderation.content` notification (content actions) or a
`moderation.member` notification (warnings, restrictions, thread bans). Bans are announced only
by the ban email.

### Reports

Members report content or a member with `POST /reports` (`reports.create`, needs
`report.create`): a post, profile post, profile comment, conversation message or user, with a
reason. Reports on the same target are grouped. Any new report sets its group back to `open` and
clears the assignment, even if the group was assigned, resolved or rejected. When a group opens, a `moderator.report` notification goes to those who can
handle it or approve content there (`forum.manageReports` or `forum.approve` on the node for posts,
`report.manageProfiles` or `profilePost.approve` for profile content and members,
`conversation.moderate` for conversation messages).

| Task | REST | Operation |
| --- | --- | --- |
| The queue (state `open` by default; `nodeId` for one forum) | `GET /reports` | `reports.list` |
| One group with its reports | `GET /reports/{groupId}` | `reports.get` |
| Assign, resolve or reject | `PUT /reports/{groupId}/state` | `reports.setState` |
| Read a reported conversation message | `POST /reports/{groupId}/conversation-message` | `reports.viewConversationMessage` |

The queue is open to every signed-in member but shows each group only to those who may handle
it: `forum.manageReports` on the node for posts, `report.manageProfiles` for profile content and
members, `conversation.moderate` for conversation messages. A page can be short and still carry a
`nextCursor`. A group can be assigned only to someone who may handle it. Resolving or rejecting
with `notify` tells the reporters (`report.resolved`).

**Conversation message reports.** Only an active participant can report a message. A moderator
with `conversation.moderate` reads it with `reports.viewConversationMessage`, which returns the
reported message with up to three messages before and after it (hidden ones only with
`conversation.viewHidden`). Every call is written to the moderator log; nothing else lets a
non-participant read a conversation.

### Approval queue

New content waits for approval (state `moderated`) when any of the following holds. Word filters
and the new-member link rule also run when content is edited: an edit that trips them sends
visible content back to the queue.

- a word filter with the `moderate` action matches it;
- the author has fewer forum posts than `firstPostsToModerate` (forum posts only; default 0, off);
- it contains a link, the author joined less than `newMemberDays` ago (default 7) and
  `moderateLinksFromNewMembers` is on (default off);
- the forum requires approval of new threads or replies (see
  [node rules](#node-moderators-and-node-rules)).

The settings above are changed with `PATCH /settings` (`settings.update`, needs `admin.settings`).
Word filters are managed with `GET /moderation/word-filters` (`wordFilters.list`,
`wordFilter.view`), `PUT /moderation/word-filters` (`wordFilters.upsert`) and
`DELETE /moderation/word-filters/{filterId}` (`wordFilters.remove`), both needing
`wordFilter.manage`. A `replace` filter rewrites the term in new and edited content; a `moderate`
filter holds new content for approval and sends edited visible content back to the queue.

`GET /approval-queue` (`approvals.list`) lists waiting threads, posts, profile posts, comments and
conversation messages, newest first, each shown only to those who can approve it
(`forum.approve` on the node, `profilePost.approve`, or `conversation.moderate`). `nodeId` limits
it to one forum. Those who can approve are notified (`moderator.approval`) when new content enters
the queue; edited content sent back to the queue notifies nobody.

### Changing content state

- `PUT /moderation/state` (`moderation.setState`): set a thread, post, profile post, comment or
  conversation message to `visible`, `moderated` or `deleted`. Deleting needs the delete-any
  permission (`forum.deleteAny`, `profilePost.deleteAny`), bringing back deleted content needs the
  undelete permission, and other changes need the approve permission; conversation messages need
  `conversation.moderate`. A thread's first post follows its thread: change the thread instead.
- `POST /moderation/bulk` (`moderation.bulk`): `delete`, `restore`, `approve`, `move`, `lock` or
  `unlock` up to 100 items at once. `move`, `lock` and `unlock` take threads only; `move` needs
  `forum.move` on the destination forum (`nodeId`) and on each thread's forum. If any item fails,
  nothing changes.
- Per thread: `PUT /threads/{threadId}/sticky` (`forum.stick`), `PUT /threads/{threadId}/lock`
  (`forum.lock`), `POST /threads/{threadId}/move` (`forum.move` on both forums). Replying in a
  locked thread needs `forum.replyLocked`.
- `GET /posts/{postId}/revisions` (`postRevisions.list`, `forum.viewHistory`) shows earlier bodies
  of an edited post.

Nothing is removed for good: deleted content stays visible to those with the view-deleted
permission and can be restored.

### Moderator log

Moderation and administration actions are appended to the moderator log. Entries are never
removed; moving a thread updates the node its entries are filed under, so they follow the thread. `GET /moderation/log` (`moderatorLog.list`) returns everything to holders of
`moderatorLog.view`, and otherwise the entries of nodes where the reader has `forum.viewLog`;
`nodeId` limits it to one node. Ban and restriction entries carry the ban or restriction id in
`details`.

### Warnings

`POST /users/{userId}/warnings` (`warnings.create`, `member.warn` over the member) gives 1 to 1,000
points with a reason and an optional expiry. The response returns the member's active points (the
sum of unexpired warnings). When `warningBanThreshold` is above 0 (default 0, off) and the active
points reach it, the member is banned for `warningBanDays` (default 7), unless they hold
`member.immuneToAutoBan`. `GET /users/{userId}/warnings` (`warnings.list`) shows a member's
warnings to themselves and to holders of `warning.view`.

### Bans

`POST /users/{userId}/bans` (`bans.create`, `member.ban` over the member) bans with a reason and
`expiresAt` (a future time, or `null` for a permanent ban). You cannot ban yourself. A banned
member is refused on every request and has no permissions; their sessions and API keys are revoked
in the background. Lift a ban with `POST /bans/{banId}/lift` (`bans.lift`, `member.ban`); the ban id
is returned by `bans.create` and recorded in the moderator log. When email is enabled the member
gets a ban email (see [Account emails](#account-emails)).

### Restrictions

A restriction is lighter than a ban. `POST /users/{userId}/restrictions`
(`restrictions.create`, `member.restrict` over the member) takes a kind, a reason and an optional
expiry:

| Kind | Denies |
| --- | --- |
| `posting` | `forum.createThread`, `forum.reply` |
| `conversations` | `conversation.start` (replies in existing conversations still work) |
| `profile_posts` | `profilePost.post`, `profilePost.comment` |

Lift one with `POST /restrictions/{restrictionId}/lift` (`restrictions.lift`). List a member's
restrictions with `GET /users/{userId}/restrictions` (`restrictions.list`): the member themselves,
or holders of `warning.view`.

### Spam cleanup

`POST /users/{userId}/spam-cleanup` (`spamCleanup.start`, `member.spamCleanup` over the member, not
yourself) bans the member permanently at once, then deletes their threads, replies, profile posts,
comments and conversation messages in the background, 100 at a time. Deleted items can be
restored like any other deleted content. A second cleanup for the same member is refused while
the first one's initial job is still pending. Content in a thread that is being merged or split is
skipped: the cleanup waits up to a day for a pending merge or split to finish, then logs
`spam.cleanup.skipped` and leaves that content alone; content in a merge or split that has failed
is skipped at once.

### Thread bans

`POST /threads/{threadId}/bans` (`threadBans.create`, `forum.threadBan` on the thread's forum over
the member) stops one member replying in one thread, with a reason and an optional expiry.
`GET /threads/{threadId}/bans` (`threadBans.list`) lists active bans and
`DELETE /threads/{threadId}/bans/{userId}` (`threadBans.lift`) lifts one; both need
`forum.threadBan`. Splitting a thread copies its active thread bans to the new thread.

### Thread merge and split

- `POST /threads/{threadId}/merge` (`threads.merge`) merges up to 10 source threads into the
  target. It needs `forum.merge` on the target's forum and on each source's forum. The posts are
  interleaved by creation time and the target's first post stays first. Each source thread keeps
  resolving to the target.
- `POST /threads/{threadId}/split` (`threads.split`) moves posts (`postIds`, up to 500, or every
  post from `fromPosition` on) into a new thread with `title` in the forum `nodeId`. It needs
  `forum.split` on both forums. The first post cannot move.

Small merges and splits finish in the request. Large ones (over 500 posts, or over 500 related
rows such as read markers, watches, thread bans or unread notifications) finish in the background:
the response has `completed: false`. While one is in progress, replies and moderation in the
threads involved are refused with "This thread is being reorganized; try again shortly". The
background jobs retry on failure; if they still fail after five attempts, repeat the same merge or
split request to resume it.

### Node moderators and node rules

`PUT /nodes/{nodeId}/moderators/{userId}` (`nodes.setModerator`, needs `admin.permissions`) makes a
member moderator of a node and everything beneath it: it sets member-specific `allow` entries on
that node for every node moderation permission listed in [Default holders](#default-holders).
Send `{ "remove": true }` to take them away. A node moderator works their own queues through the
normal report, approval and log calls, which filter by node.

Each forum has posting rules, set in `settings` with `POST /nodes` (`nodes.create`) or
`PATCH /nodes/{nodeId}` (`nodes.update`), both needing `admin.nodes`:

| Rule | Effect |
| --- | --- |
| `requireThreadApproval` | New threads wait for approval. |
| `requireReplyApproval` | New replies wait for approval. |
| `isReadOnly` | Nobody can start threads or reply. |
| `minAccountAgeDays` | Accounts younger than this cannot post here. |
| `minPostCount` | Members with fewer posts cannot post here. |

Members with `forum.bypassNodeRules` on the node are exempt from all of them.

### Profile privacy

Members choose who sees their profile (`profileViewPrivacy`: `everyone`, `members`, `followed`
for members they follow, or `self`) and who may post on it (`profilePostPrivacy`: `members`,
`followed` or `self`) with `PATCH /me/preferences` (`preferences.update`). Holders of
`profile.bypassPrivacy` see and post on every profile. A profile hidden by privacy looks the same
as a missing one. Turning off the site setting `profilePostsEnabled` (default on) stops new
profile posts and comments for everyone, including holders of `profile.bypassPrivacy`; existing
ones stay visible.

## Notifications

Members read notifications with `GET /notifications` (`notifications.list`, optionally
`unreadOnly`), which also returns their unread count. Every `notifications.*` call needs
`notification.view` (every signed-in group by default), except `notifications.unsubscribe`, which
is authorized by its signed token. `announcements.create` needs `admin.announcements`.

### Types

`GET /notifications/types` (`notifications.types`) lists every type with its current defaults.

| Type | Sent to |
| --- | --- |
| `thread.watched` | Members watching the thread, on a new reply |
| `node.thread`, `node.post` | Members watching the forum: a new thread (`node.thread`) and, in `posts` mode, every reply (`node.post`) |
| `content.quoted` | The author of a quoted post |
| `content.mentioned` | A mentioned member |
| `content.reaction` | The author of the content that received a reaction |
| `profile.post` | The profile owner, on a new profile post |
| `profile.comment`, `profile.commented` | The profile post's author, and earlier commenters, on a new comment |
| `member.thread` | Followers, when the member starts a thread |
| `member.followed` | A member who gained a follower |
| `conversation.added`, `conversation.message` | Conversation participants |
| `moderation.content`, `moderation.member` | A member whose content or account a moderator acted on (with `notify`) |
| `report.resolved` | Reporters, when their report is resolved or rejected (with `notify`) |
| `moderator.report`, `moderator.approval` | Moderators who can handle a new report or approve new content |
| `member.groups` | A member whose groups changed (not when email confirmation moves them to Member) |
| `announcement` | Every member, for `POST /announcements` (`announcements.create`, needs `admin.announcements`) |
| `account.security` | Reserved: email only and cannot be turned off. Nothing creates it in this release; account emails are sent separately (see [Account emails](#account-emails)). |

Nobody is notified of their own action or of content they cannot see. A member who ignores
someone is not notified of that member's actions, except for moderator duty notices; staff
cannot be ignored (they lack `member.ignorable` by default), so their actions always notify.

### Channels and preferences

Each type has three channels: in-app, email and push. Out of the box every type is in-app only,
except `account.security`, which is email only, and the watch types described below. Members
change their own choice per type and channel with `GET`/`PUT /notifications/preferences`
(`notifications.preferences`, `notifications.setPreferences`); `null` returns a channel to the
site default.

When the background fan-out creates a notification, it also queues an email and a push message
for each member who has that channel on. Email needs a mail driver other than `none`; push needs
Web Push configured and a registered device. Rules:

- **In-app comes first.** A member who turns in-app off for a type gets no notification of that
  type, and so no email or push for it either.
- **Once per unread group.** A grouped notification (see below) sends one email and one push
  message. Further replies or reactions folded into it while it is unread do not send again.
- **Watch types** (`thread.watched`, `node.thread`, `node.post`): the watch's own email flag
  decides (`PUT /threads/{threadId}/watch`, `PUT /nodes/{nodeId}/watch` with `email`, or the
  `watch_email` auto-watch preferences), unless the member turned that type's email off in their
  preferences. A thread watch takes precedence over a watch on its forum.
  `notifications.types` reports email as on for these types.
- At sending time an email is skipped if the member has already read the notification, can no
  longer see the content, or has an undeliverable address.

Change the site defaults with `PATCH /settings` and the `notificationDefaults` setting: a map from
type id to `{ "inApp": …, "email": …, "push": … }` (all three required). It replaces the previous
map; types not in it use the built-in defaults. Members' own choices always win.
`account.security` ignores this setting, and an `email` value for a watch type has no effect.
The weekly digest uses the type id `digest.weekly` here (email on by default).

### Grouping, reading and retention

- **Grouping.** Reactions to the same item, and new replies in the same watched thread, fold into
  one unread notification that shows the most recent actors (up to five) and how many different
  members acted.
  Once read, the next one starts a new notification.
- **Mark read.** `PUT /notifications/read` (`notifications.markRead`) takes up to 100 `ids`, or
  `{ "all": true }`, which sets the unread count to zero at once and marks older rows in the
  background.
- **Retention.** Every hour, notifications that were read more than `notificationRetentionDays`
  ago (default 90) are deleted. Unread notifications are kept.

## Email

### Configuration

Email is configured with environment variables (details in the README and `.env.example`):

| Variable | Purpose |
| --- | --- |
| `SERMO_MAIL_DRIVER` | `none` (default), `capture` or `smtp` |
| `SERMO_MAIL_FROM` | Sender address; required for `smtp` |
| `SERMO_MAIL_REPLY_TO` | Optional reply-to address |
| `SERMO_SMTP_HOST`, `SERMO_SMTP_PORT` | SMTP server; host required for `smtp`, port defaults to 587 |
| `SERMO_SMTP_SECURE` | `true` for TLS on connect (usually port 465); default `false` |
| `SERMO_SMTP_REQUIRE_TLS` | Override of the STARTTLS rule below |
| `SERMO_SMTP_USER`, `SERMO_SMTP_PASSWORD` | Optional SMTP credentials |
| `SERMO_SITE_URL` | Origin used in email links; must be HTTPS with `smtp` unless it is a loopback address |

The drivers:

- **`none`**: no email. Registration goes straight to Member, and email change and password reset
  are not available.
- **`capture`**: messages are kept in memory and never delivered. For development only: accounts
  join Unconfirmed and nobody receives the confirmation link.
- **`smtp`**: delivery through your SMTP server.

**STARTTLS.** With `SERMO_SMTP_SECURE=false`, Sermo requires STARTTLS and refuses to send in plain
text, unless the SMTP host is loopback (`localhost`, `127.0.0.0/8`, `::1`). Set
`SERMO_SMTP_REQUIRE_TLS=false` only for a plain-text relay on a private network, such as a sidecar
container; `true` forces STARTTLS even for loopback.

Emails use the site name from the `siteName` setting and the member's language (English or
Spanish; otherwise `defaultLanguage`).

### Deliverability

- Use a dedicated sending domain and set up SPF, DKIM, DMARC and reverse DNS with your SMTP
  provider. Sermo does not sign messages itself.
- **Unsubscribe.** Notification emails and digests carry `List-Unsubscribe` and
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers (RFC 8058) and two links in the
  footer: one for that type, one for every type. Account emails and `account.security` emails
  never have them. Opening a link
  shows a confirmation page; mail clients' one-click requests unsubscribe directly
  (`POST /unsubscribe`, `notifications.unsubscribe`). Links are signed with a key derived from
  `BETTER_AUTH_SECRET`, tied to the member's address and valid for one year; changing the secret
  or the address invalidates them. "Every type" stores an explicit "email off" preference for each
  email type registered at that moment: every notification type except `account.security`, plus
  `digest.weekly`. Types added later follow the site defaults until the member changes them.
- **Suppression.** An address is marked undeliverable (table `undeliverable_emails`) only when the
  server refuses it at `RCPT TO` with 550, 551 or 553 and an enhanced status of 5.1.x or 5.2.1. A
  bare 550 (for example "Relaying denied") is not enough. Sermo sends nothing more to an
  undeliverable address; delete its row to allow sending again. Only refusals during the SMTP
  conversation are seen: bounces that arrive later are not processed.
- **Failures.** Every failed send is recorded in `email_failures` (member, address, template,
  error text, whether it was permanent, time). Watch this table and your provider's reports.

**Hourly cap.** Each member receives at most `emailHourlyCap` notification emails per hour
(default 20; 0 turns notification emails off). Emails over the cap are dropped, not delayed.
`account.security` emails, account emails and digests are never counted.

Conversation notification emails include the message text only when the
`conversationEmailIncludesBody` setting is on (default off).

### Weekly digest

Every Monday at 04:00 UTC Sermo emails a digest to members who:

- have not visited for at least `digestInactiveDays` (default 3) and had no digest in the last six
  days;
- are not banned and whose address is not undeliverable;
- have digest email on (`digest.weekly` in `notificationDefaults`, or their unsubscribe choice).

It lists up to ten visible threads, in forums the member can see, with posts in the last seven
days that are newer than the member's last visit or digest. A member with nothing new gets no
digest. Digests go out in small batches. If the server cannot connect, cannot authenticate, gets a
temporary (4xx) reply, or refuses the sender by policy (5.7.x, for example a DMARC failure), the
digest resumes later from the same member; a connection failure that persists for one member
skips that member after five attempts, and a policy refusal that persists stops the digest. A
member whose own address or message is refused is recorded and skipped.

### Crashes and shutdown

Notification emails and digests are marked as sent just before they are handed to the SMTP
server. If the process crashes or is killed in between, that email is lost (up to five members of
the digest batch being sent miss that week's digest). Account emails are not marked this way, so
after a crash one may be sent twice. A graceful stop (`SIGTERM`, `docker compose stop`) stops taking new jobs
and waits up to 30 seconds for the job in progress before closing the mail connection.

### Account emails

When the mail driver is `capture` or `smtp`, Better Auth sends these through Sermo's mailer:

- **Verification.** New accounts join the Unconfirmed group and receive a confirmation link
  (`POST /api/auth/send-verification-email` sends it again). Following it moves an account whose
  primary group is still Unconfirmed to Member and sends a welcome email. Accounts that existed
  before email was enabled keep their groups.
- **Password reset.** `POST /api/auth/request-password-reset` with `email` and `redirectTo`. The
  `redirectTo` URL must be on a trusted origin (`BETTER_AUTH_URL` or `SERMO_TRUSTED_ORIGINS`).
  A completed reset signs the account out everywhere and sends a "password changed" notice.
- **Password change.** `POST /api/auth/change-password` sends a "password changed" notice.
- **Email change.** `POST /api/auth/change-email` sends a confirmation link to the new address;
  once confirmed, both the old and new addresses get a notice.
- **API key created.** Creating a key sends a notice to the owner.
- **Ban.** A ban sends an email with the moderator's `message` (or the reason when there is no
  message) and the expiry, unless the ban was made with `notify: false` or was lifted or expired
  before sending.

Account emails cannot be unsubscribed from, ignore the hourly cap, skip undeliverable addresses,
and are retried by the job queue. Verification, password reset and email change requests are
limited to five per hour per client IP.

While email is enabled, sessions are checked against the database on every request (Better Auth's
five-minute cookie cache is off), so a password reset signs other devices out at once.

## Web Push

Web Push is off until all three VAPID settings are set:

1. Generate one permanent key pair with `bunx web-push generate-vapid-keys --json`.
2. Set `SERMO_VAPID_PUBLIC_KEY` and `SERMO_VAPID_PRIVATE_KEY` from the output, and
   `SERMO_VAPID_SUBJECT` to a contact `mailto:` address or an HTTPS URL. The server refuses to
   start with only some of them, or with another kind of subject.
3. Keep the private key secret and keep the same pair across restarts: a new pair invalidates
   every member's subscriptions.

Clients read the public key from `GET /push/public-key` (`push.publicKey`, `null` while push is
off), register a device with `PUT /push/subscriptions` (`push.subscribe`), list devices with
`GET /push/subscriptions` (`push.list`) and remove one with `DELETE /push/subscriptions`
(`push.unsubscribe`). Registering needs a signed-in member with `profile.editOwn`. A member keeps
at most ten devices; an eleventh replaces the oldest.

Only these push services are accepted, on the default HTTPS port: `fcm.googleapis.com`,
`*.push.services.mozilla.com`, `*.notify.windows.com` and `*.push.apple.com`. Self-hosted push
services are not supported.

Each notification that has push on (see [Channels and preferences](#channels-and-preferences))
is sent to every device the member registered, as a separate job per device. A push message
carries only the notification's localized title (up to 120 characters), a short plain-text body
(up to 180 characters, never the text of a post or message) and a link to the content, encrypted
for the device and kept by the push service for at most an hour. Before sending, the server checks
again that the member's push preference is on and that they can still see the content. A
subscription the push service reports as gone (404 or 410) is removed. Redirects, 400, 403 and
413 replies are logged and that message is dropped (a 403 usually means the VAPID keys are wrong;
subscriptions are kept). Other failures are retried.

## Formatting for members

Posts, profile posts, comments and conversation messages are Markdown (CommonMark with GitHub
extensions such as tables and strikethrough), up to 10,000 characters. Raw HTML is shown as text,
and links get `rel="nofollow ugc noopener"`. Sermo adds:

- **Mentions.** `@name`, or `@"name with spaces"`, for a username of 3 to 32 characters. The
  mentioned member is linked and notified. Mentions inside links do not count. Each item may
  mention up to `mention.maxPerItem` members (10 for members, unlimited for moderators and
  administrators by default); members who joined less than `newMemberDays` ago are also limited to
  `newMemberMentionLimit` (default 3). Names beyond the limit, or unknown names, stay plain text.
  Editing keeps the mentions an item already had and notifies only newly mentioned members.
- **Quotes.** A block quote of a forum post:

  ```
  :::quote{post=123}
  The quoted text.
  :::
  ```

  The author's name is filled in when the content is saved (`author="..."` is added to the
  source). You can quote only posts you can see; a quote already in an item stays valid when it is
  edited. The quoted author is notified.
- **Spoilers.** A collapsed block, with an optional title:

  ```
  :::spoiler{title="Ending"}
  Hidden text.
  :::
  ```

  `:::spoiler` without a title shows "Spoiler". For a few words, use `>!hidden text!<` on one
  line.

`:::quote` and `:::spoiler` blocks can be nested inside each other up to 10 levels deep in
total. Quotes on their own (`:::quote` blocks plus Markdown `>` quotes) are also limited to 10
levels.

## Operations

The single server process runs everything; there is no separate worker to deploy.

- **Background jobs.** Durable work (notification fan-out, emails, push messages, spam cleanup, merges and splits,
  promotion sweeps, file cleanup) is stored in the `jobs` table and run by the job worker, which
  checks for due jobs every second. A failed job is retried after 30 seconds, 2 minutes,
  10 minutes and 1 hour, and is marked `failed` after five attempts. Finished jobs are deleted
  after seven days.
- **Scheduler.** Every second: events are handed to notifications, promotions and the other
  subscribers. Every five seconds: thread views, downloads and member activity are written. Every
  hour: expired sessions, API keys and verification tokens, old read markers, finished jobs and old
  read notifications are purged, and search engine (IndexNow) and file cleanup work is queued. Daily at 03:00 UTC: the
  promotion sweep, file cleanup, a rebuild of the stored counters, and SQLite's `PRAGMA optimize`.
  Weekly on Monday at 04:00 UTC: the email digest.
- **Checkpointer.** SQLite runs in WAL mode; a background thread copies the WAL into the database
  file every second so requests never pay for it. While a background job runs, checkpoints pause
  (a checkpoint beside a stream of job writes can stall them), but never for more than 30 seconds
  after the last complete checkpoint, so the WAL stays bounded even when jobs run back to back.
- **Shutdown.** On `SIGTERM` or `SIGINT` the server stops accepting connections, finishes the
  requests in progress, writes buffered views, stops the scheduler and the job worker (waiting up
  to 30 seconds for the current job), closes the mail connection, and closes the database.
- **Backups.** See [Backups](../README.md#backups) in the README.
