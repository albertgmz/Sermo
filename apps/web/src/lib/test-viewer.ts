// What auth.me answers in the page tests: a member or a guest, with nothing else to say about them.
export function viewerBody(signedIn: boolean) {
  return {
    user: signedIn
      ? {
          id: 1,
          username: "ember",
          email: "ember@example.test",
          groupId: 2,
          createdAt: "2026-01-01T00:00:00.000Z",
          displayGroup: null,
          language: null,
          keyboardShortcuts: true,
          homeTab: null,
          feedView: "cards",
          theme: null,
          openHomeTab: "latest",
          pendingAcceptance: [],
          awaitingApproval: false,
          sessionId: 1,
        }
      : null,
    permissions: {
      isAdmin: false,
      isModerator: false,
      canViewProfiles: true,
      canPostProfile: false,
      canStartConversations: false,
      canReact: false,
    },
    resolvedPermissions: {},
    staff: {
      panel: false,
      moderatesEverywhere: false,
      moderatedNodeIds: [],
      moderatedNodesTruncated: false,
    },
  };
}
