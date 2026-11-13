import { debtOwnWalletId, defaultWalletId, lastTransferToWalletId, lastUsedWalletId } from '@/lib/defaultWallet';

const W = (id: string, archived = false) => ({ id, name: id, openingBalance: 0, lowAlert: 0, ...(archived ? { archived: true } : {}) });
type Tx = Parameters<typeof lastUsedWalletId>[0][number];
let n = 0;
const tx = (walletId: string, createdAt: string | undefined, extra: Partial<Tx> = {}): Tx => ({
  id: `t${++n}`, type: 'expense', amount: 10, walletId, date: '2026-11-01', ...(createdAt === undefined ? {} : { createdAt }), ...extra,
} as Tx);

const A = W('A'), B = W('B'), C = W('C'), D = W('D');
const ids = ['A', 'B', 'C', 'D'];

describe('lastUsedWalletId', () => {
  it('الأحدث يكسب: مصروف يدوي على B بعد A ← B', () => {
    expect(lastUsedWalletId([tx('A', '2026-11-01T10:00:00.000Z'), tx('B', '2026-11-02T10:00:00.000Z')], ids)).toBe('B');
  });
  it('الترتيب في المصفوفة مش هو اللي بيحدد — createdAt بس', () => {
    expect(lastUsedWalletId([tx('B', '2026-11-02T10:00:00.000Z'), tx('A', '2026-11-01T10:00:00.000Z')], ids)).toBe('B');
  });
  it('الأحدث اتسجلت لوحدها ← بتتخطى', () => {
    expect(lastUsedWalletId([tx('A', '2026-11-01T10:00:00.000Z'), tx('B', '2026-11-02T10:00:00.000Z', { autoRecorded: true })], ids)).toBe('A');
  });
  it('تسوية ← بتتخطى', () => {
    expect(lastUsedWalletId([tx('A', '2026-11-01T10:00:00.000Z'), tx('B', '2026-11-02T10:00:00.000Z', { isSettlement: true })], ids)).toBe('A');
  });
  it('سحب (تحويل) ← بيتخطى، حتى لو الأحدث', () => {
    expect(lastUsedWalletId([tx('A', '2026-11-01T10:00:00.000Z'), tx('B', '2026-11-02T10:00:00.000Z', { type: 'withdraw', toWalletId: 'C' })], ids)).toBe('A');
  });
  it('من غير createdAt (أو مش نص / مش تاريخ) ← بيتجاهل', () => {
    expect(lastUsedWalletId([
      tx('A', '2026-11-01T10:00:00.000Z'), tx('B', undefined),
      tx('C', 'zzz-not-a-date'), tx('D', 12345 as unknown as string),
    ], ids)).toBe('A');
  });
  it('الإيراد بيتحسب زي المصروف', () => {
    expect(lastUsedWalletId([tx('A', '2026-11-01T10:00:00.000Z'), tx('B', '2026-11-02T10:00:00.000Z', { type: 'income' })], ids)).toBe('B');
  });
  it('التعادل في createdAt ← الأكبر معرّفًا، ومش بيتأثر بالترتيب', () => {
    const t1 = tx('A', '2026-11-02T10:00:00.000Z', { id: 'a1' });
    const t2 = tx('B', '2026-11-02T10:00:00.000Z', { id: 'b1' });
    expect(lastUsedWalletId([t1, t2], ids)).toBe('B');
    expect(lastUsedWalletId([t2, t1], ids)).toBe('B');
  });
  it('المحفظة المتذكّرة مؤرشفة ← اللي بعدها في الأحدث وهي شغّالة', () => {
    const active = ['A', 'C'];
    expect(lastUsedWalletId([
      tx('A', '2026-11-01T10:00:00.000Z'), tx('C', '2026-11-02T10:00:00.000Z'), tx('B', '2026-11-03T10:00:00.000Z'),
    ], active)).toBe('C');
  });
  it('مفيش عملية صالحة ← undefined', () => {
    expect(lastUsedWalletId([], ids)).toBeUndefined();
    expect(lastUsedWalletId([tx('Z', '2026-11-01T10:00:00.000Z')], ids)).toBeUndefined();
  });
  it('createdAt في المستقبل البعيد (ساعة جهاز غلط) ← بيتجاهل لو اتدّى now', () => {
    const now = Date.parse('2026-11-13T00:00:00.000Z');
    expect(lastUsedWalletId([tx('A', '2026-11-01T10:00:00.000Z'), tx('B', '2030-01-01T00:00:00.000Z')], ids, now)).toBe('A');
    // من غير now: مفيش حكم على الساعة
    expect(lastUsedWalletId([tx('A', '2026-11-01T10:00:00.000Z'), tx('B', '2030-01-01T00:00:00.000Z')], ids)).toBe('B');
  });
});

