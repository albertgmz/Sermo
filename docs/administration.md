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
| `reaction_given` | The member reacting to visible content, for any reactable content type |
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
or `legendary`), XP and credits per grant, and flags for active and stackable. XP and credits
are nonnegative whole numbers, each up to 1,000,000. Award lists show legendary first, then gold,
silver and bronze, with higher XP first within each tier. XP accumulates in the member's total.

A stackable award can be held several times; a non-stackable one cannot be granted while the
member already holds it. Each grant adds XP and pays the award's credits through the ledger.
Grant and revoke by hand with `award.grant`, with an optional reason of up to 500 characters.
Revocation targets one grant and takes back exactly the XP and credits it originally gave, even
if the award's values have since changed; the balance can go below zero. Credit rules attached
to that grant reverse separately when the revoke event is processed.

An award whose `rule` has no conditions is manual only. Otherwise the rule must hold for an
automatic grant. Members are evaluated after relevant activity (including credit changes and
purchases) and by a daily sweep. Each award is granted automatically at most once per member,
even when stackable. Losing eligibility never takes it back, and revoking an automatic grant
never makes the criteria grant it again. Manual grants remain possible under the stackability
rule; a held non-stackable manual grant prevents an automatic grant while it is held.

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

Catalog and holder calls need `profile.view`; inactive awards are shown there only to holders
of `admin.awards`. Member award calls require access to that member's profile and include the
awards they still hold, even if deactivated. Managing awards, reading criteria and queuing a
sweep need `admin.awards`.

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
| `promote` | A consumable. Use needs `threadId` (an unlocked, visible thread of the member, not already featured) and features it for 24 hours, marked as promoted. The 10 newest features are listed first in Hot whatever their activity; an older one is listed there only where it ranks. The home page lists the newest features. One unit is one promotion; nothing is refunded if the thread is deleted afterwards. |
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
| `profilePost.approve`, `profilePost.deleteAny`, `profilePost.undelete`, `profilePost.editAny`, `profilePost.viewModerated`, `profilePost.viewDeleted` | Moderating profile posts and comments | Moderator, Administrator |
| `report.manageProfiles` | Handling reports on profile content and on members | Moderator, Administrator |
| `member.warn`, `member.restrict`, `warning.view` | Warnings and restrictions; reading anyone's warnings and restrictions | Moderator, Administrator |
| `profile.bypassPrivacy` | Seeing and posting on profiles whatever their privacy settings | Moderator, Administrator |
| `wordFilter.view` | Listing word filters | Moderator, Administrator |
| `moderation.access` | Marks the member as a moderator in `auth.me` (`isModerator`) so clients can show the queues | Moderator, Administrator |
| `member.ban`, `member.spamCleanup` | Global bans and spam cleanup | Administrator |
| `conversation.moderate`, `conversation.viewHidden` | Moderating private conversation messages and their reports; seeing hidden messages there | Administrator |
| `wordFilter.manage`, `moderatorLog.view` | Managing word filters; reading the whole moderator log | Administrator |
| `member.viewIps` | "View IPs": the addresses members signed in, registered and posted from, and who shares them; only for members the holder outranks | Administrator |
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
  (`forum.feature`: a staff pick that lasts until it is ended; the 10 newest features are listed first in Hot, an older one only where it ranks, and `GET /featured-threads` lists every current one for the home page),
  `PUT /threads/{threadId}/lock` (`forum.lock`), `POST /threads/{threadId}/move` (`forum.move` on both forums). Replying in a
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

The forum statistics panel of the forum list (the ranked thread lists: latest posts, latest
threads, most replied, most reacted, most viewed) is shown only while the site setting
`forumStatsEnabled` is on (default off; General settings in the panel). `GET /site` (`site.get`)
carries the switch for the web app; `threads.ranked` itself answers either way.

## Home page

