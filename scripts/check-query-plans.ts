/** CI query-plan gate: EXPLAIN QUERY PLAN on the hot paths; fail on a full SCAN of a big table.
 *  SQLite/D1 share the same planner and index syntax, so this is representative for D1.
 *  Run: npx tsx scripts/check-query-plans.ts   (writes .dev/query-plan-report.json) */
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openLocalDatabase } from '../apps/worker/src/db.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const BIG = new Set(['sales', 'sale_items', 'purchases', 'purchase_items', 'journal_lines', 'journal_entries',
  'party_ledger', 'stock_movements', 'stock_balance', 'documents', 'account_transactions', 'grain_lots',
  'product_batches', 'sync_operations', 'audit_logs', 'daily_summary', 'receipts', 'payments', 'expenses',
  'payment_allocations', 'website_enquiries', 'products', 'grain_weighments', 'salary_records']);

interface Case { name: string; sql: string; args?: (string | number)[] }
const CASES: Case[] = [
  { name: 'private products keyset', sql: `SELECT p.*, c.name_ur FROM products p JOIN product_categories c ON c.id=p.category_id
     WHERE p.is_published=1 AND p.is_active=1 AND (p.created_at < ? OR (p.created_at=? AND p.id < ?))
     ORDER BY p.created_at DESC, p.id DESC LIMIT ?`, args: ['2026-01-01', '2026-01-01', 'x', 25] },
  { name: 'public products search', sql: `SELECT p.* FROM products p LEFT JOIN brands b ON b.id=p.brand_id
     WHERE p.is_published=1 AND p.is_active=1 AND (p.name_ur LIKE ? OR p.sku LIKE ?)
     ORDER BY p.created_at DESC, p.id DESC LIMIT ?`, args: ['%a%', '%a%', 25] },
  { name: 'documents by date', sql: `SELECT id,type,number,date FROM documents
     WHERE date>=? AND date<=? ORDER BY date DESC, created_at DESC LIMIT 100`, args: ['2026-01-01', '2026-12-31'] },
  { name: 'party ledger by date', sql: `SELECT l.*,p.name_ur FROM party_ledger l JOIN parties p ON p.id=l.party_id
     WHERE l.date>=? AND l.date<=? ORDER BY l.date,l.created_at LIMIT 500`, args: ['2026-01-01', '2026-12-31'] },
  { name: 'journal P&L by period', sql: `SELECT jl.account_code,SUM(jl.debit_paisa) FROM journal_lines jl
     JOIN journal_entries je ON je.id=jl.entry_id JOIN chart_of_accounts co ON co.code=jl.account_code
     WHERE je.date>=? AND je.date<=? GROUP BY jl.account_code`, args: ['2026-01-01', '2026-12-31'] },
  { name: 'stock ledger by product', sql: `SELECT * FROM stock_movements WHERE product_id=? ORDER BY date DESC LIMIT 100`, args: ['p1'] },
  { name: 'daily summary by date', sql: `SELECT book_code,metric,SUM(value_paisa) FROM daily_summary
     WHERE date>=? AND date<=? GROUP BY book_code,metric`, args: ['2026-01-01', '2026-12-31'] },
  { name: 'sales list by date', sql: `SELECT * FROM sales WHERE date>=? AND date<=? ORDER BY date DESC LIMIT 100`, args: ['2026-01-01', '2026-12-31'] },
  { name: 'purchases by book/date', sql: `SELECT * FROM purchases WHERE book_code=? AND date>=? AND date<=?`, args: ['FERT', '2026-01-01', '2026-12-31'] },
  { name: 'account transactions', sql: `SELECT * FROM account_transactions WHERE account_id=? AND date>=? AND date<=?`, args: ['acct-cash', '2026-01-01', '2026-12-31'] },
  { name: 'batches FEFO', sql: `SELECT * FROM product_batches WHERE product_id=? AND expiry_date<=? ORDER BY expiry_date`, args: ['p1', '2027-01-01'] },
  { name: 'audit by date', sql: `SELECT * FROM audit_logs WHERE at>=? AND at<=? ORDER BY at DESC LIMIT 100`, args: ['2026-01-01', '2027-01-01'] },
  { name: 'grain lots by crop', sql: `SELECT * FROM grain_lots WHERE crop=? ORDER BY opened_at DESC LIMIT 100`, args: ['WHEAT'] },
  { name: 'sync idempotency lookup', sql: `SELECT * FROM sync_operations WHERE idempotency_key=?`, args: ['key'] },
  { name: 'receipts by party', sql: `SELECT * FROM receipts WHERE party_id=? AND date>=?`, args: ['party1', '2026-01-01'] },
];

const db = openLocalDatabase(':memory:');
const files = readdirSync(path.join(ROOT, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
for (const f of files) db.exec(readFileSync(path.join(ROOT, 'migrations', f), 'utf8'));

const report = CASES.map((c) => {
  const rows = db.prepare(`EXPLAIN QUERY PLAN ${c.sql}`).all(...(c.args ?? [])) as any[];
  const details = rows.map((r) => String(r.detail ?? ''));
  // A bare "SCAN <big table>" is a full table scan. "SCAN x USING INDEX/COVERING INDEX" is fine.
  const bad = details.filter((d) => {
    const m = /\bSCAN\s+([A-Za-z_][A-Za-z0-9_]*)\b/i.exec(d);
    return m && BIG.has(m[1].toLowerCase()) && !/USING (COVERING )?INDEX/i.test(d) && !/USING INTEGER PRIMARY KEY/i.test(d);
  });
  return { name: c.name, plan: details, full_scans: bad, pass: bad.length === 0 };
});

mkdirSync(path.join(ROOT, '.dev'), { recursive: true });
const out = { migrations: files, cases: report, passed: report.filter((r) => r.pass).length, failed: report.filter((r) => !r.pass).length };
writeFileSync(path.join(ROOT, '.dev', 'query-plan-report.json'), JSON.stringify(out, null, 2));
for (const r of report) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`);
  if (!r.pass) console.log('       ' + r.full_scans.join(' | '));
}
console.log(`\n${out.passed}/${report.length} hot queries use an index; ${out.failed} full scans.`);
if (out.failed) { console.error('QUERY-PLAN GATE FAILED — add an index or narrow the query.'); process.exit(1); }
