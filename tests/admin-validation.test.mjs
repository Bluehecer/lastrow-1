import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { escapeDate, validatePublishingDate } from '../admin-validation.mjs';

const script = await readFile(new URL('../script.js', import.meta.url), 'utf8');
const adminHtml = await readFile(new URL('../admin.html', import.meta.url), 'utf8');
const storeHtml = await readFile(new URL('../store.html', import.meta.url), 'utf8');
const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

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
  assert.match(script, /feedback\.textContent = `Could not publish: \$\{error\.message\}\.\$\{orphanNote\}`/);
  assert.match(script, /uploadMediaToCloudinary/);
  assert.match(script, /Uploading media to Cloudinary…/);
  assert.match(script, /Saving product to the store…/);
  assert.match(script, /Keep this page open and don’t click again yet\./);
  assert.match(script, /\.\.\.payload,\s*\.\.\.media,\s*updatedAt: serverTimestamp\(\)/);
  assert.match(script, /publishRecordWithOptionalMedia/);
});

test('published events, updates, and products can be edited in their existing forms', () => {
  for (const formId of ['eventForm', 'newsForm', 'productForm']) {
    const form = adminHtml.match(new RegExp(`<form id="${formId}"[\\s\\S]*?<\\/form>`))?.[0];
    assert.match(form, /name="recordId"/);
    assert.match(form, /class="btn btn-outline cancel-content-edit" type="button" hidden>Cancel edit/);
  }
  assert.match(script, /beginContentEdit\(collectionName, item\)/);
  assert.match(script, /updateDoc\(doc\(db, collectionName, recordId\), recordData\)/);
  assert.match(script, /resetContentForm\(form, formConfig\.title, formConfig\.button\)/);
});

test('store displays skeleton cards until products load and respects reduced motion', () => {
  const productGrid = storeHtml.match(/<div class="product-grid" id="products"[\s\S]*?<\/div><\/section>/)?.[0];
  assert.ok(productGrid, 'store product grid exists');
  assert.match(productGrid, /aria-busy="true"/);
  assert.equal((productGrid.match(/class="product-card product-skeleton"/g) || []).length, 3);
  assert.match(script, /products\.setAttribute\('aria-busy', 'false'\)/);
  assert.match(styles, /\.product-card:not\(\.product-skeleton\):hover \{ transform: translateY\(-4px\)/);
  assert.match(styles, /:hover \.product-media \{ transform: scale\(1\.035\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test('mobile layouts use fresh assets and the store note icon is drawn with CSS', () => {
  assert.match(storeHtml, /store-note-icon" aria-hidden="true"><\/span>/);
  assert.doesNotMatch(storeHtml, /store-note-icon">✳/);
  assert.match(styles, /@media \(max-width: 680px\) \{[\s\S]*?\.product-grid \{ gap: 0\.9rem; \}/);
  assert.match(styles, /@media \(max-width: 380px\)/);
  assert.match(styles, /linear-gradient\(-45deg, transparent 47%, #ff678b 48% 52%, transparent 53%\)/);
});
