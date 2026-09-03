import type { StoredImage } from "./print";

/**
 * Reads an image File, downscales it to fit within `maxDim` on its longest
 * side (keeping aspect ratio), and returns a compact data URL + the final
 * pixel size. Used for logo/banner uploads in settings — full-resolution
 * photos would otherwise bloat localStorage and slow every PDF render.
 *
 * `maxDim` defaults to 480, which suits small crest logos and letterhead
 * banners. Full-bleed A4 background artwork needs a higher ceiling to stay
 * sharp when stretched across a whole printed page — callers pass a larger
 * value (see InvoiceBrandingCard's background/roll-header slots).
 */
export function readImageResized(file: File, maxDim = 480): Promise<StoredImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Not a valid image"));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
        const width = Math.max(1, Math.round(img.naturalWidth * scale));
        const height = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas not supported"));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        // PNG keeps small crest logos/banners crisp (edges, transparency).
        // Above ~800px (full-bleed A4 backgrounds, thermal headers at high
        // res) a PNG gets big fast, so switch to JPEG — these are opaque
        // photo-like artwork anyway, and localStorage has a size ceiling.
        const large = maxDim > 800;
        resolve({
          dataUrl: large ? canvas.toDataURL("image/jpeg", 0.85) : canvas.toDataURL("image/png"),
          width,
          height,
        });
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
