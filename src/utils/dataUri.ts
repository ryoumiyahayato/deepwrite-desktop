export function bytesToDataUri(bytes: Uint8Array, mime: string): string {
  let binary = '';
  const size = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += size) binary += String.fromCharCode(...bytes.subarray(offset, offset + size));
  return `data:${mime};base64,${btoa(binary)}`;
}
