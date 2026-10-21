// Puts a text on the clipboard; false where there is no clipboard or it refuses.
export async function copyText(
  text: string,
  device: { clipboard?: { writeText: (text: string) => Promise<void> } },
) {
  try {
    if (!device.clipboard) return false;
    await device.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
