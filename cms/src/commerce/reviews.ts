import type { Core } from '@strapi/strapi';

import { loadCatalogIndex, loadSettings } from './catalog';
import { env, publicOrigin } from './config';
import { decodeImage, storeImages } from './uploads';
import { cleanEmail, cleanString, CommerceError, hashIp } from './util';

/**
 * Product reviews: genuine, moderated, and honestly labelled.
 *
 * ── NOTHING IS PUBLISHED UNTIL A PERSON APPROVES IT ─────────────────────────
 *
 * A submission is stored `pending`. Only `approved` reviews are returned to
 * the storefront, counted in the rating, or emitted in structured data. There
 * is no seed data for this content type and there never will be.
 *
 * ── "VERIFIED PURCHASE" IS A DATABASE FACT ──────────────────────────────────
 *
 * The flag is set at submission ONLY when an order exists with the same email,
 * a line for this exact product, and a status at or past `shipped` (the
 * customer has had the chance to receive it). The reviewer may give the order
 * reference to make the match exact; without it, any qualifying order by that
 * email counts. An operator cannot tick the flag on — the guard re-derives it
 * on every admin edit (./guards.ts).
 *
 * ── ONE REVIEW PER PERSON PER PRODUCT ───────────────────────────────────────
 *
 * The same email cannot review the same product twice (any status). Combined
 * with the per-IP rate limit and the honeypot, that is the duplicate and
 * flood control; moderation is the rest.
 */

const REVIEW_UID = 'api::review.review';
const REPORT_UID = 'api::review-report.review-report';
const QUALIFYING = ['shipped', 'delivered'];

export async function hasQualifyingOrder(
  strapi: Core.Strapi,
  email: string,
  productDocumentId: string,
  orderReference?: string,
): Promise<string | undefined> {
  const filters: any = { email, status: { $in: QUALIFYING }, isTest: { $ne: true } };
  if (orderReference) filters.reference = orderReference;
  const orders: any[] = await strapi.documents('api::order.order' as any).findMany({
    filters,
    populate: { items: true },
    limit: 50,
  } as any);
  const match = orders.find((order) => (order.items ?? []).some((item: any) => item.productDocumentId === productDocumentId));
  return match?.reference;
}

export async function submitReview(strapi: Core.Strapi, body: any, ip?: string) {
  const settings = await loadSettings(strapi);
  if (!settings.reviewsEnabled) throw new CommerceError('validation_failed', 'Reviews are closed.', 403);

  const index = await loadCatalogIndex(strapi);
  const slug = cleanString(body.productSlug, 200);
  const product = index.products.find((p: any) => p.slug === slug);
  if (!product) throw new CommerceError('not_found', 'Product not found.', 404);
  if (product.isSample) throw new CommerceError('validation_failed', 'Sample products cannot be reviewed.');

  const fields: Record<string, string> = {};
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) fields.rating = 'Choose a rating from 1 to 5.';
  const reviewBody = cleanString(body.body, 4000);
  if (!reviewBody || reviewBody.length < 20) fields.body = 'Write at least 20 characters.';
  const authorName = cleanString(body.authorName, 60);
  if (!authorName) fields.authorName = 'Enter the name to show with your review.';
  const email = cleanEmail(body.email);
  if (!email) fields.email = 'Enter a valid email address. It is never shown.';
  const photos = Array.isArray(body.photos) ? body.photos.slice(0, 4) : [];
  if (photos.length > 3) fields.photos = 'Up to three photos.';
  if (Object.keys(fields).length > 0) throw new CommerceError('validation_failed', 'Some details need attention.', 400, { fields });

  const duplicate = await strapi.documents(REVIEW_UID as any).count({
    filters: { email, productDocumentId: product.documentId },
  } as any);
  if (duplicate > 0) throw new CommerceError('duplicate', 'You have already reviewed this product.', 409);

  const decoded = photos.map(decodeImage);
  const orderReference = cleanString(body.orderReference, 40)?.toUpperCase();
  const verifiedRef = await hasQualifyingOrder(strapi, email!, product.documentId, orderReference);
  const photoIds = await storeImages(strapi, decoded, 'review');

  await strapi.documents(REVIEW_UID as any).create({
    data: {
      productDocumentId: product.documentId,
      productSlug: product.slug,
      productName: product.name,
      rating,
      title: cleanString(body.title, 120),
      body: reviewBody,
      authorName,
      email,
      photos: photoIds,
      status: 'pending',
      verifiedPurchase: Boolean(verifiedRef),
      orderReference: verifiedRef,
      submittedAt: new Date().toISOString(),
      ipHash: hashIp(ip),
    } as any,
  });
  return { status: 'pending' as const };
}

export async function productReviews(strapi: Core.Strapi, slug: string) {
  const index = await loadCatalogIndex(strapi);
  const product = index.products.find((p: any) => p.slug === slug);
  if (!product) throw new CommerceError('not_found', 'Product not found.', 404);

  const rows: any[] = await strapi.documents(REVIEW_UID as any).findMany({
    filters: { productDocumentId: product.documentId, status: 'approved' },
    sort: ['submittedAt:desc'],
    populate: { photos: true },
    limit: 100,
  } as any);
  if (rows.length === 0) return { reviews: [] };

  const distribution: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  let total = 0;
  for (const row of rows) {
    distribution[row.rating - 1] += 1;
    total += row.rating;
  }
  const origin = publicOrigin(env());
  return {
    summary: { average: Math.round((total / rows.length) * 10) / 10, count: rows.length, distribution },
    reviews: rows.map((row) => ({
      id: row.documentId,
      rating: row.rating,
      title: row.title || undefined,
      body: row.body,
      authorName: row.authorName,
      submittedAt: row.submittedAt ?? row.createdAt,
      verifiedPurchase: row.verifiedPurchase === true,
      photos: (row.photos ?? [])
        .filter((photo: any) => photo.width && photo.height)
        .map((photo: any) => ({
          url: String(photo.url).startsWith('/') ? `${origin}${photo.url}` : photo.url,
          width: photo.width,
          height: photo.height,
          alt: `Customer photo for ${row.productName ?? 'this product'}`,
        })),
      adminReply: row.adminReply ? { body: row.adminReply, repliedAt: row.adminRepliedAt || undefined } : undefined,
    })),
  };
}

const AUTO_HIDE_REPORTS = 3;

/**
 * An abuse report. Three distinct reporters pull a review back to `pending`
 * for re-moderation — the reviewer is not told, and a person decides.
 */
export async function reportReview(strapi: Core.Strapi, reviewId: string, body: any, ip?: string) {
  const review: any = await strapi.documents(REVIEW_UID as any).findOne({ documentId: reviewId } as any);
  if (!review || review.status !== 'approved') throw new CommerceError('not_found', 'Review not found.', 404);
  const reason = ['spam', 'offensive', 'fake', 'off_topic', 'other'].includes(body.reason) ? body.reason : 'other';
  const ipHash = hashIp(ip);

  if (ipHash) {
    const already = await strapi.documents(REPORT_UID as any).count({ filters: { reviewDocumentId: reviewId, ipHash } } as any);
    if (already > 0) return { ok: true };
  }
  await strapi.documents(REPORT_UID as any).create({
    data: { reviewDocumentId: reviewId, reason, detail: cleanString(body.detail, 1000), ipHash } as any,
  });
  const reports = (review.reportCount ?? 0) + 1;
  await strapi.documents(REVIEW_UID as any).update({
    documentId: reviewId,
    data: { reportCount: reports, ...(reports >= AUTO_HIDE_REPORTS ? { status: 'pending' } : {}) } as any,
  });
  return { ok: true };
}
