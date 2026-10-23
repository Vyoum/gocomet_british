/**
 * DEMO role switch — NOT authentication. The chosen role is stored in localStorage and sent as
 * X-Role / X-Supplier headers; the backend trusts them. 'open' sends no headers (legacy behaviour).
 */
import { useEffect, useState } from 'react';

export type Role = { kind: 'open' } | { kind: 'buyer' } | { kind: 'supplier'; name: string };
const KEY = 'rfq.demoRole';
const EVT = 'rfq-role-change';

export function getRole(): Role {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (r?.kind === 'buyer') return r;
    if (r?.kind === 'supplier' && typeof r.name === 'string' && r.name.trim()) return { kind: 'supplier', name: r.name.trim() };
  } catch { /* ignore */ }
  return { kind: 'open' };
}
export function setRole(r: Role) {
  if (r.kind === 'open') localStorage.removeItem(KEY); else localStorage.setItem(KEY, JSON.stringify(r));
  window.dispatchEvent(new Event(EVT));
}
export function roleHeaders(r: Role = getRole()): Record<string, string> {
  if (r.kind === 'buyer') return { 'X-Role': 'buyer' };
  if (r.kind === 'supplier') return { 'X-Role': 'supplier', 'X-Supplier': r.name };
  return {};
}
export const canCreate = (r: Role) => r.kind !== 'supplier';
export const canBid = (r: Role) => r.kind !== 'buyer';
export const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function useRole(): Role {
  const [r, set] = useState(getRole);
  useEffect(() => {
    const on = () => set(getRole());
    window.addEventListener(EVT, on); window.addEventListener('storage', on);
    return () => { window.removeEventListener(EVT, on); window.removeEventListener('storage', on); };
  }, []);
  return r;
}
