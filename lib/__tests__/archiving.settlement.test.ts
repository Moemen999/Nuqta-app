import type { Transaction } from '@/context/DataContext';
import { archivedWalletDeltas, settlementNote, walletContribution } from '@/lib/archiving';
import { walletBalance } from '@/lib/finance';

/**
 * المحفظة المؤرشفة رصيدها صفر وهي مخفية من الإجمالي. تعديل أو حذف عملية قديمة
 * عليها بيحرّك الرصيد ده في السكوت: تعدّل مصروف قديم من 500 لـ400، فـ100 جنيه
 * "تظهر" في محفظة محدش شايفها والإجمالي ما اتغيرش. الأرقام اللي هنا هي اللي
 * بتحدد الفرق ده بيروح فين.
 */

const ARCHIVED = [{ id: 'arch', name: 'توفير' }];

function tx(p: Partial<Transaction>): Transaction {
  return { id: 'x', type: 'expense', amount: 100, walletId: 'arch', date: '2026-03-10', ...p } as Transaction;
}

describe('walletContribution — نفس قواعد walletBalance بالظبط', () => {
  it('المصروف بيقلّل', () => {
    expect(walletContribution(tx({ type: 'expense', amount: 500 }), 'arch')).toBe(-500);
  });

  it('الإيراد بيزوّد', () => {
    expect(walletContribution(tx({ type: 'income', amount: 500 }), 'arch')).toBe(500);
  });

  it('السحب: بيطلع من المصدر وبيدخل الوجهة', () => {
    const t = tx({ type: 'withdraw', amount: 200, walletId: 'arch', toWalletId: 'w2' });
    expect(walletContribution(t, 'arch')).toBe(-200);
    expect(walletContribution(t, 'w2')).toBe(200);
  });

  it('محفظة مالهاش علاقة = صفر', () => {
    expect(walletContribution(tx({ walletId: 'other' }), 'arch')).toBe(0);
  });

  it('مفيش عملية = صفر', () => {
    expect(walletContribution(undefined, 'arch')).toBe(0);
  });

  /** أهم اختبار هنا: لو الاتنين اختلفوا، التسوية هتحسب رقم غير اللي المستخدم شايفه */
  it('بتطابق walletBalance على نفس المجموعة', () => {
    const txs = [
      tx({ id: 'a', type: 'expense', amount: 300, walletId: 'arch' }),
      tx({ id: 'b', type: 'income', amount: 500, walletId: 'arch' }),
      tx({ id: 'c', type: 'withdraw', amount: 100, walletId: 'arch', toWalletId: 'w2' }),
      tx({ id: 'd', type: 'withdraw', amount: 40, walletId: 'w2', toWalletId: 'arch' }),
      tx({ id: 'e', type: 'expense', amount: 90, walletId: 'w2' }),
    ];
    const summed = txs.reduce((s, t) => s + walletContribution(t, 'arch'), 0);
    expect(summed).toBe(walletBalance(txs, 'arch', 0));
  });
});

