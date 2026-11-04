-- Admin User: wafaweb / Wafa@1122 (100,000 iterations for Cloudflare Workers Web Crypto)
INSERT INTO users (id, username, display_name, mobile, password_hash, password_salt, iterations, status, failed_attempts, locked_until, created_at, updated_at, version)
VALUES ('usr-wafaweb', 'wafaweb', 'Wafa Web (ایڈمن)', '0307-7864722', '0KeiZ8y9jiejj9y2wVSTJDm9RSM24Ajv1hluR8PRhO0=', 'yiRp5ziKGL1iaUvo8cnOUw==', 100000, 'ACTIVE', 0, NULL, '2026-11-04T00:00:00.000Z', '2026-11-04T00:00:00.000Z', 1)
ON CONFLICT(username) DO UPDATE SET
  password_hash=excluded.password_hash,
  password_salt=excluded.password_salt,
  iterations=excluded.iterations,
  status='ACTIVE',
  failed_attempts=0,
  locked_until=NULL,
  updated_at='2026-11-04T00:00:00.000Z';

INSERT OR IGNORE INTO user_roles (user_id, role_id)
VALUES ('usr-wafaweb', 'role-owner');

UPDATE business_settings SET value='true', updated_at='2026-11-04T00:00:00.000Z' WHERE key='setup_complete';

