import type { Transaction, Wallet } from '@/context/DataContext';
import { projectBalances } from '@/lib/finance';

/**
 * الرصيد المتوقّع قبل الحفظ.
 *
 * روبو كتب عشرات الآلاف في مصروف فطار والتطبيق قبلها في صمت. مفيش سقف صح
 * نحطه — التطبيق مش عارف المستخدم بيصرف قد إيه — فبدل ما نخترع رقم، بنخلي
 * الرقم مقروء: تشوف رصيدك رايح فين قبل ما تحفظ.
 */

const wallets: Wallet[] = [
  { id: 'w1', name: 'CASH', openingBalance: 1000, lowAlert: 100 },
  { id: 'w2', name: 'NBE', openingBalance: 5000, lowAlert: 500 },
];

function tx(t: Partial<Transaction> & Pick<Transaction, 'type' | 'amount'>): Transaction {
  return { id: 't' + Math.random().toString(36).slice(2), walletId: 'w1', date: '2026-03-10', ...t } as Transaction;
}

describe('projectBalances — مصروف وإيراد', () => {
  it('المصروف بينقّص المحفظة', () => {
    const out = projectBalances({ transactions: [], wallets, type: 'expense', amount: 300, walletId: 'w1' });
    expect(out).toEqual([{ walletId: 'w1', name: 'CASH', before: 1000, after: 700 }]);
  });

  it('الإيراد بيزوّد المحفظة', () => {
    const out = projectBalances({ transactions: [], wallets, type: 'income', amount: 300, walletId: 'w1' });
    expect(out[0].after).toBe(1300);
  });

  it('بيحسب من العمليات الموجودة مش من الرصيد الافتتاحي بس', () => {
    const txs = [tx({ type: 'expense', amount: 400 })];
    const out = projectBalances({ transactions: txs, wallets, type: 'expense', amount: 100, walletId: 'w1' });
    expect(out[0]).toMatchObject({ before: 600, after: 500 });
  });

  it('غلطة الحجم بتبان في الرقم نفسه', () => {
    // 50000 بدل 500
    const out = projectBalances({ transactions: [], wallets, type: 'expense', amount: 50000, walletId: 'w1' });
    expect(out[0].after).toBe(-49000);
  });
});

describe('projectBalances — التحويل بيلمس محفظتين', () => {
  it('بيرجّع الطرفين: المصدر ناقص والوجهة زايد', () => {
    const out = projectBalances({
      transactions: [], wallets, type: 'withdraw', amount: 300, walletId: 'w1', toWalletId: 'w2',
    });
    expect(out).toEqual([
      { walletId: 'w1', name: 'CASH', before: 1000, after: 700 },
      { walletId: 'w2', name: 'NBE', before: 5000, after: 5300 },
    ]);
  });

  it('إجمالي الفلوس مابيتغيرش في التحويل', () => {
    const out = projectBalances({
      transactions: [], wallets, type: 'withdraw', amount: 300, walletId: 'w1', toWalletId: 'w2',
    });
    const beforeSum = out.reduce((s, p) => s + p.before, 0);
    const afterSum = out.reduce((s, p) => s + p.after, 0);
    expect(afterSum).toBe(beforeSum);
  });

  it('من غير محفظة وجهة بيرجّع المصدر بس', () => {
    const out = projectBalances({ transactions: [], wallets, type: 'withdraw', amount: 300, walletId: 'w1' });
    expect(out).toHaveLength(1);
  });

  it('نفس المحفظة للطرفين مبتتعرضش مرتين', () => {
    const out = projectBalances({
      transactions: [], wallets, type: 'withdraw', amount: 300, walletId: 'w1', toWalletId: 'w1',
    });
    expect(out).toHaveLength(1);
  });
});

describe('projectBalances — التعديل مبيتحسبش مرتين', () => {
  it('تعديل مصروف 500 لـ 600 بيعرض 600 خارجة مش 1,100', () => {
    const existing = tx({ id: 'edit-me', type: 'expense', amount: 500 });
    const out = projectBalances({
      transactions: [existing], wallets, type: 'expense', amount: 600,
      walletId: 'w1', excludeTransactionId: 'edit-me',
    });
    // الرصيد من غير العملية اللي بنعدّلها = 1000، وبعد 600 = 400
    expect(out[0]).toMatchObject({ before: 1000, after: 400 });
  });

  it('من غير الاستثناء الرقم بيطلع غلط بشكل شكله معقول', () => {
    const existing = tx({ id: 'edit-me', type: 'expense', amount: 500 });
    const out = projectBalances({
      transactions: [existing], wallets, type: 'expense', amount: 600, walletId: 'w1',
    });
    // ده السلوك الغلط اللي الاستثناء بيمنعه — موجود هنا عشان الفرق يفضل مثبّت
    expect(out[0].after).toBe(-100);
  });
});

describe('projectBalances — مفيش حاجة نقولها', () => {
  it('من غير محفظة بترجّع فاضي', () => {
    expect(projectBalances({ transactions: [], wallets, type: 'expense', amount: 300 })).toEqual([]);
  });

  it('محفظة مش موجودة بترجّع فاضي', () => {
    expect(projectBalances({ transactions: [], wallets, type: 'expense', amount: 300, walletId: 'nope' })).toEqual([]);
  });

  it('مبلغ فاضي أو صفر أو سالب بيرجّع فاضي', () => {
    const base = { transactions: [], wallets, type: 'expense' as const, walletId: 'w1' };
    expect(projectBalances({ ...base, amount: 0 })).toEqual([]);
    expect(projectBalances({ ...base, amount: -5 })).toEqual([]);
    expect(projectBalances({ ...base, amount: NaN })).toEqual([]);
  });
});
