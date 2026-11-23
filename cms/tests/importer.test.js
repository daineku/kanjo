'use strict';

/** Importer tests: CSV parsing, normalisation, duplicates, the draft shape. Pure; no database. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const { parseCsv, parseCsvRows, toCsv, CsvError } = require('../dist/src/importer/csv');
const { normalizeRecord, parsePrice, parseWeightGrams, slugify, deriveSku, hasErrors } = require('../dist/src/importer/normalize');
const { findDuplicates, nameSimilarity } = require('../dist/src/importer/duplicates');
const { draftProductData } = require('../dist/src/importer/pipeline');
const { ADAPTERS } = require('../dist/src/importer/adapters');

// ── CSV ────────────────────────────────────────────────────────────────────

test('RFC 4180: BOM, CRLF, quoted commas, doubled quotes, newlines in quotes', () => {
  const text = '﻿a,b,c\r\n1,"x, y","he said ""hi"""\r\n2,"multi\nline",\r\n';
  assert.deepEqual(parseCsvRows(text), [
    ['a', 'b', 'c'],
    ['1', 'x, y', 'he said "hi"'],
    ['2', 'multi\nline', ''],
  ]);
});

test('blank lines are skipped; a missing trailing newline is fine', () => {
  assert.deepEqual(parseCsvRows('a\n\n1\n'), [['a'], ['1']]);
  assert.deepEqual(parseCsvRows('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
});

test('malformed quoting is an error, not a guess', () => {
  assert.throws(() => parseCsvRows('a\n"unterminated'), CsvError);
  assert.throws(() => parseCsvRows('a\nx"y"'), CsvError);
  assert.throws(() => parseCsvRows('a\n"x"y'), CsvError);
});

test('headers are normalised, row numbers match the spreadsheet, semicolon files are refused', () => {
  const { headers, records } = parseCsv('Source Price (THB),Name\n 12 , A \n\n3,B\n');
  assert.deepEqual(headers, ['source_price_thb', 'name']);
  assert.deepEqual(records, [
    { rowNumber: 2, values: { source_price_thb: '12', name: 'A' } },
    { rowNumber: 4, values: { source_price_thb: '3', name: 'B' } },
  ]);
  assert.throws(() => parseCsv('a;b;c\n1;2;3'), /comma-separated/);
  assert.throws(() => parseCsv('a,a\n1,2'), /Duplicate column/);
});

test('toCsv quotes when needed and defuses spreadsheet formulas', () => {
  const csv = toCsv(['a', 'b'], [{ a: 'x,y', b: '=HYPERLINK("evil")' }, { a: null, b: 'line\nbreak' }]);
  assert.equal(csv, 'a,b\r\n"x,y","\'=HYPERLINK(""evil"")"\r\n,"line\nbreak"\r\n');
  // And it reads back.
  assert.deepEqual(parseCsvRows(csv)[1], ['x,y', '\'=HYPERLINK("evil")']);
});

test('the shipped template parses and its SAMPLE rows normalise without errors', () => {
  const text = readFileSync(join(__dirname, '..', 'templates', 'supplier-import-template.csv'), 'utf8');
  const { records } = parseCsv(text);
  assert.equal(records.length, 2);
  for (const record of records) {
    const { normalized, issues } = normalizeRecord(record, { supplierCode: 'demo', brands: [], categories: [] });
    assert.equal(hasErrors(issues), false, JSON.stringify(issues));
    assert.equal(normalized.isSample, true, 'SAMPLE rows are flagged as samples');
  }
});

// ── Parsing values ─────────────────────────────────────────────────────────

test('prices in the formats suppliers actually write', () => {
  assert.deepEqual(parsePrice('฿1,250.00'), { amount: 1250, currency: 'THB' });
  assert.deepEqual(parsePrice('THB 1250'), { amount: 1250, currency: 'THB' });
  assert.deepEqual(parsePrice('1.250,50 €'), { amount: 1250.5, currency: 'EUR' });
  assert.deepEqual(parsePrice('12,50'), { amount: 12.5, currency: undefined });
  assert.deepEqual(parsePrice('1,250'), { amount: 1250, currency: undefined });
  assert.deepEqual(parsePrice('$19.99'), { amount: 19.99, currency: 'USD' });
  assert.deepEqual(parsePrice('£40'), { amount: 40, currency: 'GBP' });
  assert.deepEqual(parsePrice('1.250.000'), { amount: 1250000, currency: undefined });
  assert.equal(parsePrice('call us'), null);
  assert.equal(parsePrice('-5'), null);
  assert.equal(parsePrice('1-2'), null);
});

test('weights in grams from kg, g, lb, oz and bare numbers', () => {
  assert.equal(parseWeightGrams('1.8 kg'), 1800);
  assert.equal(parseWeightGrams('350g'), 350);
  assert.equal(parseWeightGrams('2 lb'), 907);
  assert.equal(parseWeightGrams('12 oz'), 340);
  assert.equal(parseWeightGrams('450'), 450);
  assert.equal(parseWeightGrams('1,5', 'weight_kg'), 1500);
  assert.equal(parseWeightGrams('heavy'), null);
  assert.equal(parseWeightGrams('3 stone'), null);
});

test('slugs and derived SKUs', () => {
  assert.equal(slugify('  Spoon Sports — Civic EG/EK Shift Knob! '), 'spoon-sports-civic-eg-ek-shift-knob');
  assert.equal(slugify('Ünïcödé'), 'unicode');
  assert.equal(deriveSku('th-garage', 'item 99/b'), 'TH-GARAGE-ITEM-99-B');
});

// ── Normalisation ──────────────────────────────────────────────────────────

const CONTEXT = {
  supplierCode: 'th-garage',
  brands: [{ documentId: 'b1', name: 'Spoon Sports', slug: 'spoon-sports' }],
  categories: [{ documentId: 'c1', name: 'Shift Knobs', slug: 'shift-knobs' }],
};

test('a good row normalises, matches brand and category, and stays unverified', () => {
  const { normalized, issues } = normalizeRecord(
    {
      rowNumber: 2,
      values: {
        item_id: '998877',
        url: 'https://shopee.co.th/item-i.1.998877?sp_atk=abc&utm_source=x&keep=1#reviews',
        title: 'Shift knob',
        brand: 'spoon sports',
        category: 'Shift Knobs',
        price: '฿890',
        availability: 'In stock',
        weight: '350 g',
        condition: 'used',
        authenticity: 'genuine_oem',
        country_of_origin: 'jp',
        margin: '40%',
        description: 'Supplier copy',
      },
    },
    CONTEXT,
  );
  assert.equal(hasErrors(issues), false);
  assert.equal(normalized.sku, 'TH-GARAGE-998877');
  assert.equal(normalized.sourceUrl, 'https://shopee.co.th/item-i.1.998877?keep=1', 'tracking params and fragment stripped');
  assert.equal(normalized.brandDocumentId, 'b1');
  assert.equal(normalized.categoryDocumentId, 'c1');
  assert.equal(normalized.sourcePrice, 890);
  assert.equal(normalized.sourceCurrency, 'THB');
  assert.equal(normalized.supplierAvailability, 'available');
  assert.equal(normalized.weightGrams, 350);
  assert.equal(normalized.condition, 'used_good');
  assert.equal(normalized.authenticity, 'unverified', 'a supplier claim is never taken as verified');
  assert.ok(issues.some((i) => i.field === 'authenticity' && i.level === 'warning'));
  assert.equal(normalized.countryOfOrigin, 'JP');
  assert.equal(normalized.marginPercent, 40);
  assert.equal(normalized.isSample, false);
});

test('errors: missing name and reference, bad URL, bad price, bad SKU, price without currency', () => {
  const { issues } = normalizeRecord(
    { rowNumber: 3, values: { url: 'javascript:alert(1)', price: 'ask', sku: 'bad sku!' } },
    CONTEXT,
  );
  const fields = issues.filter((i) => i.level === 'error').map((i) => i.field).sort();
  assert.deepEqual(fields, ['name', 'source_price', 'source_url', 'supplier_reference', 'sku'].sort());
  const noCurrency = normalizeRecord({ rowNumber: 4, values: { name: 'x', id: '1', price: '12' } }, CONTEXT);
  assert.ok(noCurrency.issues.some((i) => i.field === 'source_currency' && i.level === 'error'));
});

test('unmatched brand and category are warnings, not silent', () => {
  const { issues, normalized } = normalizeRecord({ rowNumber: 2, values: { name: 'x', id: '1', brand: 'Mugen', category: 'Wings' } }, CONTEXT);
  assert.equal(hasErrors(issues), false);
  assert.equal(normalized.brandDocumentId, undefined);
  assert.ok(issues.some((i) => i.field === 'brand'));
  assert.ok(issues.some((i) => i.field === 'category'));
});

// ── Duplicates ─────────────────────────────────────────────────────────────

const base = (over) => ({ supplierReference: 'R1', sourceUrl: 'https://s/1', name: 'Civic EG front lip carbon', sku: 'SKU-1', ...over });

test('exact duplicates: same supplier reference, same URL, same SKU (incl. variant SKUs)', () => {
  const existing = [
    { documentId: 'p1', name: 'Other', sku: 'X', variantSkus: [], supplierCode: 'th-garage', supplierReference: 'R1' },
    { documentId: 'p2', name: 'Other', sku: 'Y', variantSkus: [], sourceUrl: 'https://s/2/' },
    { documentId: 'p3', name: 'Other', sku: 'Z', variantSkus: ['SKU-3'] },
  ];
  const ctx = { supplierCode: 'th-garage', existing, earlier: [] };
  assert.deepEqual(findDuplicates(base({}), ctx).map((m) => [m.strength, m.reason, m.of]), [['exact', 'supplier_reference', 'p1']]);
  assert.deepEqual(findDuplicates(base({ supplierReference: 'R9', sourceUrl: 'https://S/2' }), ctx).map((m) => m.of), ['p2']);
  assert.deepEqual(findDuplicates(base({ supplierReference: 'R9', sourceUrl: undefined, sku: 'sku-3' }), ctx).map((m) => m.of), ['p3']);
  // Same reference from a DIFFERENT supplier is not a duplicate.
  assert.deepEqual(findDuplicates(base({}), { ...ctx, supplierCode: 'other' }).length, 0);
});

test('similar names are a possible match, and EG vs EK is not similar enough', () => {
  assert.ok(nameSimilarity('Civic EG front lip carbon', 'Carbon front lip for the Civic EG') >= 0.8);
  assert.ok(nameSimilarity('Civic EG front lip carbon', 'Civic EK front lip carbon') < 0.8);
  const matches = findDuplicates(base({ supplierReference: 'N', sourceUrl: undefined, sku: 'N' }), {
    supplierCode: 's',
    existing: [{ documentId: 'p9', name: 'Carbon front lip for the Civic EG', sku: 'Q', variantSkus: [] }],
    earlier: [],
  });
  assert.deepEqual(matches.map((m) => [m.strength, m.reason]), [['possible', 'similar_name']]);
});

test('duplicates within the same file are caught', () => {
  const matches = findDuplicates(base({ sku: 'NEW' }), {
    supplierCode: 's',
    existing: [],
    earlier: [{ rowNumber: 2, record: base({ sku: 'OTHER' }) }],
  });
  assert.deepEqual(matches.map((m) => [m.reason, m.of]), [['supplier_reference', 'row:2']]);
});

// ── Draft shape ────────────────────────────────────────────────────────────

test('a promoted row becomes a draft with no public price, images or description', () => {
  const { normalized } = normalizeRecord(
    { rowNumber: 2, values: { id: '1', name: 'Knob', price: '1000', currency: 'THB', margin: '50', description: 'COPIED SUPPLIER TEXT', brand: 'Spoon Sports' } },
    CONTEXT,
  );
  const data = draftProductData(normalized, { supplierDocumentId: 's1', supplierName: 'TH Garage', batchLabel: 'b', now: '2026-11-23T00:00:00.000Z' });
  assert.equal(data.price, undefined);
  assert.equal(data.discountPrice, undefined);
  assert.equal(data.description, undefined);
  assert.equal(data.shortDescription, undefined);
  assert.equal(data.mainImage, undefined);
  assert.equal(data.gallery, undefined);
  assert.equal(data.reviewStatus, 'draft');
  assert.equal(data.importStatus, 'imported_unreviewed');
  assert.equal(data.availability, 'out_of_stock');
  assert.equal(data.authenticity, 'unverified');
  assert.equal(data.imageRights, 'not_cleared');
  assert.equal(data.sourcePrice, 1000);
  assert.deepEqual(data.brand, { connect: ['b1'] });
  assert.match(data.provenance, /SUGGESTED selling price at 50% margin: 1500 THB/);
  assert.match(data.provenance, /NOT licensed for publication[\s\S]*COPIED SUPPLIER TEXT/);
});

// ── Adapters ───────────────────────────────────────────────────────────────

test('only the CSV adapter runs; API and feed adapters refuse until authorized', async () => {
  const rows = [];
  for await (const row of ADAPTERS.csv.fetch({ supplierCode: 's', csv: 'name\nA\n' })) rows.push(row);
  assert.equal(rows.length, 1);
  for (const id of ['authorized_api', 'authorized_feed']) {
    await assert.rejects(async () => {
      for await (const _ of ADAPTERS[id].fetch({ supplierCode: 's' })) void _;
    }, /authoriz/i);
    assert.match(ADAPTERS[id].authorization, /UNIMPLEMENTED/);
  }
});