describe('archivedWalletDeltas', () => {
  it('تعديل مصروف لأقل = المؤرشفة هتزيد (موجب)', () => {
    const before = tx({ type: 'expense', amount: 500 });
    const out = archivedWalletDeltas([{ before, after: { ...before, amount: 400 } }], ARCHIVED);
    expect(out).toEqual([{ walletId: 'arch', name: 'توفير', delta: 100 }]);
  });

  it('تعديل مصروف لأكتر = المؤرشفة هتنقص (سالب)', () => {
    const before = tx({ type: 'expense', amount: 500 });
    const out = archivedWalletDeltas([{ before, after: { ...before, amount: 600 } }], ARCHIVED);
    expect(out[0].delta).toBe(-100);
  });

  it('حذف مصروف = المؤرشفة هتزيد بالمبلغ كله', () => {
    expect(archivedWalletDeltas([{ before: tx({ type: 'expense', amount: 250 }) }], ARCHIVED)[0].delta)
      .toBe(250);
  });

  it('حذف إيراد = المؤرشفة هتنقص بالمبلغ كله', () => {
    expect(archivedWalletDeltas([{ before: tx({ type: 'income', amount: 250 }) }], ARCHIVED)[0].delta)
      .toBe(-250);
  });

  it('تحويل خارج منها: الحذف بيرجّع الفلوس لها', () => {
    const before = tx({ type: 'withdraw', amount: 300, walletId: 'arch', toWalletId: 'w2' });
    expect(archivedWalletDeltas([{ before }], ARCHIVED)[0].delta).toBe(300);
  });

  it('تحويل داخل لها: الحذف بيشيل الفلوس منها', () => {
    const before = tx({ type: 'withdraw', amount: 300, walletId: 'w2', toWalletId: 'arch' });
    expect(archivedWalletDeltas([{ before }], ARCHIVED)[0].delta).toBe(-300);
  });

  it('نقل العملية من المؤرشفة لمحفظة شغالة = المؤرشفة هتزيد', () => {
    const before = tx({ type: 'expense', amount: 400, walletId: 'arch' });
    const out = archivedWalletDeltas([{ before, after: { ...before, walletId: 'w2' } }], ARCHIVED);
    expect(out[0].delta).toBe(400);
  });

  it('تغيير النوع من مصروف لإيراد بيتحسب صح', () => {
    const before = tx({ type: 'expense', amount: 100 });
    const out = archivedWalletDeltas([{ before, after: { ...before, type: 'income' } }], ARCHIVED);
    expect(out[0].delta).toBe(200);
  });

  it('مفيش تغيير = مفيش تسوية', () => {
    const before = tx({ type: 'expense', amount: 500 });
    expect(archivedWalletDeltas([{ before, after: { ...before } }], ARCHIVED)).toEqual([]);
  });

  it('عملية على محفظة شغالة مبتعملش تسوية', () => {
    const before = tx({ type: 'expense', amount: 500, walletId: 'w2' });
    expect(archivedWalletDeltas([{ before }], ARCHIVED)).toEqual([]);
  });

  it('مفيش محافظ مؤرشفة خالص = مفيش تسوية', () => {
    expect(archivedWalletDeltas([{ before: tx({}) }], [])).toEqual([]);
  });

  it('كذا محفظة مؤرشفة بتتحسب كل واحدة لوحدها', () => {
    const archived = [{ id: 'a1', name: 'أ' }, { id: 'a2', name: 'ب' }];
    const out = archivedWalletDeltas([
      { before: tx({ type: 'expense', amount: 100, walletId: 'a1' }) },
      { before: tx({ type: 'income', amount: 70, walletId: 'a2' }) },
    ], archived);
    expect(out).toEqual([
      { walletId: 'a1', name: 'أ', delta: 100 },
      { walletId: 'a2', name: 'ب', delta: -70 },
    ]);
  });

  it('كذا تغيير على نفس المحفظة بيتجمعوا في تسوية واحدة', () => {
    const out = archivedWalletDeltas([
      { before: tx({ id: 'a', type: 'expense', amount: 100 }) },
      { before: tx({ id: 'b', type: 'expense', amount: 50 }) },
      { before: tx({ id: 'c', type: 'income', amount: 30 }) },
    ], ARCHIVED);
    expect(out).toHaveLength(1);
    expect(out[0].delta).toBe(120);
  });

  it('تغييرات بتلغي بعضها = مفيش تسوية', () => {
    const out = archivedWalletDeltas([
      { before: tx({ id: 'a', type: 'expense', amount: 100 }) },
      { before: tx({ id: 'b', type: 'income', amount: 100 }) },
    ], ARCHIVED);
    expect(out).toEqual([]);
  });

  it('كسر تايه من جمع الفواصل مبيعملش تسوية وهمية', () => {
    const before = tx({ type: 'expense', amount: 0.1 + 0.2 });
    const out = archivedWalletDeltas([{ before, after: { ...before, amount: 0.3 } }], ARCHIVED);
    expect(out).toEqual([]);
  });

  it('قرش واحد حقيقي بيعمل تسوية', () => {
    const before = tx({ type: 'expense', amount: 500 });
    expect(archivedWalletDeltas([{ before, after: { ...before, amount: 499.99 } }], ARCHIVED)[0].delta)
      .toBe(0.01);
  });

  /** حذف تحويل التسوية نفسه بيرجّع المؤرشفة لبره الصفر، فمحتاج تسوية جديدة */
  it('حذف تحويل تسوية قديم بيحتاج تسوية جديدة بالعكس', () => {
    const settlement = tx({ type: 'withdraw', amount: 100, walletId: 'arch', toWalletId: 'w2' });
    expect(archivedWalletDeltas([{ before: settlement }], ARCHIVED)[0].delta).toBe(100);
  });
});

