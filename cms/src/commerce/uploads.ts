import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Core } from '@strapi/strapi';

import { CommerceError } from './util';

/**
 * Customer image uploads (review photos, sourcing reference images).
 *
 * The browser sends base64 inside JSON. Before anything is stored:
 *
 *   - the size is bounded (decoded, not encoded);
 *   - the TYPE IS READ FROM THE BYTES' MAGIC NUMBER, not from the filename or
 *     the claimed content type — a renamed HTML file is not an image;
 *   - only JPEG, PNG and WebP are accepted (no SVG: it is a script container);
 *   - the filename is replaced with a generated one.
 *
 * The file then goes through Strapi's upload service, which strips nothing
 * we rely on and stores it with the configured provider (local or R2).
 */

const MAX_BYTES = 4 * 1024 * 1024;

export function sniffImageType(bytes: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return undefined;
}

export function decodeImage(input: any): { bytes: Buffer; type: string } {
  if (!input || typeof input.dataBase64 !== 'string') throw new CommerceError('validation_failed', 'Invalid image.');
  if (input.dataBase64.length > Math.ceil((MAX_BYTES * 4) / 3) + 8) throw new CommerceError('validation_failed', 'Each image must be 4 MB or smaller.');
  const bytes = Buffer.from(input.dataBase64, 'base64');
  if (bytes.length === 0 || bytes.length > MAX_BYTES) throw new CommerceError('validation_failed', 'Each image must be 4 MB or smaller.');
  const type = sniffImageType(bytes);
  if (!type) throw new CommerceError('validation_failed', 'Images must be JPEG, PNG or WebP.');
  return { bytes, type };
}

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Stores verified images and returns their upload ids, for a media relation. */
export async function storeImages(strapi: Core.Strapi, images: { bytes: Buffer; type: string }[], prefix: string): Promise<number[]> {
  if (images.length === 0) return [];
  const dir = await mkdtemp(join(tmpdir(), 'kanjo-upload-'));
  try {
    const files = await Promise.all(
      images.map(async (image, i) => {
        const name = `${prefix}-${Date.now()}-${i}.${EXT[image.type]}`;
        const path = join(dir, name);
        await writeFile(path, image.bytes);
        return { filepath: path, originalFilename: name, mimetype: image.type, size: image.bytes.length };
      }),
    );
    const uploaded: any[] = await strapi.plugin('upload').service('upload').upload({ data: {}, files });
    return uploaded.map((file) => file.id);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