describe('lastTransferToWalletId', () => {
  const wd = (to: string, createdAt: string, extra: Partial<Tx> = {}) => tx('A', createdAt, { type: 'withdraw', toWalletId: to, ...extra });
  it('آخر تحويل راح لـD ≠ from ← D', () => {
    expect(lastTransferToWalletId([wd('C', '2026-11-01T10:00:00.000Z'), wd('D', '2026-11-02T10:00:00.000Z')], ids, 'A')).toBe('D');
  });
  it('الوجهة = from ← أول محفظة شغالة ≠ from', () => {
    expect(lastTransferToWalletId([wd('A', '2026-11-02T10:00:00.000Z')], ids, 'A')).toBe('B');
  });
  it('الوجهة مؤرشفة ← أول شغّالة ≠ from', () => {
    expect(lastTransferToWalletId([wd('D', '2026-11-02T10:00:00.000Z')], ['A', 'B'], 'A')).toBe('B');
  });
  it('تسوية واللي اتسجل لوحده مش بيتحسبوا', () => {
    expect(lastTransferToWalletId([
      wd('C', '2026-11-01T10:00:00.000Z'), wd('D', '2026-11-02T10:00:00.000Z', { isSettlement: true }),
    ], ids, 'A')).toBe('C');
  });
  it('محفظة واحدة بس ← undefined', () => {
    expect(lastTransferToWalletId([], ['A'], 'A')).toBeUndefined();
  });
  it('from مش معروف ← أول شغّالة', () => {
    expect(lastTransferToWalletId([], ids, undefined)).toBe('A');
  });
  it('مفيش محافظ ← undefined', () => {
    expect(lastTransferToWalletId([], [], undefined)).toBeUndefined();
  });
});

describe('debtOwnWalletId', () => {
  const base = { payments: [], increases: [] };
  it('initialWalletId شغّالة ← هي، حتى لو آخر عملية على غيرها', () => {
    expect(debtOwnWalletId({ ...base, initialWalletId: 'B', payments: [{ date: '2026-11-05', walletId: 'A' }] }, ids)).toBe('B');
  });
  it('initialWalletId مؤرشفة ← آخر دفعة على محفظة شغّالة', () => {
    expect(debtOwnWalletId({ ...base, initialWalletId: 'Z', payments: [{ date: '2026-11-01', walletId: 'A' }, { date: '2026-11-05', walletId: 'C' }] }, ids)).toBe('C');
  });
  it('شرا بالأجل (من غير initialWalletId ولا حركات) ← undefined', () => {
    expect(debtOwnWalletId(base, ids)).toBeUndefined();
  });
  it('الأحدث بالتاريخ بغض النظر عن الترتيب، والتعادل ← الأحدث ترتيبًا', () => {
    expect(debtOwnWalletId({ ...base, payments: [{ date: '2026-11-05', walletId: 'A' }, { date: '2026-11-01', walletId: 'B' }] }, ids)).toBe('A');
    expect(debtOwnWalletId({ ...base, payments: [{ date: '2026-11-05', walletId: 'A' }, { date: '2026-11-05', walletId: 'B' }] }, ids)).toBe('B');
  });
  it('الزيادات بتتحسب (walletId اختياري ومتجاهل لو ناقص)', () => {
    expect(debtOwnWalletId({ ...base, payments: [{ date: '2026-11-01', walletId: 'A' }], increases: [{ date: '2026-11-09', walletId: 'D' }, { date: '2026-11-10' }] }, ids)).toBe('D');
  });
  it('كل المحافظ اللي على الدين مؤرشفة ← undefined', () => {
    expect(debtOwnWalletId({ ...base, initialWalletId: 'Z', payments: [{ date: '2026-11-01', walletId: 'Y' }] }, ids)).toBeUndefined();
  });
  it('الأرشفة بتتحسب من activeIds مش من الدين', () => {
    expect(debtOwnWalletId({ ...base, initialWalletId: 'B' }, ['A'])).toBeUndefined();
  });
});

