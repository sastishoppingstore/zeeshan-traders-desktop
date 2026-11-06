/**
 * The session vault: where the desktop keeps the login between launches.
 *
 * The token is the session — anyone holding it can post sales in the shop's name for fourteen days.
 * So it goes to disk only through Electron's `safeStorage`, which on Windows is DPAPI bound to this
 * Windows user account, and nowhere else: not localStorage (readable by any renderer, synced by any
 * crash-dumper, plain text on disk), not the command line, not the log.
 *
 * If the OS offers no encryption at all — a Linux box with no keyring, which is a developer machine and
 * never a shop's — the session is kept in memory for this run and simply not written. Refusing to store
 * beats storing in plain text: the user signs in again after a restart, and nothing leaks.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const HEADER = 'ZTV1';        // so a rewritten or plaintext file is recognisable rather than decoded blind

function createVault({ file, log = () => {}, cipher }) {
  let memory = null;              // the session when the OS will not encrypt it
  let encryptedOnDisk = false;
  let warnedAboutEncryption = false;

  const sane = (s) => !!(s && typeof s.token === 'string' && s.token.length >= 16);
  const expired = (s) => !s?.expires_at || Date.parse(s.expires_at) <= Date.now();

  function read() {
    try {
      const raw = fs.readFileSync(file);
      if (!raw.subarray(0, 4).equals(Buffer.from(HEADER))) {
        // A session.bin from an older build, or a hand-edited file. Never decrypt-and-trust it.
        log('session file is not a vault blob — ignoring it until the next sign-in', { file });
        return null;
      }
      const json = cipher.decryptString(raw.subarray(4));
      const parsed = JSON.parse(json);
      return sane(parsed) ? parsed : null;
    } catch {
      return memory;               // missing file, unreadable, or the key changed: fall back to this run
    }
  }

  function write(session) {
    memory = session;
    const target = session ? Buffer.from(JSON.stringify(session), 'utf8') : null;
    if (!target) {
      try { fs.rmSync(file, { force: true }); } catch { /* already gone */ }
      encryptedOnDisk = false;
      return;
    }
    if (!cipher.available) {
      if (!warnedAboutEncryption) {
        warnedAboutEncryption = true;
        log('OS keychain unavailable — the session will not survive a restart on this machine');
      }
      return;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const blob = Buffer.concat([Buffer.from(HEADER), cipher.encryptString(target)]);
    // Write-then-rename so a crash mid-write cannot leave a half-written vault that locks the shop out.
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, blob, { mode: 0o600 });
    fs.renameSync(tmp, file);
    encryptedOnDisk = true;
  }

  return {
    file,
    get: () => read(),
    /** The bearer token the sync engine and the forwarder send, or null when signed out. */
    token: () => read()?.token ?? null,
    /**
     * The stored session plus whether the server still considers it live. An expired session is NOT
     * signed out: the shop keeps working offline on the local mirror, and only an online request turns
     * into a re-login. That distinction lives here so no caller has to guess it.
     */
    session: () => {
      const s = read();
      // `expired` is true when the clock says so OR when a revalidation already proved the server
      // rejects this token — a session can be killed long before its fourteen days are up.
      return s ? { ...s, expired: s.expired === true || expired(s) } : null;
    },
    save: (session) => { write(sane(session) ? session : null); },
    clear: () => write(null),
    encryptionAvailable: () => !!cipher.available,
  };
}

module.exports = { createVault, HEADER };
