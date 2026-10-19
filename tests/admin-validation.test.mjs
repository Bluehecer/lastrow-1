import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { escapeDate, validatePublishingDate } from '../admin-validation.mjs';

const script = await readFile(new URL('../script.js', import.meta.url), 'utf8');
const adminHtml = await readFile(new URL('../admin.html', import.meta.url), 'utf8');

test('products can publish without a date while events and news still require one', () => {
  assert.doesNotThrow(() => validatePublishingDate('products', ''));
  assert.doesNotThrow(() => validatePublishingDate('products', undefined));

  for (const collectionName of ['events', 'news']) {
    assert.throws(
      () => validatePublishingDate(collectionName, ''),
      { message: 'Choose a valid date.' }
    );
    assert.throws(
      () => validatePublishingDate(collectionName, '2026-2-01'),
      { message: 'Choose a valid date.' }
    );
    assert.doesNotThrow(() => validatePublishingDate(collectionName, '2026-02-01'));
  }

  assert.equal(escapeDate('2026-02-01'), true);
  assert.equal(escapeDate('2026-2-01'), false);
});

test('admin forms and shared submit handler use collection-scoped date validation', () => {
  assert.match(script, /validatePublishingDate\(collectionName, date\)/);
  assert.match(script, /collectionName: 'events', fields: \['title', 'date'/);
  assert.match(script, /collectionName: 'news', fields: \['title', 'date'/);
  assert.match(script, /collectionName: 'products', fields: \['title', 'price', 'description'\]/);

  const productForm = adminHtml.match(/<form id="productForm"[\s\S]*?<\/form>/)?.[0];
  assert.ok(productForm, 'product form exists');
  assert.doesNotMatch(productForm, /name="date"/);
});

test('publishing shows an animated in-form progress state and reports the result', () => {
  for (const formId of ['eventForm', 'newsForm', 'productForm']) {
    const form = adminHtml.match(new RegExp(`<form id="${formId}"[\\s\\S]*?<\\/form>`))?.[0];
    assert.ok(form, `${formId} exists`);
    assert.match(form, /class="publish-feedback full-field" role="status" aria-live="polite" hidden/);
  }

  assert.match(script, /classList\.add\('is-publishing'\)/);
  assert.match(script, /class="publish-spinner" aria-hidden="true"/);
  assert.match(script, /Product published and live in the store\./);
  assert.match(script, /feedback\.textContent = `Could not publish: \$\{error\.message\}`/);
  assert.match(script, /uploadBytesResumable/);
  assert.match(script, /Uploading photo… \$\{percentage\}%/);
  assert.match(script, /Saving product to the store…/);
  assert.match(script, /Keep this page open and don’t click again yet\./);
  assert.match(script, /published, but its photo or video could not be attached/);
  assert.match(script, /publishRecordWithOptionalMedia/);
});
