import {
  ARCHIVED_SUFFIX,
  DEFAULT_CATEGORY_ICON,
  DELETED_CATEGORY_LABEL,
  DELETED_SLICE_ID,
  DELETED_SLICE_NAME,
  DELETED_WALLET_LABEL,
  GROUPED_SLICE_ID,
  PIE_TOP_N,
  buildCategorySpend,
  buildPieSlices,
  categoryLabel,
  categoryLabelById,
  periodExpenseTotal,
  transactionWalletLabel,
  walletHistoryName,
} from '@/lib/finance';

/**
 * حذف محفظة أو فئة مبيمسحش تاريخها — العمليات بتفضل مكانها بمعرّف مش موجود.
 * كل الشاشات كانت بتعرض الفراغ في المكان ده (`?.name || ''`)، وفي السحب كانت
 * بتطلع "من  إلى " بالحرف. والأسوأ في التقارير: المصروف نفسه كان بيختفي من
 * الرسم ومن "مصروفات الفترة"، فالمستخدم يشوف رقم أقل من اللي صرفه من غير
 * أي سطر يقول ليه.
 */

const WALLETS = [
  { id: 'w1', name: 'كاش' },
  { id: 'w2', name: 'بنك' },
  { id: 'w3', name: 'توفير', archived: true },
];

const CATS = [
  { id: 'c1', name: 'أكل', icon: '🍔' },
  { id: 'c2', name: 'مواصلات' },
  { id: 'c3', name: 'ترفيه', archived: true },
];

describe('أسماء التاريخ', () => {
  it('المحفظة الموجودة باسمها', () => {
    expect(walletHistoryName(WALLETS, 'w1')).toBe('كاش');
  });

  it('المحفظة الممسوحة ليها اسم صريح مش فراغ', () => {
    expect(walletHistoryName(WALLETS, 'gone')).toBe(DELETED_WALLET_LABEL);
    expect(walletHistoryName(WALLETS, undefined)).toBe(DELETED_WALLET_LABEL);
  });

  it('المحفظة المؤرشفة باسمها + (مؤرشفة)', () => {
    expect(walletHistoryName(WALLETS, 'w3')).toBe(`توفير (${ARCHIVED_SUFFIX})`);
  });

  it('الفئة الممسوحة ليها اسم صريح', () => {
    expect(categoryLabelById(CATS, 'gone')).toBe(DELETED_CATEGORY_LABEL);
  });

  it('عملية من غير فئة أصلاً مش نفس الفئة الممسوحة', () => {
    expect(categoryLabelById(CATS, undefined)).toBe('');
    expect(categoryLabelById(CATS, '')).toBe('');
  });

  it('الأيقونة بتفضل مع الاسم، والمؤرشفة بتاخد اللاحقة', () => {
    expect(categoryLabelById(CATS, 'c1')).toBe('🍔\u00A0أكل');
    expect(categoryLabel(CATS[2])).toBe(`${DEFAULT_CATEGORY_ICON}\u00A0ترفيه (${ARCHIVED_SUFFIX})`);
  });
});

describe('transactionWalletLabel', () => {
  it('مصروف من محفظة ممسوحة بيقول كده صريح', () => {
    expect(transactionWalletLabel({ type: 'expense', walletId: 'gone' }, WALLETS))
      .toBe(DELETED_WALLET_LABEL);
  });

  it('السحب مبيطلعش "من  إلى " — الطرفين ليهم اسم دايمًا', () => {
    const label = transactionWalletLabel(
      { type: 'withdraw', walletId: 'gone', toWalletId: 'w2' },
      WALLETS
    );
    expect(label).toBe(`من ${DELETED_WALLET_LABEL} إلى بنك`);
    expect(label).not.toContain('من  إلى');
  });

  it('الطرفين ممسوحين', () => {
    expect(transactionWalletLabel({ type: 'withdraw', walletId: 'a', toWalletId: 'b' }, WALLETS))
      .toBe(`من ${DELETED_WALLET_LABEL} إلى ${DELETED_WALLET_LABEL}`);
  });
});

