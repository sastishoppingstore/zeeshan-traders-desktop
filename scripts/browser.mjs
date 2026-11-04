/** Headless Chromium for this sandbox.
 *  Preference order: $ZT_CHROME, then a native system Chromium (arch-matched, no extraction),
 *  then @sparticuz/chromium — a compressed x86-64 build whose AL2023 shared libs we inflate once
 *  into /tmp and run through the qemu-x86-64 binfmt handler when the host is a different arch.
 *  Never reaches any network host.
 */
import { chromium as playwright } from 'playwright-core';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import zlib from 'node:zlib';

const LIB = join(tmpdir(), 'al2023', 'lib');
const NATIVE = ['ZT_CHROME', 'CHROME_PATH'].map((k) => process.env[k]).find(Boolean)
  ?? ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find((p) => existsSync(p));

function launchNative(executablePath) {
  return playwright.launch({
    executablePath, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--font-render-hinting=none'],
    env: { ...process.env, HOME: process.env.HOME ?? tmpdir() },
  });
}

async function launchSparticuz() {
  const { default: chromium } = await import('@sparticuz/chromium');
  if (!existsSync(join(LIB, 'libnss3.so'))) {
    const br = readFileSync('node_modules/@sparticuz/chromium/bin/al2023.tar.br');
    const tarPath = join(tmpdir(), 'al2023.tar');
    writeFileSync(tarPath, zlib.brotliDecompressSync(br));
    mkdirSync(join(tmpdir(), 'al2023'), { recursive: true });
    execFileSync('tar', ['-xf', tarPath, '-C', join(tmpdir(), 'al2023')]);
  }
  const executablePath = await chromium.executablePath();
  return playwright.launch({
    executablePath,
    headless: true,
    args: [...chromium.args, '--no-sandbox', '--disable-dev-shm-usage'],
    env: {
      ...process.env,
      LD_LIBRARY_PATH: LIB,
      FONTCONFIG_PATH: join(tmpdir(), 'fonts'),
      HOME: tmpdir(),
    },
  });
}

export async function launchBrowser() {
  if (NATIVE) {
    try { return await launchNative(NATIVE); } catch { /* fall through to the bundled build */ }
  }
  return launchSparticuz();
}

export async function addVirtualAuthenticator(context, page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { cdp, authenticatorId };
}