describe('defaultWalletId', () => {
  it('آخر محفظة اتستخدمت', () => {
    expect(defaultWalletId({ wallets: [A, B, C], transactions: [tx('A', '2026-11-01T10:00:00.000Z'), tx('B', '2026-11-02T10:00:00.000Z')] })).toBe('B');
  });
  it('المتذكّرة مؤرشفة ← الأحدث بعدها وهي شغّالة', () => {
    expect(defaultWalletId({
      wallets: [A, W('B', true), C],
      transactions: [tx('C', '2026-11-01T10:00:00.000Z'), tx('B', '2026-11-02T10:00:00.000Z')],
    })).toBe('C');
  });
  it('مفيش عملية صالحة ← أول شغّالة بترتيب القايمة (مش المؤرشفة)', () => {
    expect(defaultWalletId({ wallets: [W('A', true), B, C], transactions: [] })).toBe('B');
    expect(defaultWalletId({ wallets: [A, B], transactions: [tx('A', undefined, { autoRecorded: true })] })).toBe('A');
  });
  it('حساب جديد (محافظ ومفيش عمليات) ← أول شغّالة', () => {
    expect(defaultWalletId({ wallets: [A, B], transactions: [] })).toBe('A');
  });
  it('كل المحافظ مؤرشفة ← undefined، حتى لو فيه عمليات عليها', () => {
    expect(defaultWalletId({ wallets: [W('A', true)], transactions: [tx('A', '2026-11-01T10:00:00.000Z')] })).toBeUndefined();
    expect(defaultWalletId({ wallets: [], transactions: [] })).toBeUndefined();
  });
  it('دين: initialWalletId=B وآخر عملية يدوية على A ← B', () => {
    expect(defaultWalletId({
      wallets: [A, B, C], transactions: [tx('A', '2026-11-02T10:00:00.000Z')],
      debt: { initialWalletId: 'B', payments: [], increases: [] },
    })).toBe('B');
  });
  it('دين: initialWalletId مؤرشفة ودفعة على C ← C', () => {
    expect(defaultWalletId({
      wallets: [A, W('B', true), C], transactions: [tx('A', '2026-11-02T10:00:00.000Z')],
      debt: { initialWalletId: 'B', payments: [{ date: '2026-11-03', walletId: 'C' }], increases: [] },
    })).toBe('C');
  });
  it('دين: شرا بالأجل من غير حركات ← آخر محفظة اتستخدمت', () => {
    expect(defaultWalletId({
      wallets: [A, B], transactions: [tx('B', '2026-11-02T10:00:00.000Z')],
      debt: { payments: [], increases: [] },
    })).toBe('B');
  });
  it('مش بيرجّع مؤرشفة أبدًا (فحص شامل على تركيبات)', () => {
    const wallets = [W('A', true), W('B', true), C];
    const out = defaultWalletId({
      wallets, transactions: [tx('A', '2026-11-05T10:00:00.000Z'), tx('B', '2026-11-04T10:00:00.000Z')],
      debt: { initialWalletId: 'A', payments: [{ date: '2026-11-01', walletId: 'B' }], increases: [] },
    });
    expect(out).toBe('C');
  });
});