The home page has five tabs, in this fixed order: Latest, Hot, Following (members only), Forums (the
forum list) and Media (the newest pictures attached to posts and wall posts, limited to what the
viewer may open). Every tab has an address that names it (`/?tab=forums`); `/forums` always shows
the forum list. The wall composer and the featured threads are drawn on the first three tabs only.

The bar shows three tabs and puts the rest in a "More" menu. It holds the visitor's default tab and
then the first tabs of the order above that are not it, up to three, drawn in the fixed order (a
default of Media gives Latest, Hot, Media). The tab that is open is always on the bar: when it is
not one of those, it takes the place of the last of them that is not the default. A guest has no
Following tab. The menu's entries are links only once it is opened (a browser without JavaScript
cannot reach them from the bar).

A visitor opens the tab their address names. With no tab in the address, a member opens the tab
they chose in their preferences (`homeTab`, null for the site default); otherwise the `homeTab`
setting decides (`PATCH /settings`, admin panel: Settings, Home page): an ordered list of
`{ rule, tab }` entries, where the first rule the visitor meets wins, and a fallback tab. Rules are
the shared criteria rules, cheap criteria only (they are checked on every page view). Guests are
decided by the same rules (`is_guest` and the criteria that need no account apply to them; a guest
is in no group). Following needs an account, so a rule a guest can meet, and the fallback, cannot
pick it, and a guest who asks for it gets Latest.

`auth.me` carries both the member's choice (`user.homeTab`) and the tab decided for them
(`user.openHomeTab`), so the home page makes no extra request for a member. `GET /site/home-tab`
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
| `conversation.added` | A member added to a conversation (new messages raise the conversation counter, not an alert) |
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

## Referrals

A member brings others to the forum through their links. A referral is recorded once, on the
referred member (`referred_by`, `referred_at`), and counted on the referrer (`referralCount`); the
`referrals_at_least`, `referrals_this_month` and `was_referred` criteria, the referrals ranking and
the member of the month points read it. Members cannot name a referrer after registering: the
operation `users.setReferrer` and the profile fields `referrerId` and `canSetReferrer` are gone.

**The link.** In the web app, a signed-in member's Share and Copy link buttons add `?ref=<their member
id>` to the address (after any query and before any `#`). A guest's copy is the plain address, and
so is a link copied from the browser's address bar. The member's own link, `/register?ref=<id>`, is
under Invite members in their account settings.

**Arriving.** A visitor who opens any page with a valid `?ref=` (a positive whole number) and has
accepted the Referrals cookies in the cookie banner gets the `forum_ref` cookie: HttpOnly, SameSite
Lax, Secure when the site is served over https, 30 days. The first referrer wins; a later link never
replaces it. A visitor who has not accepted it gets no cookie, and a cookie that is no longer
accepted is removed on their next visit. Pages reached through a `?ref=` link name the address
without it as their canonical address (a `Link` header), so they are not indexed twice. Without the cookie, a visitor who registers straight from a
`/register?ref=<id>` link is still credited, because the register form carries the `ref` of the page.

**Registering.** The web app sends the referrer (the cookie's, else the form's) with the sign-up
as `ref`; the Better Auth sign-up body accepts it, as a number or as plain decimal text. The
cookie is deleted once the account exists.

- On a site without account email, the referrer is recorded at registration.
- On a site that asks members to confirm their address, the registration only holds the referrer
  (`users.pending_referrer`). It is recorded when the address is confirmed, or at the member's
  next sign-in if that comes first (signing in does not require a confirmed address), so the
  referral is never recorded in the sign-up itself.
- A referrer is accepted only within seven days of the registration, and never when it is the
  member themselves, a member who is banned or erased, a member the new member already referred, or
  when the member already has a referrer. A refused referrer is dropped without a message: it never
  blocks the registration or the sign-in. A held referrer is tried once.

Erasing a member ends their links as before: the referrer's count drops by one and the members
they referred lose their referrer.

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
