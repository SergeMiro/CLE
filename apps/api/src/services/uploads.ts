import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { AppContext } from '../context.js';
import { badRequest, notFound } from '../errors.js';

/**
 * Ad creatives uploaded to CLE rather than hosted by the advertiser.
 *
 * The file is served back to every member who opens a quiz, so nothing about it
 * is taken on trust: the format is decided by the bytes, not by the declared
 * content type or the file name, and the name it is stored under is generated
 * here. SVG is not accepted at all — it is a document that can carry script,
 * and it would be served from our own origin.
 */

const FORMATS = {
  png: { extension: 'png', contentType: 'image/png' },
  jpeg: { extension: 'jpg', contentType: 'image/jpeg' },
  webp: { extension: 'webp', contentType: 'image/webp' },
} as const;

type Format = keyof typeof FORMATS;

/** Stored names are generated, so anything else is refused before touching the disk. */
const STORED_NAME = /^[0-9a-f-]{36}\.(png|jpg|webp)$/;

const MAX_EDGE = 2048;

function sniff(data: Buffer): Format | undefined {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'png';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpeg';
  if (data.length >= 12 && data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'webp';
  }
  return undefined;
}

/**
 * Enough of each header to learn the size. A picture can be small in bytes and
 * enormous in pixels — a flat 8000×8000 PNG compresses to nothing and would
 * still be decoded, at full size, on every phone that opens the quiz.
 */
function dimensions(data: Buffer, format: Format): { width: number; height: number } | undefined {
  if (format === 'png' && data.length >= 24) {
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (format === 'jpeg') {
    let offset = 2;
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = data[offset + 1] ?? 0;
      // Every SOF marker but DHT (c4), DAC (cc) and the RSTn range carries the size.
      const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isStartOfFrame) return { height: data.readUInt16BE(offset + 5), width: data.readUInt16BE(offset + 7) };
      offset += 2 + data.readUInt16BE(offset + 2);
    }
    return undefined;
  }
  if (format === 'webp' && data.length >= 30) {
    const chunk = data.subarray(12, 16).toString('ascii');
    if (chunk === 'VP8X') return { width: data.readUIntLE(24, 3) + 1, height: data.readUIntLE(27, 3) + 1 };
    if (chunk === 'VP8 ') return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
  }
  // A format whose header is not read here (lossless WebP) passes on the byte cap alone.
  return undefined;
}

function uploadRoot(ctx: AppContext): string {
  return resolve(ctx.env.UPLOAD_DIR);
}

export interface StoredImage {
  fileName: string;
  url: string;
  contentType: string;
  bytes: number;
}

export async function storeImage(ctx: AppContext, data: Buffer): Promise<StoredImage> {
  if (data.length === 0) throw badRequest('the file is empty');
  if (data.length > ctx.env.UPLOAD_MAX_BYTES) {
    throw badRequest(`the image is larger than ${Math.round(ctx.env.UPLOAD_MAX_BYTES / 1024)} KB`);
  }

  const format = sniff(data);
  if (!format) throw badRequest('only PNG, JPEG and WebP images are accepted');

  const size = dimensions(data, format);
  if (size && (size.width > MAX_EDGE || size.height > MAX_EDGE)) {
    throw badRequest(`the image is ${size.width}×${size.height}; the longest edge may be ${MAX_EDGE}px`);
  }

  const { extension, contentType } = FORMATS[format];
  const fileName = `${randomUUID()}.${extension}`;
  await mkdir(uploadRoot(ctx), { recursive: true });
  await writeFile(join(uploadRoot(ctx), fileName), data);

  return {
    fileName,
    url: `${ctx.env.API_URL.replace(/\/$/, '')}/uploads/${fileName}`,
    contentType,
    bytes: data.length,
  };
}

export async function readImage(ctx: AppContext, fileName: string): Promise<{ data: Buffer; contentType: string }> {
  if (!STORED_NAME.test(fileName)) throw notFound('no such image');
  const extension = fileName.slice(fileName.lastIndexOf('.') + 1);
  const format = (Object.values(FORMATS).find((entry) => entry.extension === extension) ?? FORMATS.png).contentType;
  try {
    return { data: await readFile(join(uploadRoot(ctx), fileName)), contentType: format };
  } catch {
    throw notFound('no such image');
  }
}
