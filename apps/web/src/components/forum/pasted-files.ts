// The text a clipboard's HTML holds, tags and comments aside.
const htmlText = (html: string) =>
  html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|\u00A0/g, " ")
    .trim();

// What a browser puts as plain text next to a copied picture or file: its address, or its path.
const ADDRESS = /^(?:https?:\/\/|file:\/\/)\S+$/i;
const PATH = /^(?:[a-z]:[\\/]|\\\\|\/)[^\r\n]*$/i;

// A paste is files when it holds files and the text with them says nothing more than the files
// do: no text, the name of one of the files, or one address or path (Firefox and Safari put one
// next to a copied picture, as file managers do next to a copied file) with no text in the HTML
// but a picture. A cell copied from a spreadsheet comes with a picture of itself and its text,
// so it stays text.
export function pastedFiles(data: {
  files: ArrayLike<File>;
  getData: (type: string) => string;
}) {
  const files = Array.from(data.files);
  if (files.length === 0) return [];
  const plain = data.getData("text/plain").trim();
  if (!plain) return files;
  if (files.some((file) => file.name === plain)) return files;
  const bare =
    ADDRESS.test(plain) || (PATH.test(plain) && !/\s{2,}/.test(plain));
  return bare && !htmlText(data.getData("text/html")) ? files : [];
}
