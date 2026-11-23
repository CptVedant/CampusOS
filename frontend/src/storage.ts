import type { Auth } from './types';
const AUTH_KEY = 'campusos.auth';
export function readAuth(): Auth | null {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY) ?? 'null') as Auth | null;
  } catch {
    return null;
  }
}
export function saveAuth(auth: Auth | null) {
  if (auth) localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  else localStorage.removeItem(AUTH_KEY);
}
export function fingerprint() {
  const key = 'campusos.device';
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  // getRandomValues also works when a phone visits the dev server over LAN HTTP.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  const id = [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
  localStorage.setItem(key, id);
  return id;
}