describe('الرصيد بيرجع صفر بعد التسوية', () => {
  /** بنحاكي الدفعة: التغيير + تحويل التسوية، وبنتأكد الرصيد رجع صفر بالظبط */
  function applyWithSettlement(existing: Transaction[], change: { before: Transaction; after?: Transaction }) {
    const deltas = archivedWalletDeltas([change], ARCHIVED);
    let next = existing.filter(t => t.id !== change.before.id);
    if (change.after) next = [...next, change.after];
    deltas.forEach(d => {
      next = [...next, tx({
        id: `settle-${d.walletId}`,
        type: 'withdraw',
        amount: Math.abs(d.delta),
        walletId: d.delta > 0 ? d.walletId : 'w2',
        toWalletId: d.delta > 0 ? 'w2' : d.walletId,
      })];
    });
    return next;
  }

  it('تعديل لأقل: الرصيد صفر بعد التسوية', () => {
    const before = tx({ id: 't1', type: 'expense', amount: 500, walletId: 'arch' });
    const existing = [tx({ id: 't0', type: 'income', amount: 500, walletId: 'arch' }), before];
    expect(walletBalance(existing, 'arch', 0)).toBe(0);

    const after = { ...before, amount: 400 };
    const next = applyWithSettlement(existing, { before, after });
    expect(walletBalance(next, 'arch', 0)).toBe(0);
  });

  it('تعديل لأكتر: الرصيد صفر بعد التسوية', () => {
    const before = tx({ id: 't1', type: 'expense', amount: 500, walletId: 'arch' });
    const existing = [tx({ id: 't0', type: 'income', amount: 500, walletId: 'arch' }), before];
    const next = applyWithSettlement(existing, { before, after: { ...before, amount: 600 } });
    expect(walletBalance(next, 'arch', 0)).toBe(0);
  });

  it('حذف: الرصيد صفر بعد التسوية', () => {
    const before = tx({ id: 't1', type: 'expense', amount: 500, walletId: 'arch' });
    const existing = [tx({ id: 't0', type: 'income', amount: 500, walletId: 'arch' }), before];
    const next = applyWithSettlement(existing, { before });
    expect(walletBalance(next, 'arch', 0)).toBe(0);
  });

  it('الفلوس مش بتضيع: اللي خرج من المؤرشفة دخل الشغالة', () => {
    const before = tx({ id: 't1', type: 'expense', amount: 500, walletId: 'arch' });
    const existing = [tx({ id: 't0', type: 'income', amount: 500, walletId: 'arch' }), before];
    const next = applyWithSettlement(existing, { before, after: { ...before, amount: 400 } });
    expect(walletBalance(next, 'w2', 0)).toBe(100);
  });
});

describe('settlementNote', () => {
  it('بتقول اسم المحفظة وإنها مؤرشفة', () => {
    expect(settlementNote('توفير')).toBe('تسوية رصيد توفير (مؤرشفة)');
  });
});
