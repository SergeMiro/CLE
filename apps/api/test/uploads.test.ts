import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AppContext } from '../src/context.js';
import { readImage, storeImage } from '../src/services/uploads.js';

/** Enough of a real PNG that the sniffer and the header reader both agree. */
function png(width: number, height: number): Buffer {
  const signature = Buffer.from('89504e470d0a1a0a', 'hex');
  const ihdrBody = Buffer.alloc(13);
  ihdrBody.writeUInt32BE(width, 0);
  ihdrBody.writeUInt32BE(height, 4);
  ihdrBody[8] = 8;
  const chunk = (type: string, body: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    return Buffer.concat([length, Buffer.from(type, 'ascii'), body, Buffer.alloc(4)]);
  };
  return Buffer.concat([signature, chunk('IHDR', ihdrBody), chunk('IDAT', deflateSync(Buffer.alloc(8))), chunk('IEND', Buffer.alloc(0))]);
}

function jpeg(width: number, height: number): Buffer {
  const sof = Buffer.alloc(11);
  sof[0] = 0xff;
  sof[1] = 0xc0;
  sof.writeUInt16BE(9, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02]), sof]);
}

describe('uploaded ad creatives', () => {
  let ctx: AppContext;
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'cle-uploads-'));
    ctx = {
      env: { UPLOAD_DIR: directory, UPLOAD_MAX_BYTES: 512_000, API_URL: 'https://api.example.com' },
    } as unknown as AppContext;
  });

  it('stores a PNG under a generated name and returns its public address', async () => {
    const stored = await storeImage(ctx, png(64, 64));

    expect(stored.contentType).toBe('image/png');
    expect(stored.fileName).toMatch(/^[0-9a-f-]{36}\.png$/);
    expect(stored.url).toBe(`https://api.example.com/uploads/${stored.fileName}`);
    // The bytes really reached the disk, under that name and no other.
    expect(await readdir(directory)).toEqual([stored.fileName]);
  });

  it('decides the format from the bytes, not from the name it was given', async () => {
    // A JPEG is a JPEG even when the sender insists otherwise.
    const stored = await storeImage(ctx, jpeg(100, 100));
    expect(stored.contentType).toBe('image/jpeg');
    expect(stored.fileName.endsWith('.jpg')).toBe(true);
  });

  it('refuses anything that is not one of the three image formats', async () => {
    await expect(storeImage(ctx, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).rejects.toThrow(
      /PNG, JPEG and WebP/,
    );
    await expect(storeImage(ctx, Buffer.from('GIF89a'))).rejects.toThrow(/PNG, JPEG and WebP/);
    await expect(storeImage(ctx, Buffer.alloc(0))).rejects.toThrow(/empty/);
  });

  it('refuses a file over the byte limit', async () => {
    const small = { ...ctx, env: { ...ctx.env, UPLOAD_MAX_BYTES: 64 } } as AppContext;
    await expect(storeImage(small, png(64, 64))).rejects.toThrow(/larger than/);
  });

  /*
   * A picture can be tiny in bytes and enormous in pixels: a flat 8000×8000 PNG
   * compresses to almost nothing and would still be decoded at full size on
   * every phone that opens the quiz.
   */
  it('refuses an image whose pixel dimensions are absurd, however small the file', async () => {
    const huge = png(8000, 8000);
    expect(huge.length).toBeLessThan(1000);
    await expect(storeImage(ctx, huge)).rejects.toThrow(/longest edge/);
    await expect(storeImage(ctx, jpeg(4000, 10))).rejects.toThrow(/longest edge/);
  });

  it('reads back only names it generated itself', async () => {
    const stored = await storeImage(ctx, png(32, 32));
    const image = await readImage(ctx, stored.fileName);
    expect(image.contentType).toBe('image/png');
    expect(image.data.equals(png(32, 32))).toBe(true);

    // A traversal attempt must not even be looked for on disk.
    await writeFile(join(directory, 'secret.txt'), 'not yours');
    await expect(readImage(ctx, '../secret.txt')).rejects.toThrow(/no such image/);
    await expect(readImage(ctx, 'secret.txt')).rejects.toThrow(/no such image/);
    await expect(readImage(ctx, '/etc/passwd')).rejects.toThrow(/no such image/);
    expect(await readFile(join(directory, 'secret.txt'), 'utf8')).toBe('not yours');
  });
});
