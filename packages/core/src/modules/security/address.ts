import ipaddr from "ipaddr.js";

export interface ClientAddress {
  /** The address as people read it: IPv4 in dotted form, IPv6 in its short form. */
  readonly ip: string;
  /** The address itself for IPv4; for IPv6 its /64 network (`2001:db8:1:2::/64`). */
  readonly net: string;
}

/**
 * Normalises a client address: an IPv4-mapped IPv6 address becomes the IPv4 address it carries,
 * IPv6 is written in its short form and loses any zone, and anything that is not an address
 * (the adapter's `unknown` placeholder, an IPv4 shorthand such as `1.2`) is refused with null.
 */
export function parseAddress(raw: string | null | undefined): ClientAddress | null {
  const text = raw?.trim();
  if (!text) return null;
  const valid = text.includes(":")
    ? ipaddr.IPv6.isValid(text)
    : ipaddr.IPv4.isValidFourPartDecimal(text);
  if (!valid) return null;
  const address = ipaddr.process(text);
  if (address.kind() === "ipv4") return { ip: address.toString(), net: address.toString() };
  const v6 = address as ipaddr.IPv6;
  v6.zoneId = undefined;
  return { ip: v6.toString(), net: `${networkOf(v6)}/64` };
}

function networkOf(address: ipaddr.IPv6): string {
  return new ipaddr.IPv6([...address.parts.slice(0, 4), 0, 0, 0, 0]).toString();
}

/**
 * The network key of a staff search: an address gives its own key, and so does a `/64` written
 * out (`2001:db8:1:2::/64`), which is how the staff view names a network.
 */
export function parseNetwork(raw: string): string | null {
  const text = raw.trim();
  const cidr = /^(.+)\/64$/.exec(text);
  if (cidr?.[1]?.includes(":")) {
    const address = parseAddress(cidr[1]);
    return address?.net.endsWith("/64") ? address.net : null;
  }
  return parseAddress(text)?.net ?? null;
}
