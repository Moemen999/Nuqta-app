import {
  SEED_CATEGORIES, SEED_WALLETS, documentsPhrase, seedDocs, seedIncome, seedMissing, seedTransactions,
  type SeedIds, type SeedScanInput,
} from '@/scripts/seedTestAccount';

/**
 * المسح بتاع بيانات التجربة بيمسح بالاسم. الاختبارات دي بتثبّت إنه **مبيلمسش
 * أي حاجة مش من التعبئة** — لو حد شغّله بالغلط على حساب حقيقي، الضرر أقصاه
 * حاجة اسمها بالظبط "تجربة 1" أو "صاحبي أ".
 */

const ids: SeedIds = {
  wallets: { 'تجربة 1': 'sw1', 'تجربة 2': 'sw2', 'تجربة 3': 'sw3' },
  categories: Object.fromEntries(SEED_CATEGORIES.map((c, i) => [c, `sc${i}`])),
};

function scan(over: Partial<SeedScanInput> = {}): SeedScanInput {
  return {
    wallets: [
      ...SEED_WALLETS.map(w => ({ id: ids.wallets[w.name], name: w.name })),
      { id: 'real1', name: 'كاش' }, { id: 'real2', name: 'تجربة' }, { id: 'real3', name: 'تجربة 10' },
    ],
    categories: [...SEED_CATEGORIES.map(c => ({ id: ids.categories[c], name: c })), { id: 'rc', name: 'أكل' }],
    debts: [{ id: 'd1', personName: 'صاحبي أ' }, { id: 'd2', personName: 'صاحبي ب' }, { id: 'rd', personName: 'أحمد' }],
    subscriptions: [{ id: 's1', name: 'اشتراك تجربة' }, { id: 'rs', name: 'نتفليكس' }],
    gamiyas: [{ id: 'g1', name: 'جمعية تجربة' }, { id: 'rg', name: 'جمعية الشغل' }],
    incomes: [{ id: 'i1', name: 'دخل ثابت تجربة' }, { id: 'ri', name: 'المرتب' }],
    transactions: [
      { id: 't1', walletId: 'sw1' },
      { id: 't2', walletId: 'real1', toWalletId: 'sw3' },
      { id: 't3', walletId: 'real1', incomeId: 'i1' },
      { id: 'rt1', walletId: 'real1' },
      { id: 'rt2', walletId: 'real1', toWalletId: 'real2' },
      { id: 'rt3', walletId: 'real1', incomeId: 'ri' },
    ],
    budgets: { sc0: 500, rc: 1000 },
    ...over,
  };
}

describe('seedDocs — المسح', () => {
  const refs = seedDocs(scan());
  const ids_ = refs.map(r => `${r.collection}/${r.id}`);

  it('بيمسك كل حاجة التعبئة عملتها', () => {
    expect(ids_).toEqual(expect.arrayContaining([
      'wallets/sw1', 'wallets/sw2', 'wallets/sw3',
      ...SEED_CATEGORIES.map((_, i) => `categories/sc${i}`),
      'debts/d1', 'debts/d2', 'subscriptions/s1', 'gamiyas/g1', 'incomes/i1',
      'transactions/t1', 'transactions/t2', 'transactions/t3', 'budgets/sc0',
    ]));
  });

  it('مبيلمسش أي حاجة اسمها قريب بس مش مطابق، ولا أي حاجة حقيقية', () => {
    for (const real of ['wallets/real1', 'wallets/real2', 'wallets/real3', 'categories/rc', 'debts/rd',
      'subscriptions/rs', 'gamiyas/rg', 'incomes/ri', 'transactions/rt1', 'transactions/rt2', 'transactions/rt3', 'budgets/rc']) {
      expect(ids_).not.toContain(real);
    }
  });

  it('الميزانية بتتعد بس لو موجودة فعلاً', () => {
    expect(ids_.filter(x => x.startsWith('budgets/'))).toEqual(['budgets/sc0']);
  });

  it('حساب فاضي ← مفيش حاجة', () => {
    expect(seedDocs({
      wallets: [], categories: [], debts: [], subscriptions: [], gamiyas: [], incomes: [], transactions: [], budgets: {},
    })).toEqual([]);
  });

  it('الفرعيين (العمليات) قبل المحافظ في الترتيب', () => {
    expect(ids_.indexOf('transactions/t1')).toBeLessThan(ids_.indexOf('wallets/sw1'));
  });
});