describe('buildCategorySpend — الفلوس مبتختفيش', () => {
  const colorFor = (id: string) => `color-${id}`;
  const opts = { colorFor, deletedColor: '#999' };

  it('المصروف اللي فئته اتمسحت بيتلمّ في شريحة واحدة', () => {
    const out = buildCategorySpend(
      [
        { categoryId: 'c1', amount: 100 },
        { categoryId: 'gone', amount: 60 },
        { categoryId: 'alsoGone', amount: 40 },
      ],
      CATS,
      opts
    );
    const deleted = out.find(s => s.id === DELETED_SLICE_ID);
    expect(deleted).toBeDefined();
    expect(deleted!.name).toBe(DELETED_SLICE_NAME);
    expect(deleted!.amount).toBe(100);
  });

  it('عملية من غير فئة خالص بتتلمّ مع الممسوحة', () => {
    const out = buildCategorySpend([{ amount: 25 }], CATS, opts);
    expect(out.find(s => s.id === DELETED_SLICE_ID)?.amount).toBe(25);
  });

  it('مجموع الشرايح = إجمالي المصروف — مفيش قرش بيضيع', () => {
    const rows = [
      { categoryId: 'c1', amount: 100 },
      { categoryId: 'c2', amount: 50 },
      { categoryId: 'gone', amount: 70 },
      { amount: 30 },
    ];
    const out = buildCategorySpend(rows, CATS, opts);
    const total = rows.reduce((s, r) => s + r.amount, 0);
    expect(out.reduce((s, c) => s + c.amount, 0)).toBe(total);
    expect(periodExpenseTotal(rows)).toBe(total);
  });

  it('مفيش شريحة ممسوحة لو كل الفئات موجودة', () => {
    const out = buildCategorySpend([{ categoryId: 'c1', amount: 100 }], CATS, opts);
    expect(out.some(s => s.id === DELETED_SLICE_ID)).toBe(false);
  });

  it('الفئة اللي مفيهاش مصروف مبتطلعش شريحة', () => {
    const out = buildCategorySpend([{ categoryId: 'c1', amount: 100 }], CATS, opts);
    expect(out.map(s => s.id)).toEqual(['c1']);
  });

  it('مع فلتر: بس الفئات المختارة، ومفيش شريحة ممسوحة', () => {
    const out = buildCategorySpend(
      [
        { categoryId: 'c1', amount: 100 },
        { categoryId: 'c2', amount: 50 },
        { categoryId: 'gone', amount: 70 },
      ],
      CATS,
      { ...opts, visibleIds: ['c1'] }
    );
    expect(out.map(s => s.id)).toEqual(['c1']);
    expect(out.some(s => s.id === DELETED_SLICE_ID)).toBe(false);
  });

  it('مع فلتر: مجموع الشرايح = الإجمالي المحسوب بنفس الفلتر', () => {
    const rows = [
      { categoryId: 'c1', amount: 100 },
      { categoryId: 'c2', amount: 50 },
      { categoryId: 'gone', amount: 70 },
    ];
    const visibleIds = ['c1', 'c2'];
    const out = buildCategorySpend(rows, CATS, { ...opts, visibleIds });
    expect(out.reduce((s, c) => s + c.amount, 0)).toBe(periodExpenseTotal(rows, visibleIds));
    expect(periodExpenseTotal(rows, visibleIds)).toBe(150);
  });

  it('الفئة المؤرشفة بتفضل شريحة عادية باسمها + اللاحقة', () => {
    const out = buildCategorySpend([{ categoryId: 'c3', amount: 80 }], CATS, opts);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('c3');
    expect(out[0].name).toBe(`${DEFAULT_CATEGORY_ICON}\u00A0ترفيه (${ARCHIVED_SUFFIX})`);
  });
});

describe('periodExpenseTotal', () => {
  const rows = [
    { categoryId: 'c1', amount: 100 },
    { categoryId: 'gone', amount: 70 },
    { amount: 30 },
  ];

  it('من غير فلتر: بيجمع كل حاجة، الممسوح والمفيهوش فئة', () => {
    expect(periodExpenseTotal(rows)).toBe(200);
  });

  it('مع فلتر: بس المختار', () => {
    expect(periodExpenseTotal(rows, ['c1'])).toBe(100);
  });

  it('فلتر فاضي بيرجّع صفر — مفيش فئة مختارة', () => {
    expect(periodExpenseTotal(rows, [])).toBe(0);
  });
});

describe('شريحة الممسوحة مبتتلمّش أبدًا في "فئات تانية"', () => {
  function slices(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      id: `c${i}`, name: `فئة ${i}`, amount: 100 - i, color: '#1',
    }));
  }
  const deletedSlice = { id: DELETED_SLICE_ID, name: DELETED_SLICE_NAME, amount: 5, color: '#999' };

  it('بتفضل لوحدها حتى لو مبلغها أصغر من كل حاجة', () => {
    const out = buildPieSlices([...slices(PIE_TOP_N + 3), deletedSlice], '#grouped');
    const deleted = out.find(s => s.id === DELETED_SLICE_ID);
    expect(deleted).toBeDefined();
    expect(deleted!.amount).toBe(5);
    expect(deleted!.name).toBe(DELETED_SLICE_NAME);
  });

  it('مبتتحسبش في عدد الشريحة المجمّعة', () => {
    const out = buildPieSlices([...slices(PIE_TOP_N + 3), deletedSlice], '#grouped');
    // 10 فئات حقيقية، 7 فوق، فـ3 اتلمّوا — الممسوحة برّه الحسبة
    expect(out.find(s => s.id === GROUPED_SLICE_ID)?.name).toBe('فئات تانية (3)');
  });

  it('بتيجي آخر شريحة عشان مكانها ميتغيّرش', () => {
    const out = buildPieSlices([...slices(PIE_TOP_N + 3), deletedSlice], '#grouped');
    expect(out[out.length - 1].id).toBe(DELETED_SLICE_ID);
  });

  it('بتظهر كمان لما الفئات أقل من الحد فمفيش تجميع أصلاً', () => {
    const out = buildPieSlices([...slices(2), deletedSlice], '#grouped');
    expect(out.map(s => s.id)).toEqual(['c0', 'c1', DELETED_SLICE_ID]);
    expect(out.some(s => s.id === GROUPED_SLICE_ID)).toBe(false);
  });

  it('مجموع الشرايح ما اتغيرش بعد التجميع', () => {
    const input = [...slices(PIE_TOP_N + 3), deletedSlice];
    const total = input.reduce((s, c) => s + c.amount, 0);
    expect(buildPieSlices(input, '#grouped').reduce((s, c) => s + c.amount, 0)).toBe(total);
  });
});
