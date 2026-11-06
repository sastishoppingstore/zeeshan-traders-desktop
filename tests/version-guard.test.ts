/**
 * Optimistic locking on the normal web endpoints (Part 5).
 *
 * /sync/rows/push is the desktop's write path, but a browser tab still edits products, categories,
 * payment methods, CMS pages and settings directly. Those routes accept a `base_version`; a stale
 * one must answer 409 VERSION_CONFLICT together with the row the server holds now, and must not write.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { makeHarness, createProduct, type Harness } from './helpers.js';

let h: Harness;
beforeAll(async () => {
  h = makeHarness();
  await h.setup();
});

describe('normal endpoints enforce base_version', () => {
  it('products: a stale base_version is a 409 carrying the current row, and nothing is written', async () => {
    const product = await createProduct(h);
    const read = await h.call('GET', `/api/v1/products/${product.id}`);
    expect(read.status).toBe(200);
    const version = read.json.data.version as number;

    // Correct version succeeds and bumps it.
    const okUpdate = await h.call('PUT', `/api/v1/products/${product.id}`, {
      base_version: version, name_en: 'Renamed once',
    });
    expect(okUpdate.status).toBe(200);
    expect(okUpdate.json.data.version).toBe(version + 1);

    // The same version again is stale now: the server must refuse and hand back its row.
    const stale = await h.call('PUT', `/api/v1/products/${product.id}`, {
      base_version: version, name_en: 'Clobbered',
    });
    expect(stale.status).toBe(409);
    expect(stale.json.error.code).toBe('VERSION_CONFLICT');
    expect(stale.json.error.current.id).toBe(product.id);
    expect(stale.json.error.current.version).toBe(version + 1);
    expect(stale.json.error.current.name_en).toBe('Renamed once');

    const after = await h.call('GET', `/api/v1/products/${product.id}`);
    expect(after.json.data.name_en).toBe('Renamed once');
  });

  it('categories: a stale base_version is refused instead of overwriting', async () => {
    const created = await h.call('POST', '/api/v1/categories', {
      code: 'vg-' + Math.random().toString(36).slice(2, 7),
      name_ur: 'ٹیسٹ زمرہ', name_en: 'Guard category',
      slug: 'guard-' + Math.random().toString(36).slice(2, 7),
    });
    expect(created.status).toBe(201);
    const id = created.json.data.id as string;

    const list = await h.call('GET', '/api/v1/categories');
    const before = (list.json.data as any[]).find((c) => c.id === id);
    expect(before.version).toBe(1);

    const okUpdate = await h.call('PUT', `/api/v1/categories/${id}`, { base_version: before.version, name_en: 'First edit' });
    expect(okUpdate.status).toBe(200);

    const stale = await h.call('PUT', `/api/v1/categories/${id}`, { base_version: before.version, name_en: 'Second edit' });
    expect(stale.status).toBe(409);
    expect(stale.json.error.code).toBe('VERSION_CONFLICT');
    expect(stale.json.error.current.version).toBe(2);
  });

  it('settings: a stale base_version on an existing key is refused', async () => {
    const key = 'hero_tagline';
    const first = await h.call('PUT', '/api/v1/settings', { key, value: 'پہلی قدر' });
    expect(first.status).toBe(200);
    const v1 = first.json.data.version as number;

    const second = await h.call('PUT', '/api/v1/settings', { key, value: 'دوسری قدر', base_version: v1 });
    expect(second.status).toBe(200);
    expect(second.json.data.version).toBe(v1 + 1);

    const stale = await h.call('PUT', '/api/v1/settings', { key, value: 'غلط', base_version: v1 });
    expect(stale.status).toBe(409);
    expect(stale.json.error.code).toBe('VERSION_CONFLICT');
  });

  it('a write without base_version keeps working (legacy callers)', async () => {
    const product = await createProduct(h);
    const res = await h.call('PUT', `/api/v1/products/${product.id}`, { name_en: 'No version sent' });
    expect(res.status).toBe(200);
  });
});
