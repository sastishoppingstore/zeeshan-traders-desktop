/** Cloudflare Worker entry point. Local preview runs the SAME app via apps/worker/src/server/node-server.ts. */
import { createApp } from './app.js';
import { scheduled } from './cron.js';
import type { AppEnv } from './context.js';

const app = createApp();

export default {
  fetch(request: Request, env: AppEnv, ctx: unknown): Promise<Response> {
    return Promise.resolve(app.fetch(request, env, ctx as any));
  },
  scheduled,
} as const;
