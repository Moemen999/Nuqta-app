import type { Transaction } from '@/context/DataContext';

export function walletBalance(tx: Transaction[], walletId: string, opening: number) {
  return tx.reduce((s, t) => {
    if (t.type === 'income') return t.walletId === walletId ? s + t.amount : s;
    if (t.type === 'withdraw') {
      let r = s;
      if (t.walletId === walletId) r -= t.amount;
      if (t.toWalletId === walletId) r += t.amount;
      return r;
    }
    return t.walletId === walletId ? s - t.amount : s;
  }, opening || 0);
}

export function monthSpend(tx: Transaction[], categoryId: string, month: string) {
  return tx
    .filter(t => t.type === 'expense' && t.categoryId === categoryId && t.date.slice(0, 7) === month)
    .reduce((s, t) => s + t.amount, 0);
}

export function fmt(n: number) {
  return (Math.round((n || 0) * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function formatTime(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  let hours = d.getHours();
  const minutes = d.getMinutes();
  const period = hours >= 12 ? 'م' : 'ص';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  const mm = String(minutes).padStart(2, '0');
  return `${hours}:${mm} ${period}`;
}

export function categoryLabel(c?: { name: string; icon?: string }) {
  if (!c) return '';
  return c.icon ? `${c.icon} ${c.name}` : c.name;
}

export const CATEGORY_ICONS = [
  '🚗', '🍳', '🛒', '🍔', '💡', '🏠', '👕', '💊',
  '🎓', '🎮', '✈️', '🎁', '💰', '📱', '☕', '💼',
  '🐾', '🧾', '⚡', '❓',
];