describe('seedTransactions', () => {
  it('عشر عمليات، كلها على محافظ وفئات التجربة، وجوه الشهر ده', () => {
    const txs = seedTransactions(ids, '2026-09-03');
    expect(txs).toHaveLength(10);
    const walletIds = new Set(Object.values(ids.wallets));
    for (const t of txs) {
      expect(walletIds.has(t.walletId)).toBe(true);
      if (t.categoryId) expect(Object.values(ids.categories)).toContain(t.categoryId);
      expect(t.date >= '2026-09-01' && t.date <= '2026-09-03').toBe(true);
    }
  });
});

describe('seedIncome', () => {
  it('معاده النهارده عشان الكارت يظهر', () => {
    expect(seedIncome(ids, '2026-09-25')).toMatchObject({ dayOfMonth: 25, mode: 'confirm', walletId: 'sw1' });
  });
});

describe('seedDocs — العمليات المربوطة بكيان تجربة من محفظة مش تجربة', () => {
  // دفعة الدين بتتعمل من أي محفظة يختارها اللي بيجرّب (money-reviewer)
  it('دفعة/زيادة دين، ومدفوعات الاشتراك والجمعية على محفظة عادية بتتمسح', () => {
    const s = scan({
      debts: [{ id: 'd1', personName: 'صاحبي أ', initialTransactionId: 'dt0', payments: [{ transactionId: 'dp1' }], increases: [{ transactionId: 'di1' }] }],
      subscriptions: [{ id: 's1', name: 'اشتراك تجربة', history: [{ transactionId: 'sp1' }] }],
      gamiyas: [{ id: 'g1', name: 'جمعية تجربة', months: [{ transactionId: 'gm1' }, {}] }],
      transactions: ['dt0', 'dp1', 'di1', 'sp1', 'gm1', 'rt1'].map(id => ({ id, walletId: 'real1' })),
    });
    const tx = seedDocs(s).filter(r => r.collection === 'transactions').map(r => r.id).sort();
    expect(tx).toEqual(['di1', 'dp1', 'dt0', 'gm1', 'sp1']);
  });

  it('معرّف مربوط بكيان مش تجربة مبيتمسحش', () => {
    const s = scan({
      debts: [{ id: 'rd', personName: 'أحمد', payments: [{ transactionId: 'rt1' }] }],
      transactions: [{ id: 'rt1', walletId: 'real1' }],
    });
    expect(seedDocs(s).map(r => r.id)).not.toContain('rt1');
  });
});

describe('seedMissing — "خلصت" بس لما كل حاجة وصلت', () => {
  const today = '2026-09-25';
  function complete(): SeedScanInput {
    const txs = seedTransactions(ids, today).map((t, i) => ({ id: `st${i}`, ...t }));
    return scan({
      wallets: SEED_WALLETS.map(w => ({ id: ids.wallets[w.name], name: w.name, openingBalance: w.openingBalance, lowAlert: w.lowAlert })),
      debts: [{ id: 'd1', personName: 'صاحبي أ', initialTransactionId: 'dt0' }, { id: 'd2', personName: 'صاحبي ب' }],
      transactions: [...txs, { id: 'dt0', type: 'expense', amount: 1000, walletId: 'sw1' }],
    });
  }

  it('كاملة ← فاضية', () => {
    expect(seedMissing(complete())).toEqual([]);
  });

  it('عمليات ناقصة بتتقال بالعدد', () => {
    const s = complete();
    s.transactions = s.transactions.filter(t => !['st1', 'st4', 'st9'].includes(t.id));
    expect(seedMissing(s)).toEqual(['عمليات (7 من 10)']);
  });

  it('رصيد افتتاحي ما اتحدّثش (المحفظة لسه 0)', () => {
    const s = complete();
    s.wallets[1] = { ...s.wallets[1], openingBalance: 0 };
    expect(seedMissing(s)).toEqual(['رصيد "تجربة 2" الافتتاحي']);
  });

  it('دين أول عمليته ما وصلتش', () => {
    const s = complete();
    s.transactions = s.transactions.filter(t => t.id !== 'dt0');
    expect(seedMissing(s)).toEqual(['أول عملية لدين "صاحبي أ"']);
  });

  it('حساب فاضي ← كل حاجة ناقصة', () => {
    const empty = { wallets: [], categories: [], debts: [], subscriptions: [], gamiyas: [], incomes: [], transactions: [], budgets: {} };
    expect(seedMissing(empty)).toEqual(expect.arrayContaining(['محفظة "تجربة 1"', 'عمليات (0 من 10)', 'دين "صاحبي ب"', '"دخل ثابت تجربة"']));
  });
});

describe('documentsPhrase', () => {
  it.each([[0, 'مفيش مستندات'], [1, 'مستند واحد'], [2, 'مستندين'], [3, '3 مستندات'], [10, '10 مستندات'], [11, '11 مستند']])('%i ← %s', (n, s) => {
    expect(documentsPhrase(n)).toBe(s);
  });
});
