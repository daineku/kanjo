import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Token encryption at rest.
 *
 * A TikTok Shop access token can create listings, change prices and read
 * buyers' addresses. It is therefore never written to the database in the
 * clear: `tiktok-connection.accessTokenEnc` / `refreshTokenEnc` hold
 * AES-256-GCM ciphertext, keyed by TIKTOK_TOKEN_ENCRYPTION_KEY, which lives in
 * the server environment and nowhere else. A database dump, a Strapi export or
 * a backup therefore does not contain a usable token.
 *
 * Format: v1.<iv b64url>.<auth tag b64url>.<ciphertext b64url>
 * A fresh random 96-bit IV per encryption; the tag authenticates the
 * ciphertext, so a tampered value fails to decrypt rather than yielding junk.
 */

const VERSION = 'v1';

export function encryptSecret(plaintext: string, key: Buffer): string {
  if (key.length !== 32) throw new Error('Token encryption key must be 32 bytes');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptSecret(payload: string, key: Buffer): string {
  if (key.length !== 32) throw new Error('Token encryption key must be 32 bytes');
  const [version, iv, tag, ciphertext] = payload.split('.');
  if (version !== VERSION || !iv || !tag || ciphertext === undefined) {
    throw new Error('Stored token is not in the expected encrypted format');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
