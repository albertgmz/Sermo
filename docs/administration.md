# Administering Sermo

This guide is for forum operators. It explains how Sermo decides what each member may do, which
tools moderators have, and how the economy, notifications, email and Web Push behave, with the
REST API call (under `/api/v1`) and the operation name for each task. MCP clients call the same operations as
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
  `admin.prefixes`, `admin.navigation`, `admin.pages`, `admin.widgets`, `admin.promotions`,
  `admin.announcements`, `admin.reactionTypes`: administration, each separate.
  Thread prefixes (`threadPrefixes.*`), navigation entries (`navigation.*`) and static pages
  (`pages.list`, `pages.getSource`, `pages.save`, `pages.delete`, and reading a draft) are managed
  with `admin.prefixes`, `admin.navigation` and `admin.pages`; the widgets drawn on the public
  pages (`widgets.list`, `widgets.create`, `widgets.update`, `widgets.duplicate`,
  `widgets.reorder`, `widgets.delete`) with `admin.widgets`; `admin.nodes` keeps the forums
  and the forum list tabs, and `admin.settings` the rest of the site settings.

All permission operations need `admin.permissions`.

### General, profile, conversation and file permissions

A group made by hand holds none of these until it is set, so a group that should behave like
Registered needs the ones it uses.

| Permission | Type | Built-in default |
| --- | --- | --- |
| `site.view`: open forums, threads, the feed, search, profiles, the member list and its pages, spoilers, bookmarks and the files of posts and wall posts (conversation files stay). When the Guest group lacks it, the public surfaces serve nothing too: Atom feeds, sitemaps, `llms.txt`, the SEO operations and the IndexNow announcements. A guest without it is asked to sign in; a member's own card and avatar files stay. Writes are not gated, and the email and push alerts of posts a closed-out member subscribed to are still sent. | flag | everyone |
| `member.viewList`: the member list and the pages of `/members` (staff, birthdays, the monthly race and winners), the rankings, and the holders of an award. It covers those lists, not every query that returns members: the prefix search for mentions and recipients stays open. | flag | everyone |
| `profile.deleteAccount`: delete one's own account from **Security** on `/account/security` (`users.deleteOwnAccount`). Turn it off for a group with `never`; the page then leaves the section out. A member under a temporary ban holds no permissions, so cannot use it. A member whose sign-up still waits for approval keeps it. | flag | members |
| `profile.uploadAvatar`, `profile.uploadCover`: upload or set the picture. Taking it off needs nothing. | flags | members |
| `bookmark.create`: adding a bookmark. Removing one needs nothing. | flag | members |
| `tag.apply`, `tag.create`: put tags on a thread (its author, and staff on any thread), and make a tag nobody used before. Without `tag.create` a member uses tags that exist and a typed `#word` that is no tag stays plain text. See Tags below. | flags | posters |
| `profile.renameNeedsApproval`: the member cannot change their own username and is told to ask staff, who can rename them. There is no request queue. | flag | nobody; Administrator `never` |
| `profile.renameLimit` with `profile.renameWindowDays`: at most that many own username changes within that many days. For the limit -1 is unlimited and 0 allows none, and the highest of a member's groups wins; for the days -1 counts every change ever, 0 is the same as unset (every change, unless one of the member's groups sets days), and when groups differ the longest window applies, so give the groups of one member the same window. Free and bought changes both count. | integers | -1 |
| `profilePost.postOwn`, `profilePost.post`: post on one's own profile, and on other members' profiles. | flags | posters |
| `profilePost.react`, `conversation.react`: react to wall posts and comments, and to conversation messages, as well as `reaction.react`. | flags | posters |
| `profilePost.view`: read wall posts and their comments, including in the feed. | flag | everyone |
| `reaction.viewList`: open the list of who reacted. The counts stay visible. | flag | everyone |
| `member.viewFollowing`: open the list of members another member follows. Members always read their own. `users.listFollowers` has no such permission, so the lists can be rebuilt one member at a time. | flag | everyone |
| `conversation.receive`: be added to a conversation. | flag | members |
| `conversation.attach`: attach files to conversation messages. | flag | members |
| `conversation.editOwnTimeLimit`: minutes within which a member edits their own messages (-1 unlimited). | integer | -1 |
| `conversation.alwaysInvite`: start a conversation with, or add, members who have ignored the holder. An ignore is the only privacy setting conversations have. | flag | Moderator, Administrator |
| `content.editSilently`: an edit leaves no "edited" note on posts, wall posts, comments and messages; the earlier text is still kept where revisions are kept, and staff who read a post's history still see the edit. | flag | Administrator |
| `forum.viewOwnHistory`: read the edit history of one's own posts (per forum), only while the post is visible to the author and only the edits they made themselves. | flag | members |
| `attachment.maxFileSize`: largest single file in bytes (-1: only the site's own upload limit; 0: no file). It can only lower the site's limit, never raise it for a trusted group. Covers attachments, avatars and covers. | integer | -1 |

### Forum permissions: own content, reading and reacting

Node permissions, so each can be set on a category or a forum. A group made by hand holds none
of them until it is set, except the two read gates, which are granted unless a group says `never`.

| Permission | Type | Built-in default |
| --- | --- | --- |
| `forum.deleteOwn`: hide one's own replies (soft delete: staff restore them). | flag | members |
| `forum.deleteOwnThread`: hide a thread one started (`threads.delete`, also in `threads.batchUpdate`). Not in a locked thread. A member's own hiding leaves no moderator-log entry. | flag | Administrator; give it to the Member group to turn it on |
| `forum.hardDeleteOwn`: delete one's own post or thread for good (`posts.hardDelete`, `threads.hardDelete`) in one step, without hiding it first, because the author cannot open content that is hidden. It never reaches what staff hid (a thread with a hidden post included), content that has been reported, a locked thread, a thread that holds other members' posts or one of more than 500 posts (hide it, or ask staff). A post a warning was given about (`warnings.create` with its `postId`) is not erased by its author either, and an administrator or moderator holding `forum.hardDelete` follows the staff two-step rule on live content even when they wrote it. An author's own delete is not a moderator action and is not logged (the moderator log feeds the `moderator_actions` criterion and the dashboard); staff deleting for good are logged. Staff with `forum.hardDelete` keep the two-step rule. Separate from hiding: a group can hold either. | flag | Administrator |
| `forum.lockOwn`: lock a thread one started, and unlock it again only when the author locked it: a lock staff set (also through the bulk tool, and a staff lock repeated on a thread the author locked), or one made before locks recorded who did them, stays. The author's own lock is not logged. | flag | Administrator |
| `forum.react`: react to posts in the forum, as well as `reaction.react`. Which reaction types a forum offers is set on the reaction type (`forumIds`). | flag | posters |
| `forum.viewOthers`: open threads other members started (granted unless a group says never). Denied, a member sees only their own threads in that forum: the thread list, `threads.get`, `posts.*`, search, the feed, Hot, staff picks, bookmarks, watches, alerts, email, push, the digest and the public pages (Atom feeds, sitemaps, IndexNow, `seo.thread`) all leave the others out, and the forum's latest post is not shown. | flag | everyone |
| `forum.viewContent`: read the posts of a thread (granted unless a group says never). Denied, titles are listed but the start of the opening post, `posts.list`, `posts.get`, replying, reactions, the feed, search hits (a search limited to titles still finds the thread, with no text), the media list and the public pages carry nothing; `threads.get` answers with the title and `resolvedPermissions` says so, and the web page shows a note. The posts of the member's own thread are closed too; a member can still open a single post they wrote with `posts.get`, to edit it. Thread covers show only where the text is open. Staff tools (reports, the approval queue, history) do not apply the two read gates. | flag | everyone |

Take either read gate from a group with `never` on the forum (a `no` does not take it: the gates are granted unless a group says never, so a group made by hand reads as before);
the Guest group is separate from Registered, so deny both for a forum members are not to read
either. Quoting a post in the editor reads it, so a quote of a post the member cannot read is
not offered; the server's check that a `[quote]` names a visible post does not apply the read
gates yet.

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
gets 0, except for the few limits that name a built-in value for that case (`warning.maxPoints`,
`warning.perDay`, `member.banMaxDays`). A banned member gets 0.

A yes/no read gate such as `forum.viewOthers` is granted unless some group says **never**; it needs
no `allow` and a `no` does not take it away.

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

Promotions add secondary groups automatically while a member meets a rule, and remove them
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

Promotions and automatic awards also share the four [economy criteria](#economy-criteria).

### Rules

One engine answers every "who does this apply to" question, so a criterion written once works
everywhere. A rule is `{ "match": "all" | "any", "conditions": [...] }`: `all` needs every condition,
`any` needs one, and a rule with no conditions means everyone. A condition is
`{ "criterion": "<id>", "value": <number> }` for the criteria above, or
`{ "criterion": "<id>", "ids": [<id>, ...] }` for the audience criteria:

| Criterion | Takes | Holds when |
| --- | --- | --- |
| `is_guest` | `value` 1 or 0 | 1: the visitor is signed out; 0: signed in |
| `in_group` | `ids` (groups) | the member is in one of the groups, however obtained: primary group, assigned by hand, granted by a promotion or bought |
| `not_in_group` | `ids` (groups) | the member is in none of them, however obtained (a guest is in none) |
| `is_member` | `ids` (members) | the member is one of the listed members |

Each criterion is `cheap` (read from the member's own row, or one indexed lookup) or `background`
(it counts or sums the member's history). `GET /criteria` (`criteria.list`; open to anyone with
`admin.promotions`, `admin.awards`, `admin.shop` or `admin.announcements`, and also giving the groups,
awards and credit rules a rule may name),
`GET /promotions/criteria` and `GET /awards/criteria` list the class as `cost`. Promotions and
awards are checked in the background and take every criterion. Notices and shop categories and
items are checked while a request is served and refuse a `background`
criterion. Guests satisfy only the audience criteria.

#### More criteria

A condition may also carry a list of `ids` (threads, awards, shop items, shop categories or credit
rules), a look-back window `days` and a `mode` that says how the list is read: `one` (any one of
them reaches the number), `each` (every one does), `all` (the numbers added together do) or `none`
(no one does). `criteria.list` gives each criterion's `idKind`, `window` and `modes` (the first
mode is the default). Below, `n` is `value`; a cost of `cheap` can be used in notices and the shop.

| Area | Criterion | Takes | Holds when | Cost |
| --- | --- | --- | --- | --- |
| Content | `posts_in_threads` | `ids` (threads), `n`, `mode` (each, one, all) | visible posts in the visible threads reach `n` (a thread merged into another cannot be named) | background |
| | `replies_received` | `n` | visible replies in the member's visible threads add up to `n`, their own replies included | background |
| | `busiest_thread_replies` | `n` | the member's thread with most replies has `n` | background |
| | `profile_posts_written`, `profile_comments_written`, `attachments_uploaded` | `n` | the member wrote or uploaded `n` (visible, attached) | background |
| | `bookmarks_at_least`, `watching_forums_at_least`, `watching_threads_at_least` | `n` | the member has `n` | background |
| | `polls_voted_at_least` | `n` | the member took part in `n` polls or quizzes (a counter on the member) | cheap |
| Economy | `owns_item`, `wears_item` | `ids` (shop items), `mode` (one, each) | the member holds the item now, or holds it and has the frame, name color or name icon it gives in use | cheap |
| | `bought_in_category` | `ids` (shop categories), `mode` (one, each) | the member bought something in the category, gifts included | cheap |
| | `gifted_items` | `n` | the member paid for `n` units that went to others | background |
| | `credits_earned` | `n`, optional `days` | credits from rules and awards, net of reversals, reach `n`, in total or in the last `days` | background |
| | `credits_from_rule` | `ids` (credit rules), `n`, optional `days`, `mode` (all, one, each) | the rules paid `n` | background |
| Awards | `awards_held_at_least`, `award_xp_at_most` | `n` | awards held (each grant counts) or their XP | cheap |
| | `holds_awards` | `ids` (awards), `mode` (one, none, each) | the member holds one, none or each of the awards | cheap |
| Profile | `has_cover`, `has_name_color`, `has_accent_color`, `has_frame`, `profile_complete` | `value` 1 or 0 | the member has set it (complete: avatar, about, location and birthday) | cheap |
| | `social_links_at_least` | `n` (up to 3) | Discord, Telegram and X handles filled in | cheap |
| | `username_changed_within_days` | `n` | the username changed in the last `n` days | cheap |
| Moderation | `restricted_posting`, `restricted_conversations`, `restricted_profile_posts` | `value` 1 or 0 | an active restriction of that kind | cheap |
| | `thread_banned`, `banned_before` | `value` 1 or 0 | banned from a thread with the ban in force; any ban on record | cheap |
| | `reports_resolved`, `moderator_actions` | `n` | reports the member filed that were resolved; entries under their name in the moderator log | background |
| Engagement | `days_since_last_post` | `n` | the last visible post in a visible thread is `n` days old or more; a member who never posted does not hold it | background |
| | `mentioned_by_others` | `n` | mentioned `n` times in other members' visible posts (in visible threads), profile posts and comments | background |
| | `quoted_by_others` | `n` | quoted `n` times (each quote counts) in other members' visible posts (in visible threads), profile posts and comments | background |
| Reactions | `reactions_given_by_type`, `reactions_received_by_type` | `ids` (reaction types), `n`, `mode` (all, one, each) | the reactions the member gave, or their content received, of the chosen types reach `n` | background |
| | `most_reacted_post` | `n` | the member's most-reacted visible post in a visible thread has `n` reactions | cheap |
| Referrals | `referrals_at_least`, `referrals_this_month` | `n` | members referred, in total or since the first of the month (UTC) | cheap, background |
| | `was_referred` | `value` 1 or 0 | the member has a referrer | cheap |

Promotions and awards check a member again at once when an event changes the fact (a reply, a gift,
a used item, a mention or a quote, a reaction given, a restriction, ban or thread ban, a resolved report, an award given or taken
away); the facts no event tells of (bookmarks, watches, referrals, moderator actions, a restriction
running out) wait for the daily sweep. An award's rule may read other awards, and giving or taking one
away checks the member's other awards again, so an award cannot require itself, directly or through
other awards: saving one that does is refused (creating included). An award that another award, a promotion, a notice or a shop rule names cannot be deleted until it is taken out of there. `criteria.list` names inactive awards only to those who hold `admin.awards`. Sweeps count history before they open their write transaction, so a long ledger or post history never holds the database for writing.

Notices (`rule`) are shown to the members the rule holds for. Shop categories and items (`rule`)
are listed to, and may be bought by, only the members the rule holds for; an administrator with
`admin.shop` sees them all. A gift also needs the recipient to match, and the refusal is the same as for a missing item. No conditions means everyone. The rules of shop items and awards are returned only to those who manage them (`admin.shop`, `admin.awards`); everyone else sees an empty rule. No promotion's rule may read a group that any promotion grants (a rule can read hand-assigned and shop groups), so promotions never depend on one another.

A promotion needs a rule with at least one condition. Members are evaluated right after relevant activity (a new
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

## Economy

Sermo has one currency, credits. Members earn or lose credits through rules and awards, and spend
them in the shop. Administrators can also adjust balances by hand.

### Economy permissions

These are global permissions and all require an account. The first five belong to the `economy`
category; the last three belong to `admin`.

| Permission | What it allows | Default |
| --- | --- | --- |
| `credits.adjust` | Give or take credits by hand; queue a balance repair | Administrator |
| `credits.viewAny` | Read any member's balance and ledger, or the whole ledger | Moderator, Administrator |
| `award.grant` | Grant awards by hand and revoke individual grants | Moderator, Administrator |
| `shop.buy` | Buy items and use items in your own inventory | Member, Moderator, Administrator |
| `shop.gift` | Buy a giftable item for another member; also needs `shop.buy` | Member, Moderator, Administrator |
| `admin.creditRules` | List, create, change and delete credit rules | Administrator |
| `admin.awards` | Manage awards, read their criteria and queue an automatic award sweep | Administrator |
| `admin.shop` | Manage categories and items; read the purchase log and anyone's inventory | Administrator |

`credits.adjust` and `award.grant` have no rank check: holders can act on themselves and on
members of equal or higher rank. This includes taking credits and revoking awards.

### Credits and the ledger

Credits are whole numbers. Each movement adds a permanent ledger row with the signed amount,
the balance after it, its type, source when known, who made it (`null` for the system), reason
and time. Rows are never edited or removed; reversing a payment adds another row. The types are
`adjustment` (manual), `event` (credit rule, including a restored payment), `event_reversal`,
`award`, `award_revoked` and `purchase`.

Every signed-in member can see their own history, newest first. `credits.viewAny` is needed to
read another member's history or the ledger of everyone. The ledger returns a balance only when
`userId` is supplied; otherwise its `balance` is `null`.

| Task | REST | Operation |
| --- | --- | --- |
| Your balance and history | `GET /credits` | `credits.history` |
| The whole ledger, or one member with `userId` | `GET /credits/ledger` | `credits.ledger` |
| Adjust a member's balance | `POST /users/{userId}/credits` | `credits.adjust` |
| Queue a balance repair | `POST /credits/recalculate` | `credits.recalculate` |

A manual adjustment takes a nonzero `amount` between -1,000,000,000 and 1,000,000,000 and a
nonblank `reason` of up to 500 characters. Positive amounts give credits; negative amounts take
them. Penalties and reversals apply in full even after a member has spent their credits, so a
balance can become negative. A purchase cannot take a balance below zero: insufficient funds
refuse the whole purchase.

Daily at 03:00 UTC, `credits.recalculate` is queued to recompute every balance from its ledger
and repair differences. Queue it yourself with `POST /credits/recalculate` and an empty object;
this needs `credits.adjust`. The repair changes the stored balance without changing ledger rows.
The response's `queued` says whether a new job was queued, not whether the repair has finished.

### Credit rules

A rule has a title, one trigger, a signed nonzero amount between -1,000,000 and 1,000,000, an
`isActive` flag, an optional limit and optional forum ids. Several active rules can use the same
trigger; each applies independently. Positive amounts reward the member below, and negative
amounts charge that same member.

| Trigger | Member whose balance changes |
| --- | --- |
| `thread_created` | The author of a new visible thread |
| `reply_posted` | The reply's author; excludes the thread's first post, but includes replying to your own thread |
| `reply_received` | The thread's author when someone else replies |
| `reaction_given` | The member reacting to visible content, for any reactable content type except a message in a private conversation (nobody else sees those, so they would be easy to trade); a reaction type with a negative score pays neither trigger |
| `reaction_received` | The author of that content |
| `profile_post_created` | The author posting on another member's profile |
| `profile_post_received` | That profile's owner; posting on your own profile triggers neither profile rule |
| `followed` | The member gaining a follower |
| `registered` | The newly registered member |
| `daily_activity` | The member on their first recorded activity of a UTC day |
| `warning_received` | The member receiving a warning |
| `award_received` | The member receiving an award grant, in addition to any credits the award itself pays |

`limit: { "count": 5, "windowHours": 24 }`, for example, allows at most five applications of
that rule per member within a rolling 24-hour window. `null` means no limit. The window uses the
event's time, and reverted applications still count: deleting content does not free a place.

`nodeIds: []` means everywhere. A nonempty list must contain existing forums and is accepted
only for `thread_created`, `reply_posted`, `reply_received`, `reaction_given` and
`reaction_received`. It matches those forums, not their descendants. A restricted reaction rule
applies only to reactions on posts in those forums and ignores other content types.

Rules apply only to events recorded after the rule was created, including when older events
are still waiting to be processed. A rule pays each member only once per source: a thread, reply,
one member's reaction on one item, profile post, follower, registration, UTC day, warning or award
grant. Removing and adding the same reaction, or unfollowing and following again, does not earn
another payment.

**Visibility and reversals.** Content awaiting approval pays on its first approval. Hiding
content takes back the rule payments attached to that content; restoring it re-applies the
original amounts. A reversal of a negative rule returns the credits it charged. Restoring does
not earn a second payment or apply newly created rules to content that already had its chance.
Hiding a thread reverses what the thread itself paid, not what its replies paid; new payments
for replies require a visible thread. Revoking an award also reverses any `award_received`
rule payments attached to that grant.

| Task | REST | Operation |
| --- | --- | --- |
| List rules | `GET /credit-rules` | `creditRules.list` |
| Create a rule | `POST /credit-rules` | `creditRules.create` |
| Change a rule | `PATCH /credit-rules/{ruleId}` | `creditRules.update` |
| Delete a rule | `DELETE /credit-rules/{ruleId}` | `creditRules.delete` |

All need `admin.creditRules`. A rule's trigger cannot change. Changing its amount does not change
payments already made, including their later reversals and restores. Deactivating or deleting a
rule stops new applications; its existing payments stay and still reverse or re-apply when their
content is hidden or restored.

### Awards

Awards include achievements. Each has a name, description, icon, tier (`bronze`, `silver`, `gold`
or `legendary`), an optional category (`categoryId`, `null` for none), XP and credits per grant,
and flags for active and stackable. XP and credits are nonnegative whole numbers, each up to
1,000,000. XP accumulates in the member's total. The tier is the award's rarity: it only colours the
icon, and its name is shown to award managers alone.

Categories group the catalog by what the awards reward (seniority, posts, reactions...). Each has a
title (up to 100 characters), an optional description (up to 500) and a position (0 to 1,000,000; a
new category without one goes after the last). Deleting a category is never refused: its awards
stay, without a category. Category changes are written to the moderator log.

The catalog (`awards.list`) lists the categories by position, then the awards without a category,
and inside each the easiest first: awards whose rule counts progress (at least N posts, days,
reactions...) by N, the highest N when all conditions must hold and the lowest when any one is
enough; then the rest. Ties go by XP, lowest first, then by name. A member's own award list shows
legendary first, then gold, silver and bronze, with higher XP first within each tier.

A stackable award can be held several times; a non-stackable one cannot be granted while the
member already holds it. Each grant adds XP and pays the award's credits through the ledger.
Grant and revoke by hand with `award.grant`, with an optional reason of up to 500 characters.
Revocation targets one grant and takes back exactly the XP and credits it originally gave, even
if the award's values have since changed; the balance can go below zero. Credit rules attached
to that grant reverse separately when the revoke event is processed.

An award whose `rule` has no conditions is manual only. Otherwise the rule must hold for an
automatic grant. Members are evaluated after relevant activity (including credit changes and
purchases) and by a daily sweep. Each award is granted automatically at most once per member,
even when stackable. Losing eligibility does not take it back by itself, and revoking an
automatic grant by hand never makes the criteria grant it again. Manual grants remain possible
under the stackability rule; a held non-stackable manual grant prevents an automatic grant while
it is held.

To take automatic grants back from members who no longer meet the rule, an administrator starts
a run on `/admin/awards` ("Retirar a quien ya no cumple"), never at deploy or from the sweep. It
first counts (`apply: false`: nothing is written, the result lists the grants by award), then
revokes (`apply: true`). The run goes through the members who hold automatic grants of active
awards with conditions, 25 at a time, and revokes each grant whose rule the member no longer
meets like `awards.revoke` does (XP and credits taken back, balances may go below zero), judging
the member's other awards again with what is left until none more falls. Grants made by hand,
inactive awards and awards with no conditions are never touched, and a grant counts as automatic
only when the member's totals also say the criteria made it. Nobody is notified. The awards and
promotions subscribers do not look at a member again for the run's own revocations (their events
carry a mark of their own, `unqualified`, and the credits a source type of their own; the daily
sweeps pick up what the revocations make true). The run stops if the administrator who started it
loses `admin.awards`, and the start and the end of a revoking run are written to the moderator
log. A grant taken back is given again if the member later meets the rule. A run that stopped on
an error resumes from where it stopped when started again with the same `apply` (a count is
refused until a stopped revoking run is resumed); credit rules that paid for a grant reverse
afterwards, so a second run settles what that changes.

To make levels and awards match the rules at this moment, an administrator presses "Reconstruir
niveles y trofeos" on `/admin/awards` (the administrator's password confirms it). XP comes only
from the awards a member holds, so the run sets each member's award XP, award count and per-award
counters (and, at the end, each award's holder count) to what the held grants add up to (the level
follows from the XP, so nothing else is stored), takes back the automatic grants whose rule they no
longer meet exactly as the run above does (XP and credits taken back, balances may go below zero),
and grants the automatic awards they meet and do not hold, as the sweep does (XP and credits paid;
an award taken back in a pass is not given again in the same pass). Grants made by hand are never
touched, an automatic grant a moderator revoked is not given again, and nobody is notified. It runs
in chunks of 25 members, one run at a time, ends before its next chunk when stopped (the Stop
button, `awards.rebuildStop`), resumes after an error or a stop when started again, and is written
to the moderator log (`awards.rebuild.start`, `.done`, `.stopped`, `.failed`). A second run changes
nothing unless rules depend on time, credits or XP, or credit rules pay for awards.

"Ver qué cambiaría" (`awards.rebuild` with `dryRun: true`, no password) does the same chunk by
chunk and undoes each chunk, so only the figures stay: members whose XP or counters would change,
levels up and down, grants and take-backs by award (the twenty most affected), credits paid and
taken back, and members who would end with a negative balance. Each chunk holds the write lock
for as long as a real chunk does. Run it before a real run. Without the web app, inside the
backend container with the server running (its job worker runs the chunks):
`docker compose exec sermo bun run awards:rebuild -- --dry-run` previews, `... awards:rebuild`
runs (`--admin <member id>` names who the log shows), `... awards:rebuild -- --stop` stops the run
under way. It prints progress and ends with the figures above.

| Task | REST | Operation |
| --- | --- | --- |
| List, read awards | `GET /awards`, `GET /awards/{awardId}` | `awards.list`, `awards.get` |
| Current holders, one row per grant | `GET /awards/{awardId}/holders` | `awards.holders` |
| A member's XP and awards with counts | `GET /users/{userId}/awards` | `awards.member` |
| A member's current grants, newest first | `GET /users/{userId}/award-grants` | `awards.memberGrants` |
| List automatic award criteria | `GET /awards/criteria` | `awards.criteria` |
| Create, change, delete | `POST /awards`, `PATCH`/`DELETE /awards/{awardId}` | `awards.create`, `awards.update`, `awards.delete` |
| Grant by hand (`awardId` in the body) | `POST /users/{userId}/awards` | `awards.grant` |
| Revoke one grant | `DELETE /award-grants/{memberAwardId}` | `awards.revoke` |
| Queue an evaluation of everyone | `POST /awards/run` | `awards.run` |
| Count, or take back, automatic grants whose rule is no longer met | `POST /awards/revoke-unqualified` | `awards.revokeUnqualified` |
| Where that run stands and what it counted or took back | `GET /awards/revoke-unqualified` | `awards.revokeStatus` |
| Rebuild levels and awards (needs the administrator's password) | `POST /awards/rebuild` | `awards.rebuild` |
| Where the rebuild stands and what it changed or would change | `GET /awards/rebuild` | `awards.rebuildStatus` |
| Stop the rebuild under way | `POST /awards/rebuild/stop` | `awards.rebuildStop` |
| List categories, in order, with their award counts | `GET /awards/categories` | `awardCategories.list` |
| Create, change (title, description, position), delete a category | `POST /awards/categories`, `PATCH`/`DELETE /awards/categories/{categoryId}` | `awardCategories.create`, `awardCategories.update`, `awardCategories.delete` |

Catalog and holder calls need `profile.view`; inactive awards are shown there only to holders
of `admin.awards`. Member award calls require access to that member's profile and include the
awards they still hold, even if deactivated. Managing awards and their categories, reading
criteria, queuing a sweep and the run that takes back grants need `admin.awards`. The category list needs `profile.view`; without
`admin.awards` it holds only categories with an active award, and counts only active awards.

Set `isActive: false` to stop further grants while keeping existing ones. An award that has
ever been granted cannot be deleted, even after every grant is revoked. Changing XP or credits
affects future grants only. You cannot turn off stackability while anyone holds more than one.

The `awards.sweep` job is queued daily at 03:00 UTC. To queue it now, send an empty object to
`POST /awards/run`; `queued` reports whether a new job was queued. Creating or editing an award
does not itself sweep members: use this call or wait for activity or the daily sweep.

### Shop

Categories and items have names, descriptions, display positions and active flags. Everyone can
browse the active catalog; `admin.shop` also reveals inactive categories and items. An item and
its category must both be active to buy it. A category can be deleted only when it has no items.

An item's `price` is a whole number of credits from 0 to 1,000,000,000 per unit. `stock` is the
number of units left, or `null` for unlimited. A purchase charges price times quantity, reduces
finite stock, delivers the inventory and records the purchase together. If funds or stock are
short, none of it happens. Free items still create purchases but no credit ledger row.

- **Consumable** (`isConsumable: true`): purchases add 1 to 100 units; each use consumes one.
  The inventory state is `unused` while units remain and `used` when none do. Consumables cannot
  have a duration or a `group` effect.
- **Non-consumable**: quantity must be 1. It is `active` while held and cannot be bought again
  for that recipient until it is `expired`. `durationSeconds` runs from purchase (at least 60
  seconds, at most ten 365-day years); `null` makes it permanent.

| Effect | What happens |
| --- | --- |
| `permission` | Grants a registered permission while held: until expiry, or until a consumable's last unit is used. A yes/no permission takes no `value`; a number permission requires one (-1 for unlimited). |
| `group` | Adds a secondary group while held. This is how to sell a paid rank; the item cannot be consumable. |
| `frame`, `nameColor` | Store a frame key or a `#rrggbb` color; using the item only publishes `shop.item_used`. |
| `threadCover`, `highlight`, `bump` | Store the effect; use needs `threadId`, a visible thread started by the member in a forum they can see, and only publishes `shop.item_used`. |
| `promote` | A consumable. Use needs `threadId` (an unlocked, visible thread of the member, not already featured) and features it for 24 hours, marked as promoted. The 10 newest features are listed first in Hot whatever their activity; an older one is listed there only where it ranks. What's new lists the newest features. One unit is one promotion; nothing is refunded if the thread is deleted afterwards. |
| `usernameChange` | Use needs the proposed name in `value` and only publishes `shop.item_used`. |

Only `permission` and `group` apply now, as part of the purchase. The other effects are validated
and published for subscribers; this release does not change appearance, threads or usernames
when they are used. Group items and non-consumable permission items cannot be used manually;
their benefits apply while held.

**Purchased permissions.** A purchase adds a separate grant alongside group and member-specific
entries. Any `never` still denies, otherwise an `allow` grants; number permissions take the
highest value, with -1 unlimited, rather than adding values together. Bans, restrictions and
the permission's other conditions still apply. A node permission is granted on every node,
subject to the normal node-view checks. To sell access to a particular forum, sell a group with
permissions on that forum. `permissions.explain` shows the purchased layer as `purchase`.
Expiry removes only the purchased grant: it leaves permissions set by an administrator, and
groups assigned by hand or by a promotion, in place.

**Expiry.** Every minute the scheduler queues `shop.expire`, which marks due items `expired`
and removes their purchased grants. Benefits can therefore last up to one minute beyond
`expiresAt`; they do not end at the exact timestamp. Purchase and expiry changes are visible
on the member's next request.

**Gifts.** Supply `recipientId` when buying. The buyer needs both `shop.buy` and `shop.gift`,
and the item must have `isGiftable: true`. The buyer pays and the recipient receives the item;
stock and ownership rules still apply. A recipient's ignore blocks a gift when the buyer has
`member.ignorable`; staff lack that permission by default, so an old ignore entry does not block
their gifts. Gifts are chosen at purchase: an item already in inventory cannot be given away.

**What may be sold.** Creating or editing an item with a `permission` or `group` effect needs
`admin.permissions` as well as `admin.shop`; deleting one that was never bought needs only
`admin.shop`. A sold group must exist, cannot be Guest, and must rank below the administrator
creating or editing the item. Permissions in the `admin` category and
groups holding `admin.permissions` cannot be sold; purchases also enforce this protection.
A group used by a shop item cannot be deleted while that item exists.

**Changing the catalog.** Once an item has been bought, its `effect`, `isConsumable` and
`durationSeconds` are fixed, and it cannot be deleted. Other fields, including price, stock and
giftability, can still change. Set `isActive: false` on the item or category to stop purchases;
existing inventory and its benefits remain.

| Task | REST | Operation |
| --- | --- | --- |
| List categories | `GET /shop/categories` | `shopCategories.list` |
| Create, change, delete categories | `POST /shop/categories`, `PATCH`/`DELETE /shop/categories/{categoryId}` | `shopCategories.create`, `shopCategories.update`, `shopCategories.delete` |
| List a category's items | `GET /shop/categories/{categoryId}/items` | `shopItems.list` |
| Read an item | `GET /shop/items/{itemId}` | `shopItems.get` |
| Create, change, delete items | `POST /shop/items`, `PATCH`/`DELETE /shop/items/{itemId}` | `shopItems.create`, `shopItems.update`, `shopItems.delete` |
| Buy for yourself or as a gift | `POST /shop/items/{itemId}/buy` | `shop.buy` |
| Inventory in one required `state` | `GET /shop/inventory` | `shop.inventory` |
| Use an item you own | `POST /shop/inventory/{inventoryId}/use` | `shop.use` |
| Purchase log | `GET /shop/purchases` | `shop.purchases` |

Every signed-in member may read their own inventory. Reading someone else's with `userId`
needs `admin.shop`. The purchase log also needs `admin.shop`: it lists purchases newest first,
optionally filtered by `buyerId`, `itemId` or both, and shows the buyer, recipient, item, quantity,
total price and time. `shop.buy` is needed both to buy and to use an item.

### Economy criteria

Promotions and automatic awards use the same criteria, listed by `GET /promotions/criteria`
(`admin.promotions`) and `GET /awards/criteria` (`admin.awards`). Alongside the
[existing criteria](#promotions), both accept:

| Criterion | Value |
| --- | --- |
| `credits_at_least` | Balance is at least this many credits |
| `credits_at_most` | Balance is at most this many credits |
| `purchased_item` | The id of an item the member has bought |
| `purchases_at_least` | At least this many units bought, across purchases |

Credit thresholds must be nonnegative: `credits_at_most` with 0 includes both zero balances and
debt. Purchase criteria record buying, not current ownership: using or expiring an item does not
undo a purchase, and gifts count for the buyer, not the recipient. Credit changes and purchases
trigger evaluation of that member in the background, alongside the daily sweeps.

### Economy events

The event dispatcher runs every second. Credit rules and automatic awards use these background
events; they are separate from notification types.

| Event | When it is published |
| --- | --- |
| `member.registered` | A member's account is created |
| `member.active_day` | Buffered activity is saved for the member's first activity of a UTC day; includes the UTC day number |
| `credits.changed` | A ledger row is added; includes the member, transaction, amount, resulting balance, type, source and actor |
| `award.granted`, `award.revoked` | A grant is made or revoked; includes the member, grant, award, original XP and credits, actor and reason |
| `shop.purchased` | A purchase commits; includes the item, buyer, recipient, quantity, total price and inventory id |
| `shop.item_used` | An item is used; includes the member, item, effect, units left and, where required, thread or proposed name |

Purchased groups also use the existing `member.groups_changed` event with `source: "shop"`
when purchase or expiry actually changes membership. Activity is saved every five seconds;
activity just before midnight followed by activity before the next save can be recorded only
for the new UTC day.

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
| `forum.manageReports`, `forum.approve`, `forum.deleteAny`, `forum.undelete`, `forum.editAny`, `forum.viewModerated`, `forum.viewDeleted`, `forum.viewHistory`, `forum.lock`, `forum.replyLocked`, `forum.stick`, `forum.feature`, `forum.move`, `forum.merge`, `forum.split`, `forum.threadBan`, `forum.bypassNodeRules`, `forum.viewLog` | Moderation inside a node (and the nodes beneath it) | Moderator, Administrator |
| `forum.hardDelete`, `profilePost.hardDelete` | Deleting soft-deleted threads, posts and profile posts for good (see Changing content state) | Administrator |
| `profilePost.approve`, `profilePost.deleteAny`, `profilePost.undelete`, `profilePost.editAny`, `profilePost.viewModerated`, `profilePost.viewDeleted` | Moderating profile posts and comments | Moderator, Administrator |
| `report.manageProfiles` | Handling reports on profile content and on members | Moderator, Administrator |
| `member.warn`, `member.restrict`, `warning.view` | Warnings and restrictions; reading anyone's warnings and restrictions | Moderator, Administrator |
| `forum.warn` | Warning a member about one of their posts in this forum (`warnings.create` with a `postId`); a forum moderator holds it with the rest of the set | Moderator, Administrator |
| `warning.delete` | Deleting a warning, or ending it now (`warnings.delete`, `warnings.expire`), for members of lower rank | Moderator, Administrator |
| `warning.maxPoints`, `warning.perDay` | The most points one warning may carry, and the most warnings one moderator gives in 24 hours; −1 is unlimited, 0 allows none; with no entry in any of the member's groups, 10 and 20 | Moderator 10 and 20, Administrator unlimited |
| `member.editProfile` | Editing the basic profile of a member of lower rank: about, location, website, birthday, links, title, signature, removing pictures (`users.adminUpdateProfile`; what a member wears needs `admin.members`) | Moderator, Administrator |
| `member.banMaxDays` | The longest ban the holder may give, in days; −1 allows a permanent one, 0 none; with no entry in any of the member's groups, 30. Banning also needs `member.ban` | Moderator 30, Administrator unlimited |
| `profile.bypassPrivacy` | Seeing and posting on profiles whatever their privacy settings | Moderator, Administrator |
| `wordFilter.view` | Listing word filters | Moderator, Administrator |
| `tag.manage` | Renaming, merging and deleting tags (`tags.list`, `tags.rename`, `tags.merge`, `tags.delete`); setting the tags of any thread | Moderator, Administrator |
| `moderation.access` | Marks the member as a moderator in `auth.me` (`isModerator`) so clients can show the queues | Moderator, Administrator |
| `member.ban` | Bans, up to the holder's `member.banMaxDays` | Moderator, Administrator (a site that already exists needs the entry added to the Moderator group once) |
| `member.spamCleanup` | Spam cleanup, which also bans for good: `member.banMaxDays` does not bound it | Administrator |
| `conversation.moderate`, `conversation.viewHidden` | Moderating private conversation messages and their reports; seeing hidden messages there | Administrator |
| `wordFilter.manage`, `moderatorLog.view` | Managing word filters; reading the whole moderator log | Administrator |
| `member.approveRegistrations` | Approving or rejecting the new accounts that wait in the sign-up queue (see [Sign-up approval](#sign-up-approval)) | Moderator, Administrator |
| `member.viewIps` | "View IPs": the addresses members signed in, registered and posted from, and who shares them; only for members the holder outranks | Administrator |
| `member.immuneToAutoBan` | Held by the warned member: reaching a warning threshold applies no automatic action to them | Administrator |

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

### Anti-spam limits

Every limit is checked on the backend, inside the write. Settings are changed with
`PATCH /settings` (admin panel: Settings, Anti-spam); the rest are permissions.

| Limit | Where | Default |
| --- | --- | --- |
| `floodSeconds`: seconds between two posts. Threads, replies, wall posts, wall comments and conversation messages share one clock; a post held for approval starts it too. Refused with `rate_limited` (429) and the seconds left. | setting | 0 (off) |
| `antispam.postsPerDay`: forum posts in 24 hours, a new thread counting as one. Wall posts, comments and messages are not counted. | integer permission | -1 |
| `antispam.threadsPerDay`, `antispam.conversationsPerDay` | integer permissions | -1 |
| `antispam.negativeReactionsPerDay`: reactions whose type has a negative score, given in 24 hours. Turning a kind reaction into one counts as giving it then. | integer permission | -1 |
| `linksRule`: a rule (the one rule builder, cheap criteria only) a member must hold to post a link, or a picture or media from another site; the refusal names what is missing. Links to the site itself and code are not links. Staff editing someone else's text are exempt. | setting | empty rule (everyone) |
| `approvalRule`: new threads and replies by members who do not hold this rule wait for approval, in addition to `firstPostsToModerate` and each forum's switches. Not applied to edits, wall posts or messages. | setting | empty rule (nobody held) |
| `antispam.externalMediaAsLinks`: a member held to it has pictures and players from other sites shown as links, fixed when the text is saved (the text the member wrote is kept; when staff edit someone else's text the author's setting applies). A restriction, so groups made before it existed keep embedding. | flag permission | nobody; Administrator `never` |
| `antispam.bypassFlood` | flag permission | Moderator, Administrator |
| `antispam.bypassWordFilter`, `antispam.bypassSpamCheck` | flag permissions | Administrator |

Daily limits count the member's rows of the last 24 hours, whatever became of them (deleted and
held ones count). For an integer, `-1` and `0` both mean no limit, so a group created before
the limit existed is not shut out; to stop a group writing, take its posting permission away.
Integers take the highest value across a member's groups and `-1` beats every number, as everywhere: to limit new members, lower the Registered group and do not give `-1` to a group they also belong to. A member whose primary group is a custom one with no entry has no limit.

### Signatures

Checked when a member saves a signature, on what it renders to, so tags that draw
the same thing count the same (Settings, Anti-spam). Characters and lines count the source. Links,
pictures, emoji (each pictograph on its own, also inside a joined sequence; a flag or a keycap
once; the copyright and trade mark signs and the like only with the emoji selector; arrows, card
suits and similar symbols count, a strictness on purpose) and the largest text size (`[size]` 1 to 7; a heading counts as 8 minus its level) are
counts where `0` and `-1` both mean no limit; to forbid links or pictures leave them out of the
allowed formatting (`signatureFormats`). A kind that is not allowed is refused, never stripped.
Quotes, tables, code blocks, spoilers, media and more than one block are never allowed, and a
signature that draws nothing (only invisible characters) is refused. `signatureRule` (cheap
criteria) says who may set one on top of `profile.signature`; a stored signature of a member who
no longer holds it stays stored and is not shown. Saved signatures are not re-checked until saved
again.

### Cloudflare Turnstile

Settings, Anti-spam. A visitor without an account solves a check before registration, sign-in,
a password reset request or a request for a new confirmation email (the guest forms you tick);
signed-in members never see it. The backend verifies every token with Cloudflare (the client
address as `remoteip`, a 5 second limit) and requires the action to be the form's own and the
host to be one of the site's: `BETTER_AUTH_URL`, `SERMO_SITE_URL` and `SERMO_TRUSTED_ORIGINS`. Each
host is taken as written (`www.` is not folded into the bare domain), and a trusted origin written
with a wildcard (`https://*.example.com`) takes any sub-domain but not the bare domain. A server
always has its public origin, so the host is compared in practice. Cloudflare's always-pass test
keys report the host `example.com`: add it as a trusted origin to try them. It fails
closed: when Cloudflare cannot be reached, or the secret is wrong, the guarded forms are
refused. Sign-in is not ticked by default so that you can still sign in to correct a wrong secret;
if you are locked out, delete the `turnstile_secret` row of `site_settings` or turn Turnstile off
in the database. The secret is write-only (no read returns it) but is stored in plain text in the
database, so backups carry it.

### Approval queue

New content waits for approval (state `moderated`) when any of the following holds. Word filters
and the new-member link rule also run when content is edited: an edit that trips them sends
visible content back to the queue.

- a word filter with the `moderate` action matches it;
- the author has fewer forum posts than `firstPostsToModerate` (forum posts only; default 0, off);
- it contains a link, the author joined less than `newMemberDays` ago (default 7) and
  `moderateLinksFromNewMembers` is on (default off);
- the forum requires approval of new threads or replies (see
  [node rules](#node-moderators-and-node-rules));
- for a new thread or reply, the author does not hold the site's `approvalRule` (see
  [anti-spam limits](#anti-spam-limits)).

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
- Per thread: `PUT /threads/{threadId}/sticky` (`forum.stick`), `PUT /threads/{threadId}/feature`
  (`forum.feature`: a staff pick that lasts until it is ended; the 10 newest features are listed first in Hot, an older one only where it ranks, and `GET /featured-threads` lists every current one for What's new),
  `PUT /threads/{threadId}/lock` (`forum.lock`), `POST /threads/{threadId}/move` (`forum.move` on both forums). Replying in a
  locked thread needs `forum.replyLocked`.
- `GET /posts/{postId}/revisions` (`postRevisions.list`, `forum.viewHistory`) shows earlier bodies
  of an edited post.

- `POST /threads/batch` (`threads.batchUpdate`): one change for up to 100 threads (`move`, `lock`,
  `unlock`, `stick`, `unstick`, `delete`, `restore`, `feature`, `unfeature`, `setPrefix`). Unlike
  `moderation.bulk` it judges each thread on its own, with the permission of the single action in
  that thread's forum, and answers per thread (`changed`, or the `error` that refused it); a
  refused thread changes nothing and the others are applied, in one transaction. Every thread is
  logged as the single action is. Delete, restore and move cost in proportion to a thread's posts:
  once the posts of the threads taken add up to 250,000, further threads are refused ("try again in a
  smaller batch"); the first is always taken. The forum's thread list offers it to staff as ticks and a bar.

A member's own delete (a reply, a wall post or a comment) is a soft delete too: moderators can see
and restore it. Only staff delete for good, and only content that is already soft-deleted:

- `POST /threads/{threadId}/hard-delete` (`threads.hardDelete`, `forum.hardDelete` in the
  thread's forum), `POST /posts/{postId}/hard-delete` (`posts.hardDelete`, not the opening post)
  and `POST /profile-posts/{profilePostId}/hard-delete` (`profilePosts.hardDelete`,
  `profilePost.hardDelete`). They erase the content with its reactions, attachments, alerts,
  bookmarks, reports and the credits it paid. A thread goes 500 posts per call (a wall post 500
  comments), newest first, and stays deleted until a call answers `completed: true`; until then it
  cannot be restored (a wall post likewise). Merging such a thread into another is not blocked: its
  remaining posts move on. Merge tombstones that resolve to a removed thread go with it. The
  moderator log keeps the entry, with the title and author. Post positions are not renumbered, so a
  thread has a gap where a post was. The permissions are Administrator by default and can be
  granted per forum.

Everything else stays visible to those with the view-deleted permission and can be restored.

### Moderator log

Moderation and administration actions are appended to the moderator log. Entries are never
removed; moving a thread updates the node its entries are filed under, so they follow the thread. `GET /moderation/log` (`moderatorLog.list`) returns everything to holders of
`moderatorLog.view`, and otherwise the entries of nodes where the reader has `forum.viewLog`;
`nodeId` limits it to one node. Ban and restriction entries carry the ban or restriction id in
`details`.

### IP addresses

Every sign-in (failed ones too), registration, post, thread, conversation message, profile post,
comment and report writes one row to the IP log, in the transaction of the action: the member, the
address, what was done, the content it made, the time, and the device parsed from the user agent
(browser, system, device type, brand, model, and whether it is a bot; the user agent itself is not
kept). The address is the client address the HTTP adapter trusts (the socket, or the single
trusted proxy header), written normalised: an IPv4-mapped IPv6 address is stored as IPv4, and an
IPv6 address is also kept with its /64 network, so members behind one connection group together.
Nothing is logged for an action without a usable address (loaders, scripts).

`member.viewIps` works like the member-sessions read: it only reaches members the holder outranks
(a super admin reaches everyone). `users.ips` is refused for any other member, `ips.members` leaves
them out and `ips.content` shows no address for their content. Views are not written to the
moderator log. It opens three reads and the **IP addresses** screen of the moderation panel
(`/moderation/ips`): `ips.content` (the address a post or other content was made from; a thread's
is its first post's), `users.ips` (every address a member used, with counts and first and last
seen) and `ips.members` (the members who used an address, or an IPv6 /64). Failed sign-ins are
logged but never shown in these views, so someone guessing at an account does not tie their address
to it. Erasing a member deletes their rows. Crawlers (recognised by user agent) do not count as
thread views.

Each row also holds the approximate place (country code, region, city) when one is known: from the
proxy's location headers when `SERMO_TRUST_LOCATION_HEADERS=true` (Cloudflare's "Add visitor
location headers"), else from the optional MaxMind database at `SERMO_GEOIP_DATABASE`, else none
(`docs/deployment.md`, "Sign-in location and log retention"). A daily job deletes rows older than
`SERMO_IP_LOG_RETENTION_DAYS` (default 180), in batches of 200 so requests never wait on it; the
privacy and cookie pages state that age. Members see their own recent sign-ins, successful and
failed, with device and place, in **Sign-in history** on `/account/security` (`auth.signInHistory`),
and each session there shows when it was last used (written at most once every five minutes per
session, by the five-second flush). A sign-in from a browser (browser and system) or country not
seen in the member's retained sign-ins sends a security mail with a "This wasn't me" link; a crawler,
empty or unreadable browser counts as one browser, "unknown", and alerts the first time like any
other. The first sign-in never alerts, and a country is only compared when the sign-in has one. The link (valid a week, works once)
signs the member out everywhere and sends them to log in and change their password.

### Warnings

`POST /users/{userId}/warnings` (`warnings.create`, `member.warn` over the member) gives points with
a reason and an optional expiry. The response returns the member's active points (the sum of
unexpired warnings). `GET /users/{userId}/warnings` (`warnings.list`) shows a member's warnings to
themselves and to holders of `warning.view`, each with the type it was given under.

A moderator's warning is held to `warning.maxPoints` (a type above it is refused for them) and to
`warning.perDay`, counted from the moderator log so a deleted warning does not give the place
back. A group with `member.warn` and no value for either is held to the built-in values (10 points, 20 a day), not to none; an explicit 0 allows none. A warning about
a post (`postId`, which must be the member's, and readable to the moderator) needs `forum.warn` in that forum instead of `member.warn`; a warning without a post needs `member.warn` over the member, wherever the member posts. So `never` on `forum.warn` in a forum stops warnings about its posts, and only removing `member.warn` stops the other kind. `POST /warnings/{warningId}/expire` (`warnings.expire`) ends a
warning now and `DELETE /warnings/{warningId}` (`warnings.delete`) removes it; both need
`warning.delete` over the member and lift the automatic actions the member's points no longer reach
in the same call. The staff panel offers them on a member's Sanctions tab.

**Warning types** (`/moderation/warning-types`, `admin.settings` to change them; moderators with
`member.warn` can read them) are named in English and Spanish, with default points, a default
expiry in days (none = never) and an optional default reason. A moderator sends `typeId` with
`warnings.create` and may change `points`, `reason` and `expiresAt` unless the type is locked, which
fixes points and expiry (the reason stays free). Without a type the warning is custom and needs
`points` and a `reason`; the lock binds the type, not moderators in general, so a custom warning
still takes any points and expiry. Deleting a type keeps its warnings, as custom ones (the type is gone at once; a job forgets
it on its warnings, a thousand per transaction).

**Automatic actions** (`/moderation/warning-actions`, `admin.settings`) fire when a member's active
points reach a threshold, in the same transaction as the warning: a ban, adding the member to a
group (a secondary group ranked below the administrator, never one that decides
`admin.permissions`) or a restriction, each for a number of days or permanently (the length is
always given: `days: null` is permanent). An action fires
once per crossing: it fires again only after the member's points have fallen below the threshold
and reached it anew. Members holding `member.immuneToAutoBan` are skipped. An action that cannot be
applied (a ban on the last administrator, a group that has come to decide `admin.permissions`)
refuses the warning with its reason. When points fall below the threshold (a warning expires), the
group memberships an action added for a limited time are taken back, and so are those whose time
ends; an hourly job notices both. Bans and restrictions end on their own date and are never lifted
early; permanent memberships, and memberships the member already had, stay. Changing an action
counts from the next warning; deleting one ends the timed memberships it added. A newly created action
applies to a member already over its threshold at their next warning. A group-adding action is
configured like `users.setGroups`: besides `admin.settings` it needs `admin.members`, the acting
administrator's own password (`actorPassword`; an API key is refused) and a rank above the group's,
to create it, change it or delete it (also when it is a group action that is being changed into a ban);
ban and restriction actions need only `admin.settings`. The rank is enforced when the action is
configured; when it fires the system acts, whoever warns. Deleting an action stops it firing at once; a job
takes back the timed memberships it added, a hundred members per transaction, and removes the row
(an action with nothing to take back goes immediately, with its fires). A super admin has no
rank ceiling when assigning a group by hand but has one here. Saving a member's groups with `users.setGroups` keeps
the rows of the groups that stay, so a timed group is still taken back (ticking it again changes nothing);
removing the group, saving, and adding it again makes it the member's own. When the system takes
back a membership the member still holds another way (made primary since), no "removed" event
is published. A warning given with `notify: false` adds and takes back the group
without a notification. The removal by the system leaves no moderator-log entry (the log needs an
acting member); its `member.groups_changed` event names the action (`reason: "warning_action"`).

### Bans

`POST /users/{userId}/bans` (`bans.create`, `member.ban` over the member) bans with a reason and
`expiresAt` (a future time, or `null` for a permanent ban) that may not be further away than the
acting member's `member.banMaxDays`. You cannot ban yourself. A banned
member is refused on every request and has no permissions; their sessions and API keys are revoked
in the background. Lift a ban with `POST /bans/{banId}/lift` (`bans.lift`, `member.ban` over the member). Lifting takes the reach setting takes: a ban longer than the lifter's `member.banMaxDays` (a permanent one needs -1), or put on by a member of higher rank, is not theirs to lift. There is no way to edit or extend a ban, so no other door to that length; the ban id
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

A forum also has `countsPosts` (on by default). While it is off, visible posts in it add nothing to their authors' post counts; moving, merging or splitting content between a counting and a non-counting forum moves the counts with it, and switching the setting queues a background job that recounts every member's post count (it is refused while a merge or split involving the forum has not finished, including one that failed and must be run again).

### Profile privacy

Members choose who sees their profile (`profileViewPrivacy`: `everyone`, `members`, `followed`
for members they follow, or `self`) and who may post on it (`profilePostPrivacy`: `members`,
`followed` or `self`) with `PATCH /me/preferences` (`preferences.update`). Holders of
`profile.bypassPrivacy` see and post on every profile. A profile hidden by privacy looks the same
as a missing one. Turning off the site setting `profilePostsEnabled` (default on) stops new
profile posts and comments for everyone, including holders of `profile.bypassPrivacy`; existing
ones stay visible.

The forum statistics panel (the ranked thread lists: latest posts, latest threads, most replied,
most reacted, most viewed) is a widget (`forumStats`): it is drawn where one is placed and enabled.
A new site places it above the forum list, enabled when the old site setting `forumStatsEnabled`
was on; the setting itself no longer changes the pages. `threads.ranked` answers either way.
Each tab lists `limit` threads (10 by default) and leaves out the forums the feed leaves out
(`feedExcludedForumIds`, and the ones the viewer hides), so archives kept out of the feed stay out
of the statistics too. A row is one line: rank, the starter's avatar with an online mark (green
when seen in the last 15 minutes, red otherwise, none for a visitor who may not see the member
list; members who hide their online status read as offline), the title (bold when unread, opening
at the first unread post), forum, replies, views, last post date and last poster; the columns
leave as the panel narrows, down to the avatar and title on phones. The option `topPosters` adds
the "Most messages" column (the ten members with most posts), drawn where the panel is at least
72rem wide. The panel is open until a visitor closes it.

## Home page and What's new

The home page (`/`) is the forum list: the categories under the section tabs
(`/?section=<tab id>&stats=<tab>`), with the widgets of its positions around them. It carries the
site's name as its title, the site's description and its structured data. The feed is on its own
page, What's new (`/novedades`), with four tabs in this fixed order: Latest, Hot, Following (members
only) and Media (the newest pictures attached to posts and wall posts, limited to what the viewer
may open). Every tab has an address that names it (`/novedades?tab=hot`). The wall composer and
the featured threads are drawn on the first three tabs only, and the featured threads not above a
list a filter narrowed.

Both pages draw the widgets of their positions (`widgets.current`, asked with the visitor's session
once per page): `overview_top` spans both columns above them; `forum_list_above` and
`forum_list_below` (`/`) or `novedades_above` (`/novedades`) sit in the main column above and below
the page's own content, `overview_bottom` after them; the sidebar holds `sidebar_top`, then
`forum_list_sidebar` (`/`) or `novedades_sidebar` (`/novedades`), then `sidebar_bottom`. A page
with no sidebar widget for the viewer (or only widgets of types the web app does not draw yet) has
no sidebar column. Below `lg` the sidebar is drawn below the content, one block under another; a
widget whose `phones` is off is not drawn below `md`, and a sidebar with no widget drawn there is
left out. A widget whose own read is refused or empty draws
nothing; one that fails is logged and draws nothing, and the rest of the page stands.

A forum or category page (`/forums/<id>`) draws a sidebar beside its content, below it on a phone:
`sidebar_top`, `forum_view_sidebar`, `sidebar_bottom`. The members pages (`/members`,
`/members/month`) hold the same three around `members_sidenav` in their left column, under the list
of views; on a phone the views are the chips above the content, and the column is drawn below the
content only when it holds a widget.

Widget types for the members: `visitorCard` (the signed-in member's picture, name, title and
counts; off on phones by default), `referralLink` (their invitation link, with Copy, Share and a
line on what it is), `monthStandings` (the top of this month, last month's before anyone scores,
with how the points are counted and, with `picker`, a field that opens
`/members/month?month=YYYY-MM`), `topReferrers` (all time, members with at least one referral),
`birthdays` (today's, as avatars) and `text` (an administrator's BB code, with a heading only when
the widget has a title). A guest is not given `visitorCard` or `referralLink`, nor a member who has
not confirmed their address the latter. `/members/month` is the standing of any month named with
`month=YYYY-MM` (`/members?view=month` goes there): the list exists for the running and the last
complete month, an older month shows its winner only, and the month field starts at the oldest
winner on record. `standings.month` accepts the same `YYYY-MM` from 2000 and tells how points are
counted.

Two widget types show who is around. `recentlyActive` ("Online in the last 24 hours", names only
and a "Total: N" line, the heading leading to the member list) reads `users.recentlyActive`: members
who hide their online state, and banned or erased ones, are not in it, and every visitor gets the
same list for up to a minute; its option `window` set to `15m` lists only those seen in the last
15 minutes ("Online now", counted from the list, which holds at most 200). Its option `limit`
(default 50, at most 200) is how many names are written out; the rest are counted ("and N more").
`siteTotals` reads
`site.stats` (`GET /site/stats`): threads and messages in the forums guests can open, members
(confirmed, approved, not banned, not erased) and the newest member, the same numbers for every
visitor and counted at most every ten minutes; the newest member is shown only to a visitor who may
list members.

The panel's Widgets screen (Setup, `/admin/widgets`, `admin.widgets`) lists the widgets under their
positions, in the order the pages draw them. A widget is added in two steps (its type, then its
form: position, title, enabled switch, phone switch, the type's options and who sees it, with the
same rule builder as notices), edited, duplicated into any position, deleted after a confirmation,
and put in order with up and down buttons (one position at a time, or all of them). The options on
the form come from the backend's schema for the type. A widget of a type, or in a position, the web
app does not draw yet is kept, listed and editable, and marked "Not shown yet".

The old addresses answer with a permanent redirect (308) that keeps the query: a feed tab or a
feed parameter on `/` (`/?tab=hot`, `/?cursor=...`) goes to `/novedades`, `/?tab=forums` and
`/forums?tab=<id>` go to `/` with the section, and XenForo's `whats-new`, `find-new` and
`novedades/...` go to `/novedades`.

The header's first entry (Forums) leads to `/` and its second (What's new) to `/novedades`. The
phone bar holds Home, What's new, the + button, Messages and Alerts (a guest: Home, What's new, the
+ and Log in); Home is current on the forum list, a forum and a thread. The profile is reached from
the avatar menu.

The bar shows three tabs and puts the rest in a "More" menu. It holds the visitor's default tab and
then the first tabs of the order above that are not it, up to three, drawn in the fixed order (a
default of Media gives Latest, Hot, Media). The tab that is open is always on the bar: when it is
not one of those, it takes the place of the last of them that is not the default. A guest has no
Following tab. The menu's entries are links only once it is opened (a browser without JavaScript
cannot reach them from the bar).

A visitor opens the tab their address names. With no tab in the address, a member opens the tab
they chose in their preferences (`homeTab`, null for the site default); otherwise the `homeTab`
setting decides (`PATCH /settings`, admin panel: Settings, What's new): an ordered list of
`{ rule, tab }` entries, where the first rule the visitor meets wins, and a fallback tab. Rules are
the shared criteria rules, cheap criteria only (they are checked on every page view). Guests are
decided by the same rules (`is_guest` and the criteria that need no account apply to them; a guest
is in no group). Following needs an account, so a rule a guest can meet, and the fallback, cannot
pick it, and a guest who asks for it gets Latest.

`auth.me` carries both the member's choice (`user.homeTab`) and the tab decided for them
(`user.openHomeTab`), so What's new makes no extra request for a member. `GET /site/home-tab`
(`site.homeTab`) answers the same for any caller, guests included; `GET /media` (`media.list`) is
the Media tab.

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
| `conversation.added` | A member added to a conversation |
| `conversation.message` | The other active participants, on a new message after the first (not the sender, members who left, or members who ignore the sender): one unread alert per conversation, which a burst of messages updates instead of repeating; it clears when the conversation is opened |
| `moderation.content`, `moderation.member` | A member whose content or account a moderator acted on (with `notify`) |
| `report.resolved` | Reporters, when their report is resolved or rejected (with `notify`) |
| `moderator.report`, `moderator.approval` | Moderators who can handle a new report or approve new content |
| `moderator.signup` | Staff who hold `member.approveRegistrations`: one standing alert that lists the newest accounts waiting for approval; it clears when nobody waits |
| `member.groups` | A member whose groups changed (not when email confirmation moves them to Member) |
| `announcement` | Every member, for `POST /announcements` (`announcements.create`, needs `admin.announcements`) |
| `account.security` | Reserved: email only and cannot be turned off. Nothing creates it in this release; account emails are sent separately (see [Account emails](#account-emails)). |

Nobody is notified of their own action or of content they cannot see. A member who ignores
someone is not notified of that member's actions, except for moderator duty notices; staff
cannot be ignored (they lack `member.ignorable` by default), so their actions always notify.

### Channels and preferences

Each type has three channels: in-app, email and push. Out of the box every type is in-app only,
except `account.security`, which is email only, `conversation.message`, which is in-app and push
(as XenForo's push for conversations is on by default; it reaches only members who registered a
device), and the watch types described below. Members
change their own choice per type and channel with `GET`/`PUT /notifications/preferences`
(`notifications.preferences`, `notifications.setPreferences`); `null` returns a channel to the
site default.

When the background fan-out creates a notification, it also queues an email and a push message
for each member who has that channel on. Email needs a mail driver other than `none`; push needs
Web Push configured and a registered device. Rules:

- **In-app comes first.** A member who turns in-app off for a type gets no notification of that
  type, and so no email or push for it either.
- **Once per unread group.** A grouped notification (see below) sends one email and one push
  message. Further replies, reactions or conversation messages folded into it while it is unread
  do not send again.
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

- **Grouping.** Reactions to the same item, new replies in the same watched thread, and new messages
  in the same conversation, fold into one unread notification that shows the most recent actors (up to five) and how many different
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
  before email was enabled keep their groups. The site setting `requireEmailConfirmation` (on by
  default; **Settings > Members** > Registration) turns this off for new accounts: they join Member
  at once, the sign-up sends no link and the welcome email goes out at sign-up (a member can still ask
  for a link, and email change works as always). Accounts already Unconfirmed stay so.
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

## Referrals

A member brings others to the forum through their links. A referral is recorded once, on the
referred member (`referred_by`, `referred_at`), and counted on the referrer (`referralCount`); the
`referrals_at_least`, `referrals_this_month` and `was_referred` criteria, the referrals ranking and
the member of the month points read it.

**The link.** In the web app, a signed-in member's Share and Copy link buttons add `?ref=<their member
id>` to the address (after any query and before any `#`). A guest's copy is the plain address, and
so is a link copied from the browser's address bar. The member's own link, `/register?ref=<id>`, is
under Invite members in their account settings.

**Arriving.** A visitor who opens any page with a valid `?ref=` (a positive whole number) and has
accepted the Referrals cookies in the cookie banner (under the current policy version) gets the `forum_ref` cookie: HttpOnly, SameSite
Lax, Secure when the site is served over https, 30 days. The first referrer wins; a later link never
replaces it. A visitor who has not accepted it gets no cookie, and a cookie that is no longer
accepted is removed on their next visit. A signed-in member is not given the cookie. Pages
that state a canonical address take it from the forum, which never includes `ref`, so a `?ref=`
link is not a second page. Without the cookie, a visitor who registers straight from a
`/register?ref=<id>` link is still credited, because the register form carries the `ref` of the page.

**Registering.** The web app sends the referrer (the cookie's, else the form's) with the sign-up
as `ref`; the Better Auth sign-up body accepts it, as a number or as plain decimal text. The
cookie is deleted once the account exists.

- On a site without account email, the referrer is recorded at registration.
- On a site that asks members to confirm their address, the registration only holds the referrer
  (`users.pending_referrer`). It is recorded only once the member's address is confirmed: when
  they follow the confirmation link, or at their next sign-in if the address was confirmed some
  other way. Signing in with an unconfirmed address records nothing, so made-up addresses bring no
  referral. A member confirming after the seven days brings none either.
- A referrer is accepted only within seven days of the registration, and never when it is the
  member themselves, a member who is banned, erased or still waiting to confirm their own address, a member the new member already referred, or
  when the member already has a referrer. A refused referrer is dropped without a message: it never
  blocks the registration or the sign-in. A held referrer is tried once.

Erasing a member ends their links as before: the referrer's count drops by one and the members
they referred lose their referrer.

## Registration

**Settings > Members** > Registration holds the rules of the sign-up, as XenForo's registration
options do. They are enforced by the backend on the sign-up request (`POST /api/auth/sign-up/email`),
not only by the form, and a refusal creates no account. The defaults leave a site as it was:
open, no extra fields, no age, confirmation as the mail driver implies.

| Setting | Default | Effect |
| --- | --- | --- |
| `registrationOpen` | on | Off: every visitor's sign-up is refused with `REGISTRATION_CLOSED` (403); `/register` says registration is closed, and the sign-in page and the header leave out the link. Existing accounts are untouched, and the call the server makes to create the first administrator is not a visitor's request. |
| `approveSignups` | off | New accounts wait for staff, see [Sign-up approval](#sign-up-approval). Together with `registrationOpen` these are the three states of XenForo: closed, open, open with approval. |
| `requireEmailConfirmation` | on | See Verification under [Account emails](#account-emails). It does nothing without a mail driver: nobody can be asked. |
| `minimumAge` | 0 | Above 0 the form asks for a full date of birth and a visitor younger than this is refused with `UNDER_MINIMUM_AGE` (403). The date is stored on the profile, where the member can change it later like any profile field (the age is checked at sign-up only). 0 asks for no age. |
| `registrationFields` | none | Profile fields a visitor must fill in: `birthday` (full date), `location`, `website`, `about`, `discord`, `telegram`, `x`. A missing or blank one is refused with `REGISTRATION_FIELD_REQUIRED`, an invalid one (a date that does not exist or lies in the future, a website that is not an http(s) URL) with `INVALID_PROFILE_FIELD`. |

The sign-up request carries the fields in a `profile` object (`{ "birthday": { "year", "month",
"day" }, "location": "...", ... }`). Only the fields the site requires are asked on the form;
`site.get` says what the form should ask (`registration`: `open`, `approval`, `minimumAge`,
`fields`, where `fields` already holds `birthday` when there is a minimum age). Any other key of `profile` is
ignored, as it was before these settings existed; the age is counted in whole years by the UTC
calendar day.

## Sign-up approval

The site setting `approveSignups` (off by default; **Settings > Members** in the panel) makes new
accounts wait for staff. An account is held when it registers (`users.signup_review`); it
**awaits approval** once its email is confirmed too (at once on a site that asks for no
confirmation, or when an administrator moves it out of the Unconfirmed group), and until then it is
an ordinary unconfirmed account. Turning the setting off lets new accounts in again but leaves the
ones already waiting in the queue: staff can still decide them, the queue stays reachable
(`/moderation/signups` opens for the permission, whatever the setting says) and holds them until it is
empty, and an unconfirmed account that was held joins it when it confirms.

An account that awaits approval can sign in and read exactly what a guest reads: its permissions
are the Guest group's, whatever groups it holds, and it takes no staff rights. Every operation that
writes and is not open to anyone (an account's own removals such as unfollowing, and accepting the
terms, stay open) is refused with a `forbidden` error whose issue path is `approval`, so it cannot
post, react, message or edit its profile, nor upload. The one thing it keeps is leaving: it can
delete its own account (`users.deleteOwnAccount`, see Deleting an account), which takes it out of the
queue. It is left out of the member list, the member search and the profile pages of others (staff
who bypass profile privacy and the member themselves still open it), and the web app shows it a
notice. `auth.me` says `awaitingApproval`. The language of the sign-up request (the `forum_locale`
cookie, else `Accept-Language`) is stored as the member's language, so the mails are in it.

The queue is `GET /admin/signups` (`signups.list`; `/moderation/signups` in the panel), newest first,
for holders of `member.approveRegistrations` (moderators and administrators by default). Each entry
shows the username, when it signed up, whether the spam check flagged it, the country and, for
holders of `member.viewIps`, the address and the other accounts seen on it, and the terms accepted.
The email address is shown in full only to staff who hold `admin.members` over the account, as in the
member pages; to the others it is masked (`j***@example.com`). There are no registration questions,
so none are shown. A sign-up the spam check flags is refused when the setting is off, as before;
with it on it lands in the queue marked and is never approved by itself. `pendingSignups` in
`auth.counters` counts the waiting accounts (at most 99, as the other queues) for staff who hold the
permission. A banned account that waits is not in the queue while the ban runs, except one whose erasure stopped
part way (`erasureStopped`: it stays listed so it can be finished). Staff who hold the permission get
one standing `moderator.signup` alert listing the newest newcomers (it grows with each, rather than
one alert per account). It follows the queue: it clears when nobody is in it any more (after a
decision, a ban, an erasure or the member deleting their account) and is raised again for an
account that comes back (a ban lifted, or a ban for a time that ends, for which a job runs at that
time). That is the simplest correct shape: events at the places that change membership, plus one job
per timed ban, rather than a periodic sweep.

`POST /admin/signups/decide` (`signups.decide`) approves or rejects up to 50 accounts, one by one:
an account no longer waiting, or one the actor may not act on, is skipped and reported without
stopping the rest. Approving clears the hold and emails the member. **Rejecting bans the account by
default**, which keeps the sign-up address and the terms record that the queue shows for the next
account of a spam wave. The ban is the actor's own: it needs `member.ban` over the account and is
bounded by `member.banMaxDays` exactly like `bans.create` (`banDays` null bans for good and needs
−1; otherwise the days may not exceed the bound). A ban for good closes the account; a ban for a time
keeps the account held and out of the queue until the ban ends, so it cannot become a member by
waiting it out. **Rejecting by erasure** is a choice (`mode` `delete`): it is the erasure of
`users.adminErase`, so it needs `admin.members` over the account (and `admin.permissions` when the
account holds any), the actor's own password and a session (an API key is refused), and it removes
the sign-up address and the terms record. An erasure that stopped part way leaves the account
in the queue, marked; only deciding again by erasure finishes it (approving or banning it is
refused), and it sends no second mail (the mail is queued by the transaction that marks the account
erased, once). A second decider on an account being erased gets a conflict. Either way the member is emailed the
reason, if one was given, in their language; the address is dropped from the mail job on every way out
(sent, undeliverable, given up) and no failure record or job error keeps it. Each decision is one moderator log entry, `signup.approve` or
`signup.reject` (an erasure also writes its ban entry, as any erasure does).

## Batch update members

`/admin/users/batch` in the panel (`users.batchPreview`, `users.batchUpdate`; both need
`admin.members`) applies one action to many members, in two steps. **Preview** chooses the members
by a rule of the same criteria engine promotions use (never an empty rule, and only the criteria that
are cheap to check in a request; one that counts a member's history is refused by name), or by a list
of ids and usernames (up to 100), and returns the matching ids: a run looks at most 10,000 members in
id order and takes the first 100, and `next` says where to continue. **Apply** takes exactly those ids
(`userIds`, never the rule or list again), so what runs is what was shown; the panel hides Apply when the
rule or list is edited after a preview.

The actions: set the primary group, add or remove a secondary group, set or clear the custom
title, remove the avatar, remove the signature, ban (for a number of days within the actor's
`member.banMaxDays`, or for good where that allows), lift the bans in force, and erase the account.
Groups and erasing need the actor's own password (session only) and erasing a reason, as the single
actions do; bans need `member.ban` and a reason. Each member goes through the single action's own
checks and transaction: one the actor may not act on (rank, permissions), a super admin, the actor
themselves, an erased account, or one with nothing to change is **skipped** and reported with the
reason, and the rest go on; an id that is no member is reported as failed. An erasure that stopped
part way is finished by erasing again. Each member changed is one moderator log entry, written as the
single action writes it; the batch writes none of its own. Nothing holds a write transaction for the
whole run.

## Deleting an account

A member with `profile.deleteAccount` can close their own account from **Security** on
`/account/security` (`POST /me/delete-account`, `users.deleteOwnAccount`). It runs the same
erasure as `users.adminErase`: the account is marked erased and banned for good, sessions and API
keys end, and the address, password, profile details, pictures, push devices, saved cookie choice,
accepted-terms record, logged addresses, follows and referral links are removed. What the member
wrote stays under the name `Deleted member <id>`, and the ledger, warnings and moderator log keep
their entries (the log's `member.erase` entry names the member as the actor). The member types
their username and their password to confirm, and an API key is refused. A super admin cannot
delete their own account (the flag is handed on first) and neither can the last
administrator. If a deletion is interrupted part way, the account stays closed (erased and banned)
but some details may remain, and the member cannot run it again. The server logs
`[users.eraseInterrupted]` with the member's id and the step; an administrator finishes it
through the API (`users.adminErase`), because the member's page in the panel draws no erase form
for an erased member.

## Cookie banner and consent

The web app asks visitors and members for their choice before it uses anything optional: visit
statistics, the referral cookie and videos or music from other sites. The page `/cookies` lists
everything the site stores in the browser and is built from the code, so it cannot drift from it.
Settings are on **Cookies and privacy** (`/admin/settings/cookies`, `admin.settings`).

- **The policy version** (`site.get` `cookiePolicyVersion`, starts at 1). A saved choice answers one
  version; when the version changes it stops counting, in the browser and on member accounts, and
  the banner asks again. It only goes up, by one, with **Ask everyone again** (`consent.askAgain`):
  `settings.update` ignores it. The web app's proxy keeps the version for a minute, so a change
  reaches the referral cookie within about a minute.
- **The banner outside Europe** (`cookieBannerOutsideEu`, on by default: everyone is asked). Off, only
  visitors in the EU, the EEA (Iceland, Liechtenstein, Norway), the United Kingdom and Switzerland, and
  visitors whose country is not known, are asked (`consent.banner`). The country is read only from the
  location headers of a trusted proxy (`SERMO_TRUST_LOCATION_HEADERS=true`, see
  `docs/deployment.md`); nothing a browser sends counts, and without a trusted country every visitor
  is asked. A guest who is not asked and has never answered the banner is treated as having
  accepted every category until they choose in **Cookie settings** (footer); a choice they make
  is kept as any other. Anyone who answered the banner before, under any policy version, and every
  signed-in member, is asked: raising the policy version never turns an earlier refusal into an
  acceptance, and until they answer nothing optional runs.
- **Matomo without cookies** (`matomoCookieless`, off by default). The Matomo tag then runs with
  `disableCookies` and is loaded without consent; the banner has no statistics choice and the cookie
  policy page says the statistics need none. It does nothing for Google Analytics. Whether
  cookieless statistics need consent differs between countries: check the rules that apply to you.
- **The words of the cookie policy page.** Write a page with the slug `cookies` under **Pages**: its
  title and text replace the draft that ships with the site; the list of cookies below it stays
  generated. Delete the page to go back to the draft. The privacy page links to the cookie policy.

**Saved on the account.** For a signed-in member the banner also saves the choice (the optional
categories accepted, the policy version, the time) with `consent.save`, and it follows them: at
sign-in or registration the browser's choice is saved if the account has none for the current
version; if the account has one it stands: a browser that holds none or a different one takes the
account's (the page after such a sign-in is a full load, so the banner reads it), so it is not asked
again, and what an earlier user of a shared browser clicked never replaces the member's answer. The
record's time is the one the banner recorded for the choice (never later than the server's clock),
else the time it was saved. Signing out removes a consent cookie that was written from the account. Changing the choice on any device updates the record.
`consent.mine` reads it. A device keeps the cookie it has until its own next choice or sign-in, so
a choice withdrawn on another device reaches it then. The record is one row per member (the latest
choice, not a history) and is deleted when the member is erased. Staff who may view a member's details
(`admin.members` over the member) see it read only on the member's details page
(`users.consent`), to show a regulator.

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

## Installing the forum

A browser can install the forum on a phone or computer: the site's name, description and first
accent colour come from the site settings, and its icon is the uploaded site icon, or the default
mark when there is none (`/manifest.webmanifest`). The site reads them again within a minute of a
change, but a device that already installed it keeps what it had until the system refreshes the
manifest.

A small service worker (`/sw.js`, a file `bun run build` bundles with the app) is registered by
production builds on `https` and `localhost`, once a page has loaded. It does two things only:

- It keeps the scripts, styles and fonts of the build (`/_next/static/`, named by their content, so
  they never change; pictures are left out, the data saver decides those) and serves them from the
  device first, at most 200 files for 30 days.
- When a page cannot be loaded because the device has no connection, it shows a short page in
  English and Spanish with a button to try again. This page is kept from the first visit
  (`/offline.html`).

Pages, the API, files, uploads and everything a member writes always go to the network and are
never kept: there is no offline reading, no background sync and no push (the worker has no handler
for the Web Push messages described above). A new deploy takes effect on the next visit: the
browser checks the worker script every time, a new worker replaces the old one at once, and it
drops the caches of an older version.

What the worker keeps in a browser (the worker itself, Cache Storage `sermo-static-*` and
`serwist-precache-*`, and the IndexedDB database `serwist-expiration`) is listed on the cookie
policy page as strictly necessary: it holds only the site's own public files, no account data and
no identifier, and the site works without it. A visitor clears it with the browser's site data.
Changing what is kept or why is a reason to raise the policy version (**Ask everyone again**, see "Cookie banner and consent").

### Retiring the worker

If the worker ever misbehaves, deploy a build whose `/sw.js` removes it: set `SERMO_RETIRE_WORKER=1`
for the build (`docker compose build --build-arg SERMO_RETIRE_WORKER=1 web`, or the variable in
the environment of `bun run build`). That `sw.js` has no fetch handling at all: a browser that has
the real worker finds it on its next visit (it checks the script every time), installs it at once,
and it deletes the `sermo-` and `serwist-` caches and the `serwist-expiration` database and
unregisters itself. That build registers no worker on any page, so a device that never had it does not
install the retiring one. Keep that build deployed for at least a month, so devices that come back
rarely are caught, and only then remove `<WorkerRegistration />` from the layout and the worker's
files: removing them first leaves the workers already installed in place. Rebuild without the
variable to bring the worker back.

## Formatting for members

Posts, profile posts, comments and conversation messages are BB code (XenForo's tags: `[B] [I]
[U] [S] [COLOR] [FONT] [SIZE] [URL] [EMAIL] [USER] [IMG] [MEDIA] [ICODE] [PLAIN] [ATTACH]
[ISPOILER] [LEFT] [CENTER] [RIGHT] [QUOTE] [SPOILER] [CODE] [INDENT] [LIST] [TABLE] [HEADING]`,
and `[HR]`), up to 10,000 characters. A line break is a line break and a blank line starts a
paragraph. Markdown and raw HTML are shown as typed, and so is a tag that is unknown, malformed
or never closed. Bare http(s) and www addresses become links, which get
`rel="nofollow ugc noopener"`. A message whose reading takes over 50 ms is refused as too complex.
Sermo adds:

- **Mentions.** `@name`, or `@"name with spaces"`, for a username of 3 to 32 characters. The
  mentioned member is linked and notified. Mentions inside links do not count. Each item may
  mention up to `mention.maxPerItem` members (10 for members, unlimited for moderators and
  administrators by default); members who joined less than `newMemberDays` ago are also limited to
  `newMemberMentionLimit` (default 3). Names beyond the limit, or unknown names, stay plain text.
  Editing keeps the mentions an item already had and notifies only newly mentioned members.
- **Quotes.** A quote of a forum post, written the way XenForo does:

  ```
  [QUOTE="Name, post: 123, member: 4"]
  The quoted text.
  [/QUOTE]
  ```

  The author's name and member number are filled in when the content is saved. You can quote only
  posts you can see; a quote already in an item stays valid when it is edited. The quoted author
  is notified. `[QUOTE]` and `[QUOTE=Name]` quote nothing in particular.
- **Spoilers.** A collapsed block, with an optional title, and an inline one for a few words:

  ```
  [SPOILER="Ending"]
  Hidden text.
  [/SPOILER]
  ```

  `[SPOILER]` without a title shows "Spoiler". For a few words, use `[ISPOILER]hidden text[/ISPOILER]`.

Quotes and spoilers can be nested inside each other up to 10 levels deep each, and any tags up to
30 levels deep in total.

## Tags

A hashtag is `#` and 1 to 50 letters, numbers and `_` with at least one letter (accents work),
not preceded by a letter, number, `&`, `/`, `=` or `#`; `a#b`, `##x`, `&#123;` and the fragment of an address are
not tags. Code, plain text, links, addresses and the attribution of a quote hold none. A name is
compared in NFC and lowercase (a Greek final sigma is folded to `σ`), with the characters that draw nothing (variation selectors, joiners, the Hangul fillers: Unicode's default-ignorable characters) taken out, so `a` and `a` with a variation selector are one tag; a combining mark that composes with its letter is that letter after NFC, one that does not stays. A name needs a letter that draws something. In posts, thread opening posts and conversation messages a
hashtag that names a tag links to `/tags/<name>`; wall posts, comments, signatures and pages
show it as typed.

- **A thread's tags** are the ones set when it is started (`tags` of `threads.create`) or later
  (`tags` of `threads.update`, which replaces the list), and the hashtags of its opening post.
  Only the thread's author (while it is unlocked) and staff (`forum.editAny` in the forum, or
  `tag.manage`) may change them. Taking tags off needs nothing more; putting tags on needs `tag.apply`
  (a posting restriction takes `tag.apply` and `tag.create` away, leaving the removal) or, for a
  group that holds `tag.manage` and is not restricted, nothing else; a thread holds at most 10. Editing the opening
  post takes off the tags its earlier hashtags put there; tags set by hand stay. Hashtags in
  replies only link, and an unknown one stays plain text; so do those in conversations, which
  never create a tag or tag a thread. A hashtag inside a `[SPOILER]`, `[ISPOILER]` or `[QUOTE]` of
  the opening post links where it stands when the tag is known, and never tags the thread or makes
  a tag. A tag counts as known to a writer only if one of its visible threads is one they can read (a
  forum whose threads are open to them, and the opening post's text for the tags its hashtags put
  there) or is their own: tags of deleted, held or unreadable threads are not known, so a link, or
  a refusal to list it, never tells them about them. A moderator who saves
  a tag list without being able to read the opening post keeps the tags its hashtags put there.
  A tag the opening post's hashtags put on a thread is that
  post's text: a viewer who may not read it (`forum.viewContent`) does not see the tag on the
  thread or on the tag page. Merging threads moves the tags of the thread merged away to the
  other one (never past 10).
- **The tag page** (`tags.get`, `tags.threads`, `/tags/<name>` in the web app) lists the threads
  carrying the tag, newest activity first, under the rules of a forum's thread list (forums the
  viewer cannot open, `forum.viewOthers`, moderated and deleted threads, merged threads out).
  A tag with nothing the viewer may open does not exist for them: it is a 404 only once every list
  was read to its end without finding one (each list is walked at most 2,048 entries per request;
  past that the page is shown, possibly empty, with a link to go on from where it stopped). A tag
  kept only for its old names shows an empty page. It is
  indexed, and listed in
  the sitemap (`tag-<n>.xml`), only with at least 3 threads whose titles and text are open to
  guests.
- **Managing.** Renaming or merging keeps the old name as an alias, so links and hashtags already
  written keep working; deleting a tag leaves them as links to a page that no longer exists. A tag
  that no thread carries any more goes away by itself, unless it has old names (they were chosen by
  staff): it stays, with no page, and the name reaches it again when a thread takes it. The screen is
  `/admin/tags`; renaming, merging and deleting check the permission again inside the transaction.
- **Criterion.** `tags_added_at_least` (tags a member has put on visible threads that still carry
  them, as `post_count` counts visible posts of visible threads: hiding a thread or holding it for
  approval takes its tags out of the count, restoring or approving it brings them back) is a
  counter on the member's row, so promotions, awards, notices and the shop can use it.
- **Search.** Search treats `#rust` as the word `rust`; the web app sends a search for a single
  hashtag that names a tag to that tag's page.

## Polls and quizzes

A thread can carry one poll or one quiz. A poll is a single question with 2 to 20 answers; a quiz
is a series of up to 20 questions of 2 to 8 answers, one of them right. Either is written with a new
thread (`poll` of `threads.create`) or added later (`polls.create`, `/threads/<id>/poll`) by the
thread's author while it is unlocked, or by staff who manage polls. Questions and answers are one
line of text (200 and 100 characters): BB code is read for its words only (tags, pictures and links
leave nothing), and every text is under the rules a post's text is under: the word filter rewrites
it, and a text a filter holds for approval, or that carries a link from a member who joined less than
`newMemberDays` ago while the site holds those, is refused (with a new thread it holds the thread
instead: a poll has no queue to wait in). The flood interval (`floodSeconds`) and the daily post limit
apply to a poll added to a thread later and to a voter's own answer (checked in the write, against
the member's other writes: an answer is not itself on the flood clock; one answer per member and poll
bounds the rest). Each question and answer may carry a picture, an
attachment of the poll that follows the thread's reading rules (and `forum.viewAttachments`); the
data saver blocks it like any post picture.

- **Poll options.** Single or multiple choice (up to `maxChoices`), an optional close date or
  closing by hand (`polls.close`, which also reopens: a reopened poll loses a close date that has
  passed), whether a vote may be changed, whether voters may add one answer of their own (checked
  like the creator's text, under `poll.addAnswer`, which a posting restriction takes away), and
  when the results are shown: always, once the viewer has voted, or once the poll closes. A closed
  poll shows its results to everyone; its creator and staff who manage polls always see them.
  Voters are public or anonymous, chosen when the poll is made: an anonymous poll never lists
  voters to anyone, staff included, and nothing written to the moderator log names a voter.
- **Quizzes** are taken one question at a time. An answer is final and the web shows at once
  whether it was right, which answer was, and the question's explanation; the score is kept with the
  member. `polls.get` never carries a right answer or an explanation for a question the viewer
  has not answered (nor to the creator and staff: they read them with `polls.definition`, which
  needs the right to edit), and a quiz never carries vote counts. Once a member has taken a quiz its
  questions, answers and right answers cannot change (texts and explanations can); delete it to
  start over.
- **Permissions** (per forum): `poll.create`, `poll.vote`, `poll.addAnswer`, `poll.closeOwn`,
  `poll.closeAny`, `poll.viewVoters` (members by default) and `poll.manage` (moderators and
  administrators: edit and delete any poll, add one to any thread). Voting needs a visible thread
  whose posts the viewer may read (`forum.viewContent`): a titles-only reader sees no poll. Every
  write re-checks the member inside its transaction. A new poll and a voter's own answer are written
  content: the forum's posting rules (read-only, minimum account age and post count; `forum.bypassNodeRules`
  skips them) and the terms hold, a member banned from the thread cannot add an answer, and a member whose own posts
  are held for approval (`firstPostsToModerate`, the approval rule) adds no poll to a thread and no
  answer to a poll until they are free of it (refused with a message: a poll has no moderation queue);
  voting is
  not posting and follows only `poll.vote` (a locked thread still takes votes). The creator may delete a poll nobody voted in
  and remove or reword an answer nobody voted for; staff may do either any time (the votes go with
  them). A poll a moderator closed is reopened by a moderator only (the log says who closed it).
  Lowering `maxChoices` leaves earlier votes as they were.
- **Editing and the stale editor.** `polls.update` replaces the whole definition. `polls.definition`
  returns `updatedAt` and an edit sends it back as `loadedAt`: when the poll changed since (a voter
  added an answer, a close, another edit; a vote does not count) the update is refused as a conflict
  whose issue is named `loadedAt`, and nothing is changed. The web then offers to load what changed:
  the answers added meanwhile join the list and what the editor typed is kept. An edit that names no
  `loadedAt` (a plain API call) never removes an answer a voter added. Other refusals are other
  conflicts with their own message (a quiz that has been taken, an answer with more votes than one
  batch to remove, moderation rules that changed).
- **Deleting a large poll.** Each vote and ballot fires a counter trigger, so one transaction removes
  at most 2,000 voters. `polls.delete` of a poll with more voters answers at once (`completed:
  false`): the poll is taken out of sight in that call (it reads as not found for everyone, its thread
  has no poll and takes no new one meanwhile) and one background job (`polls.purge`, one per poll, run
  by the job worker, which holds WAL checkpoints while it runs) removes the voters one batch per write
  transaction, letting other work in between, and then the poll itself. Deleting it again, or deleting
  its thread, adds no second job. Only staff finish such a poll's deletion (a creator cannot delete a
  poll that has votes); one entry is written to the moderator log, with the poll's kind and how many
  members voted, never who. A hard delete of a thread whose poll (or a merged-away thread's poll) is
  that large hides the poll and queues the same job, answers `completed: false` with nothing removed,
  and removes the thread on the first call made after the job has finished. An author's own one-step
  delete of such a thread is refused. An answer with more votes than one batch cannot be removed by an
  edit (delete the poll, or keep the answer).
- **What happens to a poll.** Hiding a thread hides its poll; hard deleting a thread removes it
  with its votes and pictures. Merging threads moves the poll of the merged thread to the target when
  the target has none; otherwise it stays on the merged-away thread, out of sight, until that thread
  is deleted for good. Splitting leaves it with the original thread, moving a thread keeps it (the new
  forum's permissions apply), batch updates and erasing a member's account leave votes as they are
  (an erased voter shows as `Deleted member <id>` in a public poll).
- **Search and SEO.** The question text is part of the thread's opening-post entry of the search index
  (kept by triggers on `polls`), so a thread is found by its question; answers are not indexed.
  Results are not in a thread's metadata or structured data, and are marked `data-nosnippet` in the page.
- **Criterion.** `polls_voted_at_least` (polls voted in and quizzes started) is a counter on the
  member's row (`users.poll_vote_count`, kept by triggers on `poll_ballots`), refreshed by the
  `poll.voted` event.

## Operations

The single server process runs everything; there is no separate worker to deploy.

- **Background jobs.** Durable work (notification fan-out, emails, push messages, spam cleanup,
  merges and splits, promotion and award sweeps, credit balance repairs, shop expiry, file cleanup)
  is stored in the `jobs` table and run by the job worker, which checks for due jobs every second.
  A failed job is retried after 30 seconds, 2 minutes,
  10 minutes and 1 hour, and is marked `failed` after five attempts. Finished jobs are deleted
  after seven days.
- **Scheduler.** Every second: events are handed to notifications, promotions and the other
  subscribers, including credit rules and awards. Every five seconds: thread views, downloads and
  member activity are written. Every minute: temporary shop item expiry is queued. Every
  hour: expired sessions, API keys and verification tokens, old read markers, finished jobs and old
  read notifications are purged, and search engine (IndexNow) and file cleanup work is queued. Daily at 03:00 UTC: the
  promotion and award sweeps, credit balance repair, file cleanup, the deletion of old address-log
  rows, a rebuild of the stored counters,
  and SQLite's `PRAGMA optimize`.
  Weekly on Monday at 04:00 UTC: the email digest.
- **Checkpointer.** SQLite runs in WAL mode; a background thread copies the WAL into the database
  file every second so requests never pay for it. While a background job runs, checkpoints pause
  (a checkpoint beside a stream of job writes can stall them), but never for more than 30 seconds
  after the last complete checkpoint, so the WAL stays bounded even when jobs run back to back.
- **Shutdown.** On `SIGTERM` or `SIGINT` the server stops accepting connections, finishes the
  requests in progress, writes buffered views, stops the scheduler and the job worker (waiting up
  to 30 seconds for the current job), closes the mail connection, and closes the database.
- **Backups.** See [Backups](../README.md#backups) in the README.
