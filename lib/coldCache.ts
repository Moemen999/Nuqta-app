import type { Category, Transaction, Wallet } from '@/context/DataContext';
import { walletBalance } from '@/lib/finance';

/**
 * كاش أول فتحة باردة — التصميم وسببه في `reports/2026-11-02-cold-cache-design.md`.
 *
 * **عرض بس.** الناتج ده عمره ما يدخل `wallets`/`transactions` بتوع `DataContext`: الكتابات والحراسات
 * (آخر محفظة شغالة، المؤرشفة، التسوية، الذرات) بتقرا من الـlisteners، ورقم قديم هناك = كتابة غلط.
 *
 * **الحد الأدنى (قرار مؤمن 2026-11-02):** المحافظ الشغالة برصيدها المحسوب، وآخر عمليات، وفئاتهم —
 * **من غير `note` خالص** (نوتات الدين فيها اسم الشخص، ونوتات المستخدم ممكن يبقى فيها أسامي)، ومن غير
 * ديون ولا اشتراكات ولا جمعيات ولا دخل. نوع العملية المربوطة بيتحفظ (`kind`) من غير اسمها.
 * **من غير تشفير** (AsyncStorage) بقرار مؤمن على `reports/2026-11-02-cold-cache-encryption.md`.
 */
export const COLD_CACHE_VERSION = 1;
/** نفس عدد "آخر العمليات" في الرئيسية (`app/(tabs)/index.tsx`) */
export const COLD_CACHE_RECENT = 10;
export const COLD_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** الكتابة بعد هدوء ثانيتين — مش مع كل snapshot */
export const COLD_CACHE_WRITE_DELAY_MS = 2000;

export type ColdTxKind = 'debt' | 'subscription' | 'gamiya' | 'income' | 'settlement';
export type ColdWallet = { id: string; name: string; balance: number };
export type ColdTransaction = {
  id: string; type: Transaction['type']; amount: number; walletId: string; date: string;
  toWalletId?: string; categoryId?: string; createdAt?: string; kind?: ColdTxKind;
};
export type ColdCategory = { id: string; name: string; icon?: string };
export type ColdSnapshot = {
  v: typeof COLD_CACHE_VERSION; uid: string; savedAt: number;
  wallets: ColdWallet[]; recent: ColdTransaction[]; categories: ColdCategory[];
};

export const coldCacheKey = (uid: string) => `nuqta-cold-cache:${uid}`;

/** نفس ترتيب "آخر العمليات" في الرئيسية: التاريخ الأحدث، وبعدين createdAt */
function newestFirst(a: Transaction, b: Transaction) {
  const byDate = b.date.localeCompare(a.date);
  return byDate !== 0 ? byDate : (b.createdAt || '').localeCompare(a.createdAt || '');
}

function kindOf(t: Transaction, debtTransactionIds: ReadonlySet<string>): ColdTxKind | undefined {
  if (debtTransactionIds.has(t.id)) return 'debt';
  if (t.subscriptionId) return 'subscription';
  if (t.gamiyaId) return 'gamiya';
  if (t.incomeId) return 'income';
  if (t.isSettlement) return 'settlement';
  return undefined;
}

export function buildColdSnapshot(input: {
  uid: string; wallets: Wallet[]; categories: Category[]; transactions: Transaction[];
  /** معرّفات العمليات المربوطة بدين (الربط متخزّن في الدين مش في العملية) */
  debtTransactionIds: ReadonlySet<string>; now: number;
}): ColdSnapshot {
  const { uid, wallets, categories, transactions, debtTransactionIds, now } = input;
  const recent = [...transactions].sort(newestFirst).slice(0, COLD_CACHE_RECENT).map(t => {
    // الحقول بالاسم — مش `...t`: أي حقل يتضاف للعملية بعدين ميتسرّبش للكاش من غير قرار
    const r: ColdTransaction = { id: t.id, type: t.type, amount: t.amount, walletId: t.walletId, date: t.date };
    if (t.toWalletId) r.toWalletId = t.toWalletId;
    if (t.categoryId) r.categoryId = t.categoryId;
    if (t.createdAt) r.createdAt = t.createdAt;
    const kind = kindOf(t, debtTransactionIds);
    if (kind) r.kind = kind;
    return r;
  });
  const usedCats = new Set(recent.map(r => r.categoryId).filter(Boolean));
  return {
    v: COLD_CACHE_VERSION, uid, savedAt: now,
    wallets: wallets.filter(w => !w.archived).map(w => ({ id: w.id, name: w.name, balance: walletBalance(transactions, w.id, w.openingBalance) })),
    recent,
    categories: categories.filter(c => usedCats.has(c.id)).map(c => (c.icon ? { id: c.id, name: c.name, icon: c.icon } : { id: c.id, name: c.name })),
  };
}

const isStr = (x: unknown): x is string => typeof x === 'string';
const isMoney = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const TYPES = new Set(['expense', 'income', 'withdraw']);

/**
 * القراية بترفض أي حاجة مش متأكدة منها (← `null` = الشاشة الفاضية العادية): حساب تاني، نسخة تانية،
 * أقدم من 30 يوم، أو `savedAt` في المستقبل (ساعة الموبايل اترجعت — منعرفش عمره الحقيقي)، أو أي رقم مش رقم.
 * أرقام فلوس غلط على الشاشة أوحش من شاشة فاضية بتقول "النت".
 */
export function parseColdSnapshot(raw: string | null, uid: string, now: number): ColdSnapshot | null {
  if (!raw) return null;
  let s: any;
  try { s = JSON.parse(raw); } catch { return null; }
  if (!s || typeof s !== 'object' || s.v !== COLD_CACHE_VERSION || s.uid !== uid) return null;
  if (!isMoney(s.savedAt) || s.savedAt > now || now - s.savedAt > COLD_CACHE_MAX_AGE_MS) return null;
  if (!Array.isArray(s.wallets) || !Array.isArray(s.recent) || !Array.isArray(s.categories)) return null;
  if (!s.wallets.every((w: any) => w && isStr(w.id) && isStr(w.name) && isMoney(w.balance))) return null;
  if (!s.recent.every((t: any) => t && isStr(t.id) && TYPES.has(t.type) && isMoney(t.amount) && t.amount >= 0
    && isStr(t.walletId) && isStr(t.date))) return null;
  if (!s.categories.every((c: any) => c && isStr(c.id) && isStr(c.name))) return null;
  return s as ColdSnapshot;
}
