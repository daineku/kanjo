import type { Core } from '@strapi/strapi';

import { decodeImage, storeImages } from './uploads';
import { cleanCountry, cleanEmail, cleanString, CommerceError, hashIp } from './util';

/**
 * The two enquiry services: rare-parts sourcing and custom builds.
 *
 * Both are quotation requests, stored for a person to answer from the admin.
 * Neither creates an order, takes money, or promises anything — a build
 * inquiry in particular carries no claim about import eligibility, road
 * registration or shipping cost, which depend on the destination's rules and
 * are answered case by case.
 */

const fail = (fields: Record<string, string>) => {
  if (Object.keys(fields).length > 0) throw new CommerceError('validation_failed', 'Some details need attention.', 400, { fields });
};

export async function submitSourcingRequest(strapi: Core.Strapi, body: any, ip?: string) {
  const fields: Record<string, string> = {};
  const fullName = cleanString(body.fullName, 120);
  const email = cleanEmail(body.email);
  const country = cleanCountry(body.country);
  const vehicle = cleanString(body.vehicle, 200);
  const requestedPart = cleanString(body.requestedPart, 1000);
  if (!fullName) fields.fullName = 'Enter your name.';
  if (!email) fields.email = 'Enter a valid email address.';
  if (!country) fields.country = 'Choose your country.';
  if (!vehicle) fields.vehicle = 'Tell us the vehicle (make, model, chassis, year).';
  if (!requestedPart || requestedPart.length < 5) fields.requestedPart = 'Describe the part you are looking for.';
  fail(fields);

  const image = body.referenceImage ? [decodeImage(body.referenceImage)] : [];
  const [imageId] = await storeImages(strapi, image, 'sourcing');

  await strapi.documents('api::sourcing-request.sourcing-request' as any).create({
    data: {
      fullName,
      email,
      country,
      vehicle,
      requestedPart,
      preference: ['oem', 'aftermarket', 'either'].includes(body.preference) ? body.preference : 'either',
      budget: cleanString(body.budget, 80),
      notes: cleanString(body.notes, 4000),
      referenceImage: imageId,
      status: 'new',
      ipHash: hashIp(ip),
    } as any,
  });
  return { ok: true };
}

export async function submitBuildInquiry(strapi: Core.Strapi, body: any, ip?: string) {
  const fields: Record<string, string> = {};
  const fullName = cleanString(body.fullName, 120);
  const email = cleanEmail(body.email);
  const destinationCountry = cleanCountry(body.destinationCountry);
  const preferredChassis = cleanString(body.preferredChassis, 120);
  const budgetRange = cleanString(body.budgetRange, 80);
  if (!fullName) fields.fullName = 'Enter your name.';
  if (!email) fields.email = 'Enter a valid email address.';
  if (!destinationCountry) fields.destinationCountry = 'Choose the destination country.';
  if (!preferredChassis) fields.preferredChassis = 'Tell us the chassis you have in mind.';
  if (!budgetRange) fields.budgetRange = 'Choose a budget range.';
  fail(fields);

  await strapi.documents('api::build-inquiry.build-inquiry' as any).create({
    data: {
      fullName,
      email,
      phone: cleanString(body.phone, 40),
      destinationCountry,
      preferredChassis,
      budgetRange,
      intendedUse: ['street', 'track', 'show', 'collection', 'mixed', 'other'].includes(body.intendedUse) ? body.intendedUse : 'other',
      desiredModifications: cleanString(body.desiredModifications, 4000),
      status: 'new',
      ipHash: hashIp(ip),
    } as any,
  });
  return { ok: true };
}
