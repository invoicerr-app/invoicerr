/** A file's raw bytes as base64, for the JSON endpoints that take a binary upload inline (a bank
 *  statement, a signing certificate). */
export async function fileToBase64(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer()
  let binary = ""
  const bytes = new Uint8Array(arrayBuffer)
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
