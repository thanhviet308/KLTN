export const MAX_CHAT_FILE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_SOURCE_BYTES = 30 * 1024 * 1024;
const MAX_IMAGE_EDGE = 2048;
const TARGET_IMAGE_UPLOAD_BYTES = 850 * 1024;
const DECODE_TIMEOUT_MS = 10_000;

export type ChatUploadType = 'image' | 'file';

const SUPPORTED_IMAGE_MIME = /^image\/(png|jpe?g|webp)$/;
const SUPPORTED_IMAGE_EXT = /\.(png|jpe?g|webp)$/i;
const OUTPUT_QUALITIES = [0.85, 0.72, 0.58] as const;

type DecodedSource = {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
};

/**
 * Classifies whether a selected attachment should be uploaded as an image or generic file.
 * Handles non-standard `image/jpg` MIME types and extension fallbacks when browsers omit MIME.
 */
export function classifyChatUpload(
  file: Pick<File, 'name' | 'type'>,
): ChatUploadType {
  const mime = file.type.trim().toLowerCase().split(';')[0] ?? '';
  if (SUPPORTED_IMAGE_MIME.test(mime)) return 'image';
  if (mime === '' || mime === 'application/octet-stream') {
    if (SUPPORTED_IMAGE_EXT.test(file.name.trim())) return 'image';
  }
  return 'file';
}

/**
 * Scales dimensions proportionally so neither edge exceeds `maxEdge`.
 */
export function fitImageDimensions(
  width: number,
  height: number,
  maxEdge = MAX_IMAGE_EDGE,
): { width: number; height: number } {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    maxEdge <= 0
  ) {
    return { width: 0, height: 0 };
  }
  if (width <= maxEdge && height <= maxEdge) {
    return { width: Math.round(width), height: Math.round(height) };
  }
  const scale = maxEdge / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function stripUnsafeNameChars(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f || ch === '/' || ch === '\\') {
      out += '_';
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Builds a sanitized upload filename matching the new image MIME extension and DTO length limits.
 */
export function buildOptimizedImageName(
  originalName: string,
  mimeType: string,
): string {
  const ext =
    mimeType === 'image/webp'
      ? '.webp'
      : mimeType === 'image/png'
        ? '.png'
        : '.jpg';
  const cleaned = stripUnsafeNameChars(originalName)
    .trim()
    .replace(/\.[a-z0-9]{1,8}$/i, '');
  const base = (cleaned || 'image').slice(0, 255 - ext.length);
  return `${base}${ext}`;
}

async function decodeImage(file: File): Promise<DecodedSource | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      // Fall back to HTMLImageElement when createImageBitmap rejects the file container.
    }
  }

  if (
    typeof Image === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    return null;
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      const timer = window.setTimeout(() => {
        el.onload = null;
        el.onerror = null;
        reject(new Error('Image decode timed out'));
      }, DECODE_TIMEOUT_MS);

      el.onload = () => {
        window.clearTimeout(timer);
        resolve(el);
      };
      el.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error('Image decode failed'));
      };
      el.src = objectUrl;
    });

    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(objectUrl),
    };
  } catch {
    URL.revokeObjectURL(objectUrl);
    return null;
  }
}

function encodeCanvas(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        if (!blob || blob.size === 0 || blob.type !== mimeType) {
          resolve(null);
          return;
        }
        resolve(blob);
      },
      mimeType,
      quality,
    );
  });
}

/**
 * Downscales and compresses oversized chat images client-side so camera photos upload reliably
 * within server pixel, file-size, and reverse-proxy body limits.
 */
export async function prepareChatUploadFile(
  file: File,
): Promise<{ file: File; type: ChatUploadType }> {
  const type = classifyChatUpload(file);
  if (
    type !== 'image' ||
    file.size === 0 ||
    file.size > MAX_IMAGE_SOURCE_BYTES ||
    typeof document === 'undefined'
  ) {
    return { file, type };
  }

  const decoded = await decodeImage(file);
  if (!decoded) return { file, type };

  let target: { width: number; height: number };
  let canvas: HTMLCanvasElement;
  try {
    target = fitImageDimensions(decoded.width, decoded.height, MAX_IMAGE_EDGE);
    const needsResize =
      target.width < decoded.width || target.height < decoded.height;
    const needsCompress = file.size > TARGET_IMAGE_UPLOAD_BYTES;
    if (
      target.width === 0 ||
      target.height === 0 ||
      (!needsResize && !needsCompress)
    ) {
      return { file, type };
    }

    canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { file, type };
    ctx.drawImage(decoded.source, 0, 0, target.width, target.height);
  } catch {
    return { file, type };
  } finally {
    decoded.release();
  }

  let bestBlob: Blob | null = null;
  for (const mimeType of ['image/webp', 'image/jpeg'] as const) {
    for (const quality of OUTPUT_QUALITIES) {
      const candidate = await encodeCanvas(canvas, mimeType, quality);
      if (!candidate) break;
      if (!bestBlob || candidate.size < bestBlob.size) {
        bestBlob = candidate;
      }
      if (candidate.size <= TARGET_IMAGE_UPLOAD_BYTES) {
        return {
          file: new File(
            [candidate],
            buildOptimizedImageName(file.name, candidate.type),
            {
              type: candidate.type,
              lastModified: file.lastModified,
            },
          ),
          type,
        };
      }
    }
  }

  if (!bestBlob) return { file, type };

  const mustReplace =
    target.width < decoded.width ||
    target.height < decoded.height ||
    file.size > MAX_CHAT_FILE_BYTES;

  if (!mustReplace && bestBlob.size >= file.size) {
    return { file, type };
  }

  return {
    file: new File(
      [bestBlob],
      buildOptimizedImageName(file.name, bestBlob.type),
      {
        type: bestBlob.type,
        lastModified: file.lastModified,
      },
    ),
    type,
  };
}
