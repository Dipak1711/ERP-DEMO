/** Shared company logo as a data URL, used in print HTML templates so the
 *  logo renders even in popup / blob print windows that cannot fetch /everest-logo.jpeg.
 *
 *  Vite turns `?url` imports into the hashed public path at build-time, but for
 *  print pop-ups we need an inline image, so we fetch it once and cache it.
 */

let _cached: string | null = null;

/** Returns a data-URL string for the Everest logo, cached after the first call. */
export async function getLogoDataUrl(): Promise<string> {
  if (_cached) return _cached;
  try {
    const res = await fetch('/everest-logo.jpeg');
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        _cached = reader.result as string;
        resolve(_cached);
      };
      reader.readAsDataURL(blob);
    });
  } catch {
    // Fallback: transparent 1x1 gif so the layout doesn't break
    _cached = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
    return _cached;
  }
}

/** CSS for the logo <img> used in every print header */
export const LOGO_IMG_CSS = `
  .brand { display: flex; align-items: center; justify-content: flex-start; }
  .logo-img { height: 52px; max-width: 220px; width: auto; object-fit: contain; display: block; }
`;

/** Returns the HTML snippet for the branded header logo cell.
 *  @param logoUrl  data-URL of the logo (from getLogoDataUrl())
 */
export function logoBrandHtml(logoUrl: string): string {
  return `<div class="brand"><img class="logo-img" src="${logoUrl}" alt="Everest Auto Forge Pvt. Ltd." /></div>`;
}
