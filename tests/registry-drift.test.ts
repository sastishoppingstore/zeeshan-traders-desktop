/**
 * The Electron main process runs against `electron/registry.cjs`, a generated CommonJS mirror of
 * `packages/shared/src/sync.ts`. If the two ever drift, a desktop pull can key a table by the wrong
 * column (a phantom conflict on every sync) or a push can miss a column the server requires — silent
 * data loss, on a machine in a shop, offline.
 *
 * `electron/verify-registry.cjs` is the developer's gate, but CI only runs `npm test`. This test
 * makes the same comparison inside the suite, so drift can never reach `main` again. It is what
 * caught `website_pages.pk` being `id` while the schema keys that table by `slug`.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { COMMAND_ENTITIES, REPLICA_ENTITIES, ROW_ENTITIES, ALL_ENTITIES, SYNCED_TABLES } from '@zt/shared';

const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CJS = require(`${ROOT}electron/registry.cjs`) as any;

describe('electron/registry.cjs mirrors packages/shared/src/sync.ts', () => {
  it('has identical entity definitions', () => {
    expect(CJS.ROW_ENTITIES).toEqual(ROW_ENTITIES);
    expect(CJS.COMMAND_ENTITIES).toEqual(COMMAND_ENTITIES);
    expect(CJS.REPLICA_ENTITIES).toEqual(REPLICA_ENTITIES);
  });

  it('agrees on table, tier and primary key for every entity', () => {
    for (const e of ALL_ENTITIES) {
      const mirror = CJS.entityOf(e.entity);
      expect(mirror, `entity ${e.entity} missing from the mirror`).toBeTruthy();
      expect(mirror.table, `${e.entity} table`).toBe(e.table);
      expect(mirror.tier, `${e.entity} tier`).toBe(e.tier);
      expect(mirror.pk, `${e.entity} pk`).toBe(e.pk);
    }
  });

  it('covers exactly the same synced tables', () => {
    expect([...CJS.SYNCED_TABLES].sort()).toEqual([...SYNCED_TABLES].sort());
  });
});
