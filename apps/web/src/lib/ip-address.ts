const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;

function groupsOf(address: string): number[] | null {
  let text = address;
  const tail = text.match(/:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (tail) {
    const octets = tail[1].split(".").map(Number);
    if (octets.some((octet) => octet > 255)) return null;
    text = `${text.slice(0, -tail[1].length)}${(octets[0] * 256 + octets[1]).toString(16)}:${(octets[2] * 256 + octets[3]).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === "" ? [] : part.split(":"));
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const all = [
    ...head,
    ...Array(halves.length === 2 ? missing : 0).fill("0"),
    ...rest,
  ];
  if (!all.every((group) => /^[0-9a-f]{1,4}$/i.test(group))) return null;
  return all.map((group) => Number.parseInt(group, 16));
}

// A session's address as people read it: an IPv6 address in its short form (`::1`), an IPv4-mapped
// one as the IPv4 address it carries, an IPv4 address and anything that is not an address as it is.
export function shortAddress(address: string): string {
  if (IPV4.test(address)) return address;
  const groups = groupsOf(address);
  if (!groups) return address;
  if (
    groups.slice(0, 5).every((group) => group === 0) &&
    groups[5] === 0xffff
  ) {
    return [
      groups[6] >> 8,
      groups[6] & 255,
      groups[7] >> 8,
      groups[7] & 255,
    ].join(".");
  }
  let start = -1;
  let length = 0;
  for (let index = 0; index < 8; ) {
    if (groups[index] !== 0) {
      index += 1;
      continue;
    }
    let end = index;
    while (end < 8 && groups[end] === 0) end += 1;
    if (end - index > length) {
      start = index;
      length = end - index;
    }
    index = end;
  }
  const text = groups.map((group) => group.toString(16));
  if (length < 2) return text.join(":");
  const before = text.slice(0, start).join(":");
  const after = text.slice(start + length).join(":");
  return `${before}::${after}`;
}
