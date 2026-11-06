jest.mock('@sentry/react-native', () => ({ captureMessage: jest.fn() }));
import * as Sentry from '@sentry/react-native';
import { isValidDateStr, resetBadShapeReports, splitTransactions, transactionFromDoc, walletFromDoc } from '@/lib/fromDoc';
import { brokenFixBlock, brokenTransactionsBannerText } from '@/lib/brokenDocs';

/** بند B — قرار مؤمن 2026-11-06: العملية البايظة متعلّمة وبرّه الحسابات، مش صفر ومش متشالة */

beforeEach(() => { resetBadShapeReports(); (Sentry.captureMessage as jest.Mock).mockClear(); });

const ok = { type: 'expense', amount: 100, walletId: 'w1', date: '2026-09-01' };

it('سليمة ← في الحسابات زي ما هي (والمعرّف من المسار)', () => {
  const r = transactionFromDoc<{ id: string; amount: number }>('t1', { ...ok, id: 'fake' });
  expect(r.ok && r.tx).toMatchObject({ id: 't1', amount: 100 });
});

it('مبلغ صفر أو بالسالب مش بايظ (مش عارفين إنه غلط — الإشارة متولّعش على حالة ممكن تكون شرعية)', () => {
  expect(transactionFromDoc('t', { ...ok, amount: 0 }).ok).toBe(true);
  expect(transactionFromDoc('t', { ...ok, amount: -5 }).ok).toBe(true);
});

it.each([
  ['NaN', { amount: NaN }, ['amount']],
  ['Infinity', { amount: Infinity }, ['amount']],
  ['نص', { amount: '100' }, ['amount']],
  ['ناقص', { amount: undefined }, ['amount']],
  ['تاريخ بشكل تاني', { date: '1/9/2026' }, ['date']],
  ['شهر 13', { date: '2026-13-01' }, ['date']],
  ['نوع مش معروف', { type: 'loan' }, ['type']],
  ['مبلغ وتاريخ', { amount: NaN, date: null }, ['amount', 'date']],
])('%s ← بايظة بالسبب', (_n, patch, reasons) => {
  const r = transactionFromDoc('t', { ...ok, ...patch });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.broken.reasons).toEqual(reasons);
});

it('البايظة بتشيل اللي اتقري سليم بس، وبتتبلّغ Sentry بالسبب من غير أرقام', () => {
  const r = transactionFromDoc('t', { ...ok, amount: NaN, note: 'عشا' });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.broken).toMatchObject({ id: 't', type: 'expense', amount: undefined, date: '2026-09-01', walletId: 'w1', note: 'عشا' });
  expect(Sentry.captureMessage).toHaveBeenCalledWith('firestore doc bad shape: transactions.amount', expect.anything());
});

it('splitTransactions بيقسم من غير ما يضيّع ولا واحدة', () => {
  const docs = [{ id: 'a', data: () => ok }, { id: 'b', data: () => ({ ...ok, amount: NaN }) }, { id: 'c', data: () => ok }];
  const s = splitTransactions<{ id: string }>(docs);
  expect(s.transactions.map(t => t.id)).toEqual(['a', 'c']);
  expect(s.broken.map(t => t.id)).toEqual(['b']);
});

it('isValidDateStr', () => {
  expect(isValidDateStr('2026-11-06')).toBe(true);
  for (const v of ['2026-11-6', '2026-00-01', '2026-01-32', 20261106, '', null]) expect(isValidDateStr(v)).toBe(false);
});

it('المحفظة: رصيد بداية مش رقم ← صفر + openingInvalid؛ سليم ← من غير علامة', () => {
  const bad = walletFromDoc<{ openingBalance: number; openingInvalid?: boolean }>('w', { name: 'x', openingBalance: 'ألف', lowAlert: 0 });
  expect(bad).toMatchObject({ openingBalance: 0, openingInvalid: true });
  const good = walletFromDoc<{ openingBalance: number; openingInvalid?: boolean }>('w', { name: 'x', openingBalance: 500, lowAlert: 100 });
  expect(good.openingBalance).toBe(500);
  expect(good.openingInvalid).toBeUndefined();
});

describe('brokenFixBlock — التصليح من هنا ولا المسح بس', () => {
  const wallets = [{ id: 'w1' }, { id: 'w2' }, { id: 'old', archived: true }];
  const base = { id: 't', reasons: ['amount' as const], type: 'expense' as const, walletId: 'w1' };
  it('عادية على محفظة شغالة ← تتصلّح', () => expect(brokenFixBlock(base, null, wallets)).toBeNull());
  it('النوع مش مقروء', () => expect(brokenFixBlock({ ...base, type: undefined, reasons: ['type'] }, null, wallets)).toBe('type'));
  it('مربوطة بدين', () => expect(brokenFixBlock(base, 'debt', wallets)).toBe('linked'));
  it('معرّف دخل ثابت حتى لو الكيان مش لاقيه', () => expect(brokenFixBlock({ ...base, incomeId: 'i' }, null, wallets)).toBe('linked'));
  it('محفظة مؤرشفة أو مش موجودة', () => {
    expect(brokenFixBlock({ ...base, walletId: 'old' }, null, wallets)).toBe('wallet');
    expect(brokenFixBlock({ ...base, walletId: 'gone' }, null, wallets)).toBe('wallet');
  });
  it('تحويل وجهته مؤرشفة أو نفس المحفظة', () => {
    expect(brokenFixBlock({ ...base, type: 'withdraw', toWalletId: 'old' }, null, wallets)).toBe('wallet');
    expect(brokenFixBlock({ ...base, type: 'withdraw', toWalletId: 'w1' }, null, wallets)).toBe('wallet');
    expect(brokenFixBlock({ ...base, type: 'withdraw', toWalletId: 'w2' }, null, wallets)).toBeNull();
  });
});

it('نص البانر: العدد بالكلام والجمع بيتفق', () => {
  expect(brokenTransactionsBannerText(1)).toBe('فيه عملية واحدة بياناتها ناقصة ومش محسوبة في أي رقم.');
  expect(brokenTransactionsBannerText(2)).toBe('فيه عمليتين بياناتهم ناقصة ومش محسوبين في أي رقم.');
  expect(brokenTransactionsBannerText(5)).toBe('فيه 5 عمليات بياناتهم ناقصة ومش محسوبين في أي رقم.');
});
