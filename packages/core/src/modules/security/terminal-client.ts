/** The longest host name kept from a terminal client's user agent (one DNS label). */
const HOST_MAX = 63;

/**
 * The readable name of a device login: the client and the host it runs on, from the user agent
 * sermo-cli sends (`sermo-cli/<version> (<os>/<arch>; <hostname>)`), e.g. "sermo-cli · my-laptop".
 * The host is whatever the client says: only letters, digits, dots, dashes and underscores are
 * kept, so it can be shown in a page or a mail as it is. Without a host, the client id alone.
 */
export function terminalClientName(clientId: string, userAgent: string | null | undefined): string {
  const host = userAgent
    ?.match(/^[^/\s]+\/\S+\s+\([^;)]*;\s*([^)]*)\)/)?.[1]
    ?.replace(/[^\p{L}\p{N}._-]/gu, "")
    .slice(0, HOST_MAX);
  return host ? `${clientId} · ${host}` : clientId;
}
