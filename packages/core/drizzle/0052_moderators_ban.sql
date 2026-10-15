-- Moderators may ban (item 4b): member.ban becomes a moderator default, bounded by member.banMaxDays.
INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) SELECT d.id, 0, g.id, 0, 1 FROM permission_definitions d JOIN groups g ON g.builtin = 'moderator' WHERE d.key = 'member.ban' ON CONFLICT DO NOTHING;
