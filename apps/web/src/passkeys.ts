/** Browser-side WebAuthn. The Site never receives a fingerprint: only a signed challenge. */
import { startRegistration, startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { api } from './api.js';

export const passkeysSupported = (): boolean => {
  try { return browserSupportsWebAuthn(); } catch { return false; }
};

/** Register a passkey for the currently signed-in user (CSRF enforced by the Worker). */
export async function registerPasskey(): Promise<{ credential_id: string }> {
  const { options } = await api<{ options: any }>('/api/v1/auth/passkey/register/options', { method: 'POST', body: {} });
  const response = await startRegistration({ optionsJSON: options });
  return api('/api/v1/auth/passkey/register/verify', { method: 'POST', body: { response } });
}

/** Log in with a passkey; sets the session cookie server-side. */
export async function loginWithPasskey(deviceId?: string): Promise<{ name: string }> {
  const { options } = await api<{ options: any }>('/api/v1/auth/passkey/authenticate/options', { method: 'POST', body: {} });
  const response = await startAuthentication({ optionsJSON: options });
  return api('/api/v1/auth/passkey/authenticate/verify', {
    method: 'POST', body: { response, device_id: deviceId ?? localStorage.getItem('zt_device_id') ?? undefined },
  });
}

export async function listPasskeys(): Promise<any[]> {
  return api('/api/v1/auth/passkeys');
}

export async function revokePasskey(id: string): Promise<void> {
  await api(`/api/v1/auth/passkeys/${id}/revoke`, { method: 'POST', body: {} });
}
