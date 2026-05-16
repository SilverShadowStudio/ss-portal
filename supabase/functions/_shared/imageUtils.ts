// PNG downscale helper for edge functions.
// Used by signing functions to ensure embedded studio signatures stay within
// sane pixel dimensions regardless of what the admin uploads. jsPDF embeds
// PNGs as raw RGB + alpha mask, so a 2000×1592 source PNG becomes ~12 MB of
// uncompressed pixel data in the PDF; capping at e.g. 600×400 drops that to
// well under 1 MB per PDF.
//
// The original file in storage is never modified — downscale happens in
// memory at PDF generation time.

// @ts-ignore - Deno URL import
import { Image } from 'https://deno.land/x/imagescript@1.2.15/mod.ts'

export async function downscalePngToMax(
  pngBytes: Uint8Array,
  maxW: number,
  maxH: number,
): Promise<Uint8Array> {
  const img = await Image.decode(pngBytes) as any
  if (img.width <= maxW && img.height <= maxH) {
    // Already within bounds — return original bytes untouched so we don't
    // pointlessly re-encode (and risk losing fidelity on a tiny input).
    return pngBytes
  }
  const scale = Math.min(maxW / img.width, maxH / img.height)
  const newW = Math.max(1, Math.round(img.width * scale))
  const newH = Math.max(1, Math.round(img.height * scale))
  img.resize(newW, newH)
  return await img.encode() as Uint8Array
}

export function pngBytesToDataUrl(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return `data:image/png;base64,${btoa(binary)}`
}
