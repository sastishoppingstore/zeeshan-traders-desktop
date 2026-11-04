/** Cron Triggers: nightly encrypted backup, integrity check, cleanup, alert generation. */
import type { AppEnv } from './context.js';
import { makeDb, nowIso } from './context.js';
import { runIntegrity } from './routes/reports.js';
import { runBackup } from './routes/ops.js';
import { ulid } from '@zt/shared';

export interface CronContext { waitUntil(promise: Promise<unknown>): void; cron: string; scheduledTime: number }

export async function scheduled(_event: unknown, env: AppEnv, ctx: CronContext): Promise<void> {
  const db = makeDb(env);
  const fakeCtx: any = {
    get: (key: string) => (key === 'db' ? db : key === 'user' ? { id: 'cron' } : undefined),
    env,
  };
  const jobs: Promise<void>[] = [];

  jobs.push((async () => {
    try {
      const result = await runIntegrity(db);
      await db.prepare('INSERT INTO job_runs (id,job,at,result,details_json) VALUES (?,?,?,?,?)')
        .bind(ulid(), 'integrity', nowIso(), result.ok ? 'PASS' : 'FAIL', JSON.stringify(result)).run();
      if (!result.ok) console.error('[ZT CRON] integrity FAILED', JSON.stringify(result.problems));
    } catch (e) {
      await db.prepare('INSERT INTO job_runs (id,job,at,result,details_json) VALUES (?,?,?,?,?)')
        .bind(ulid(), 'integrity', nowIso(), 'ERROR', JSON.stringify({ error: String(e) })).run();
    }
  })());

  jobs.push((async () => {
    try { await runBackup(fakeCtx); }
    catch (e) {
      console.error('[ZT CRON] backup failed', e);
      await db.prepare('INSERT INTO backup_logs (id,at,size_bytes,result,details_json) VALUES (?,?,?,?,?)')
        .bind(ulid(), nowIso(), 0, 'FAILED', JSON.stringify({ error: String(e) })).run();
    }
  })());

  jobs.push((async () => {
    try {
      await db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(nowIso()).run();
      await db.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(String(Math.floor(Date.now() / 3600_000) - 48)).run();
      const low = await db.prepare(`SELECT p.id,p.name_ur FROM products p JOIN stock_balance sb ON sb.product_id=p.id
        WHERE p.reorder_level_milli>0 AND sb.qty_milli<p.reorder_level_milli LIMIT 50`).all<any>();
      for (const r of low) {
        await db.prepare(`INSERT INTO notifications (id,user_id,type,title_ur,body_ur,created_at,read_at)
          VALUES (?,NULL,'LOW_STOCK',?,?,?,NULL)`).bind(ulid(), 'کم اسٹاک', r.name_ur, nowIso()).run();
      }
      const near = await db.prepare(`SELECT pb.id,p.name_ur,pb.expiry_date FROM product_batches pb JOIN products p ON p.id=pb.product_id
        WHERE pb.expiry_date IS NOT NULL AND pb.expiry_date<=date('now','90 days') LIMIT 50`).all<any>();
      for (const r of near) {
        await db.prepare(`INSERT INTO notifications (id,user_id,type,title_ur,body_ur,created_at,read_at)
          VALUES (?,NULL,'EXPIRY',?,?,?,NULL)`).bind(ulid(), 'ایکسپائری قریب ہے', `${r.name_ur} — ${r.expiry_date}`, nowIso()).run();
      }
      await db.prepare('INSERT INTO job_runs (id,job,at,result,details_json) VALUES (?,?,?,?,?)')
        .bind(ulid(), 'cleanup', nowIso(), 'PASS', JSON.stringify({ low_stock: low.length, expiry: near.length })).run();
    } catch (e) { console.error('[ZT CRON] cleanup failed', e); }
  })());

  ctx.waitUntil(Promise.all(jobs));
}
