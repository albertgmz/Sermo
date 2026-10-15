// The text of a server-rendered React tree, for tests of async server components, which the static
// renderer cannot expand: every function component is called (and awaited) with its props, and a
// component that cannot run outside a render stands for what is inside it. A component named in
// `verbatim` is not called: its children are shown as they are, in brackets.
export async function textOfTree(
  node: unknown,
  verbatim: readonly string[] = [],
): Promise<string> {
  if (node === null || node === undefined || typeof node === "boolean")
    return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node))
    return (
      await Promise.all(node.map((child) => textOfTree(child, verbatim)))
    ).join(" ");
  const element = node as { type: unknown; props: { children?: unknown } };
  if (typeof element.type === "function") {
    if (verbatim.includes(element.type.name))
      return `[${element.type.name} ${String(element.props.children)}]`;
    try {
      return await textOfTree(
        await (element.type as (props: unknown) => unknown)(element.props),
        verbatim,
      );
    } catch {
      return textOfTree(element.props.children, verbatim);
    }
  }
  return textOfTree(element.props?.children, verbatim);
}
