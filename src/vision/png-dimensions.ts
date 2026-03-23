/**
 * Read width/height from a PNG base64 payload (IHDR chunk).
 * Used when MCP does not expose window rect and the screenshot is PNG.
 */

export function pngDimensionsFromBase64(base64: string): { width: number; height: number } | null {
  const buf = Buffer.from(base64, "base64");
  if (buf.length < 24) return null;
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width < 1 || height < 1 || width > 20000 || height > 20000) return null;
  return { width, height };
}
