// The properties that decide where the text of a field breaks and where its caret falls.
const COPIED = [
  "direction",
  "boxSizing",
  "width",
  "overflowX",
  "overflowY",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderStyle",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "fontStretch",
  "fontSize",
  "fontSizeAdjust",
  "lineHeight",
  "fontFamily",
  "textAlign",
  "textTransform",
  "textIndent",
  "letterSpacing",
  "wordSpacing",
  "tabSize",
] as const;

// The caret's rectangle on the screen in a text field, which the page's selection cannot give: the
// text before the caret is set in a hidden copy of the field, and a marker after it says where the
// caret falls (its line, at the caret's left).
export function textareaCaretRect(field: HTMLTextAreaElement) {
  const style = getComputedStyle(field);
  const mirror = document.createElement("div");
  for (const name of COPIED) mirror.style[name] = style[name];
  Object.assign(mirror.style, {
    position: "absolute",
    visibility: "hidden",
    top: "0",
    left: "-9999px",
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
  });
  mirror.textContent = field.value.slice(0, field.selectionStart);
  const marker = document.createElement("span");
  marker.textContent = ".";
  mirror.append(marker);
  document.body.append(mirror);
  const box = field.getBoundingClientRect();
  const top =
    box.top +
    marker.offsetTop +
    Number.parseFloat(style.borderTopWidth) -
    field.scrollTop;
  const left =
    box.left +
    marker.offsetLeft +
    Number.parseFloat(style.borderLeftWidth) -
    field.scrollLeft;
  const bottom = top + marker.offsetHeight;
  mirror.remove();
  return { top, bottom, left };
}
