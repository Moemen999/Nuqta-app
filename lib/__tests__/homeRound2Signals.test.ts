import { readFileSync } from 'fs';
import { join } from 'path';
import { coldSnapshotToShow, COLD_CACHE_VERSION, type ColdSnapshot } from '@/lib/coldCache';
import { loadErrorsAfterSnapshot } from '@/lib/listenerErrors';
import { pendingFigureSources } from '@/lib/staleFigures';

/**
 * مراجعة التطبيق كله، الميزة 7 — الجولة الأخيرة (money-reviewer + silent-failure-hunter، المشكّك أكّد):
 *
 * H1-A: listener العمليات بيرمي snapshot من الكاش (`fromCache: true`) في حالتين الأرقام فيهم غلط: كتابة محلية لسه
 * بترفع (مستند واحد بس) أو العميل بقى Offline (الكاش في الذاكرة فاضي في الفتحة الباردة). الاتنين كانوا بيشيلوا
 * 'transactions' من `figuresPending` فالرئيسية كانت بتعرض الرصيد الافتتاحي (أو 0) على إنه الرصيد. دلوقتي العمليات
 * «وصلت» بس بعد snapshot من السيرفر مرة في الجلسة.
 *
 * H1-B: listener وقع، و«جرّب تاني» فتحه من غير نت ← snapshot من الكاش كان بيتحسب «رجع» و«بياناتك وصلت» بتتقال كدب.
 */
describe('pendingFigureSources — العمليات «وصلت» بس بعد ما السيرفر رد مرة', () => {
  it.each([
    // [محافظ fromCache، عمليات fromCache، العمليات اتشافت من السيرفر، المتوقع]
    [null, null, false, ['wallets', 'transactions']],
    [false, true, false, ['transactions']], // كتابة محلية أو Offline ← snapshot من الكاش مش كفاية
    [true, true, false, ['transactions']],
    [false, false, true, []],
    [true, true, true, []], // اتشافت من السيرفر وبعدين النت قطع ← الكاش في الذاكرة فيه كل حاجة (البانر «ممكن يكون قديم» بيغطيها)
    [null, true, true, ['wallets']],
  ] as const)('محافظ=%s عمليات=%s اتشافت=%s ← %j', (w, t, seen, expected) => {
    expect(pendingFigureSources({ wallets: w, transactions: t }, seen)).toEqual(expected);
  });
});

describe('loadErrorsAfterSnapshot — الرجوع بعد الفشل محتاج السيرفر', () => {
  it('listener كان واقع وجاله snapshot من الكاش ← لسه واقع (نفس المصفوفة)', () => {
    const prev = ['debts', 'transactions'] as const;
    expect(loadErrorsAfterSnapshot([...prev], 'transactions', true)).toEqual(['debts', 'transactions']);
  });
  it('كان واقع وجاله من السيرفر ← اتشال', () => {
    expect(loadErrorsAfterSnapshot(['debts', 'transactions'], 'transactions', false)).toEqual(['debts']);
  });
  it('مكانش واقع ← نفس المصفوفة بالظبط (مفيش render زيادة)', () => {
    const prev: ('debts')[] = ['debts'];
    expect(loadErrorsAfterSnapshot(prev, 'wallets', true)).toBe(prev);
    expect(loadErrorsAfterSnapshot(prev, 'wallets', false)).toBe(prev);
  });
});

describe('coldSnapshotToShow — الكاش بيفضل لحد ما العمليات توصل من السيرفر', () => {
  const stored: ColdSnapshot = { v: COLD_CACHE_VERSION, uid: 'u1', savedAt: 1, wallets: [{ id: 'w1', name: 'كاش', balance: 10 }], recent: [], categories: [] };
  const base = { stored, figuresFromServer: false, walletsCount: 1, txNotYet: true, txCount: 0 };
  it('العمليات لسه ما وصلتش من السيرفر ← الكاش، حتى لو فيه عملية محلية لسه بترفع (مش رصيد افتتاحي + عملية)', () => {
    expect(coldSnapshotToShow(base)).toBe(stored);
    expect(coldSnapshotToShow({ ...base, txCount: 1 })).toBe(stored);
  });
  it('العمليات وصلت من السيرفر ← مفيش كاش', () => {
    expect(coldSnapshotToShow({ ...base, txNotYet: false })).toBeNull();
    expect(coldSnapshotToShow({ ...base, figuresFromServer: true })).toBeNull();
  });
  it('مفيش محافظ لسه ومفيش عمليات ← الكاش؛ مفيش محافظ بس فيه عمليات حقيقية من السيرفر ← لأ', () => {
    expect(coldSnapshotToShow({ ...base, walletsCount: 0, txNotYet: false })).toBe(stored);
    expect(coldSnapshotToShow({ ...base, walletsCount: 0, txNotYet: false, txCount: 2 })).toBeNull();
  });
  it('كاش من غير محافظ أو مفيش كاش ← null', () => {
    expect(coldSnapshotToShow({ ...base, stored: { ...stored, wallets: [] } })).toBeNull();
    expect(coldSnapshotToShow({ ...base, stored: null })).toBeNull();
  });
});

describe('التوصيل في DataContext', () => {
  const src = readFileSync(join(__dirname, '..', '..', 'context', 'DataContext.tsx'), 'utf8');
  it('كل listener بيبعت fromCache لـloaded (الرجوع بعد الفشل بالسيرفر بس)', () => {
    const calls = src.match(/loaded\('[a-z_]+'[^)]*\)/g) ?? [];
    expect(calls.length).toBe(10);
    calls.forEach(c => expect(c).toMatch(/, snap\.metadata\.fromCache\)$/));
  });
  it('figuresPending من pendingFigureSources، والكاش من coldSnapshotToShow', () => {
    expect(src).toMatch(/pendingFigureSources\(figuresCache\.current, txServerSeen\.current\)/);
    expect(src).toMatch(/coldSnapshotToShow\(\{/);
  });
  it('مسح الكاش من الجهاز بيمسح المعروض كمان', () => {
    expect(src).toMatch(/removeItem\(coldCacheKey\(uid\)\)[\s\S]{0,40}setStoredCold\(null\)|setStoredCold\(null\);[\s\S]{0,200}removeItem\(coldCacheKey\(uid\)\)/);
  });
});
