import type { Debt, Transaction } from '@/context/DataContext';

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

export function currentMonth() {
  return todayStr().slice(0, 7);
}

export function daysUntil(dateStr: string) {
  const today = new Date(todayStr());
  const target = new Date(dateStr);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

export function addDays(dateStr: string, days: number) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function startOfMonth(dateStr: string) {
  return dateStr.slice(0, 7) + '-01';
}

export function endOfMonth(dateStr: string) {
  const d = new Date(dateStr);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return end.toISOString().slice(0, 10);
}

export const PALETTE = ['#7FA98F', '#C9A961', '#7C93C9', '#C97C9B', '#9B7CC9', '#C98F5A', '#6FB3B8', '#B08FC9'];

export function hashColor(str: string) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return PALETTE[Math.abs(h) % PALETTE.length];
}

export const TYPE_LABELS: Record<string, { label: string; color: string; sign: string }> = {
  expense: { label: 'مصروف', color: '#D97878', sign: '-' },
  income: { label: 'إيراد', color: '#7FA98F', sign: '+' },
  withdraw: { label: 'سحب', color: '#C9A961', sign: '-' },
};

export function debtGrandTotal(d: Debt) {
  return d.totalAmount + (d.increases || []).reduce((s, e) => s + e.amount, 0);
}

export function debtPaid(d: Debt) {
  return d.payments.reduce((s, p) => s + p.amount, 0);
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
