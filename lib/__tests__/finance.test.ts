import type { Debt, Transaction } from '@/context/DataContext';
import {
  addDays, categoryLabel, daysUntil, debtGrandTotal, debtPaid, endOfMonth, fmt,
  formatTime, monthSpend, startOfMonth, transactionWalletLabel, walletBalance,
} from '@/lib/finance';

// مصنع عمليات مختصر — بنحدد اللي يهم الاختبار بس
function tx(t: Partial<Transaction> & Pick<Transaction, 'type' | 'amount'>): Transaction {
  return {
    id: Math.random().toString(36).slice(2),
    walletId: 'w1',
    date: '2026-03-10',
    ...t,
  } as Transaction;
}

describe('walletBalance — حساب رصيد المحفظة', () => {
  it('محفظة من غير أي عمليات بترجع الرصيد الابتدائي زي ما هو', () => {
    expect(walletBalance([], 'w1', 500)).toBe(500);
  });

  it('المصروف بيتخصم من رصيد المحفظة', () => {
    const txs = [tx({ type: 'expense', amount: 120 })];
    expect(walletBalance(txs, 'w1', 500)).toBe(380);
  });

  it('الإيراد بيتضاف لرصيد المحفظة', () => {
    const txs = [tx({ type: 'income', amount: 300 })];
    expect(walletBalance(txs, 'w1', 500)).toBe(800);
  });

  it('خليط من المصروفات والإيرادات بيتحسب صح', () => {
    const txs = [
      tx({ type: 'income', amount: 1000 }),
      tx({ type: 'expense', amount: 250 }),
      tx({ type: 'expense', amount: 50 }),
      tx({ type: 'income', amount: 100 }),
    ];
    expect(walletBalance(txs, 'w1', 200)).toBe(1000);
  });

  it('عمليات المحافظ التانية مبتأثرش على رصيد المحفظة دي', () => {
    const txs = [
      tx({ type: 'expense', amount: 100, walletId: 'w2' }),
      tx({ type: 'income', amount: 900, walletId: 'w3' }),
      tx({ type: 'expense', amount: 40, walletId: 'w1' }),
    ];
    expect(walletBalance(txs, 'w1', 100)).toBe(60);
  });

  it('السحب بيتخصم من المحفظة اللي الفلوس طالعة منها', () => {
    const txs = [tx({ type: 'withdraw', amount: 300, walletId: 'w1', toWalletId: 'w2' })];
    expect(walletBalance(txs, 'w1', 500)).toBe(200);
  });

  it('السحب بيتضاف للمحفظة اللي الفلوس داخلة فيها', () => {
    const txs = [tx({ type: 'withdraw', amount: 300, walletId: 'w1', toWalletId: 'w2' })];
    expect(walletBalance(txs, 'w2', 100)).toBe(400);
  });

  it('السحب مبيغيّرش إجمالي الفلوس — بيحرّكها من محفظة للتانية بس', () => {
    const txs = [tx({ type: 'withdraw', amount: 250, walletId: 'w1', toWalletId: 'w2' })];
    const before = 800 + 150;
    const after = walletBalance(txs, 'w1', 800) + walletBalance(txs, 'w2', 150);
    expect(after).toBe(before);
  });

  it('السحب لنفس المحفظة مبيغيّرش رصيدها', () => {
    const txs = [tx({ type: 'withdraw', amount: 300, walletId: 'w1', toWalletId: 'w1' })];
    expect(walletBalance(txs, 'w1', 500)).toBe(500);
  });

  it('الرصيد الابتدائي السالب بيتحسب زي ما هو مش بيتحوّل لصفر', () => {
    const txs = [tx({ type: 'income', amount: 100 })];
    expect(walletBalance(txs, 'w1', -400)).toBe(-300);
  });

  it('الرصيد الابتدائي الناقص (undefined) بيتعامل كصفر', () => {
    const txs = [tx({ type: 'expense', amount: 75 })];
    expect(walletBalance(txs, 'w1', undefined as unknown as number)).toBe(-75);
  });

  it('الرصيد بيبقى سالب لو المصروفات أكتر من اللي في المحفظة', () => {
    const txs = [tx({ type: 'expense', amount: 900 })];
    expect(walletBalance(txs, 'w1', 100)).toBe(-800);
  });

  it('الكسور العشرية بتتجمع صح', () => {
    const txs = [
      tx({ type: 'expense', amount: 10.5 }),
      tx({ type: 'expense', amount: 4.25 }),
    ];
    expect(walletBalance(txs, 'w1', 100)).toBeCloseTo(85.25, 10);
  });
});

describe('monthSpend — مصروف فئة في شهر', () => {
  const txs = [
    tx({ type: 'expense', amount: 100, categoryId: 'c1', date: '2026-03-01' }),
    tx({ type: 'expense', amount: 50, categoryId: 'c1', date: '2026-03-31' }),
    tx({ type: 'expense', amount: 70, categoryId: 'c2', date: '2026-03-15' }),
    tx({ type: 'expense', amount: 900, categoryId: 'c1', date: '2026-02-28' }),
    tx({ type: 'expense', amount: 900, categoryId: 'c1', date: '2026-04-01' }),
    tx({ type: 'income', amount: 5000, categoryId: 'c1', date: '2026-03-10' }),
    tx({ type: 'withdraw', amount: 400, categoryId: 'c1', date: '2026-03-10', toWalletId: 'w2' }),
  ];

  it('بيجمع مصروفات الفئة في الشهر المطلوب بس', () => {
    expect(monthSpend(txs, 'c1', '2026-03')).toBe(150);
  });

  it('مبيحسبش الإيرادات حتى لو متسجلة على نفس الفئة', () => {
    expect(monthSpend(txs, 'c1', '2026-03')).not.toBeGreaterThanOrEqual(5000);
  });

  it('مبيحسبش عمليات السحب حتى لو عليها فئة', () => {
    const onlyWithdraw = [tx({ type: 'withdraw', amount: 400, categoryId: 'c1', date: '2026-03-10', toWalletId: 'w2' })];
    expect(monthSpend(onlyWithdraw, 'c1', '2026-03')).toBe(0);
  });

  it('مبيحسبش الشهور التانية — لا اللي قبله ولا اللي بعده', () => {
    expect(monthSpend(txs, 'c1', '2026-02')).toBe(900);
    expect(monthSpend(txs, 'c1', '2026-04')).toBe(900);
  });

  it('فئة مالهاش مصروفات في الشهر ده بترجع صفر', () => {
    expect(monthSpend(txs, 'c9', '2026-03')).toBe(0);
  });

  it('بيحسب أول يوم وآخر يوم في الشهر جوه الحساب', () => {
    // 2026-03-01 و 2026-03-31 الاتنين لازم يتحسبوا
    expect(monthSpend(txs, 'c1', '2026-03')).toBe(100 + 50);
  });
});

describe('debtGrandTotal و debtPaid — إجمالي الدين واللي اتسدد منه', () => {
  function debt(d: Partial<Debt>): Debt {
    return {
      id: 'd1', direction: 'owed_to_me', personName: 'أحمد', totalAmount: 1000,
      date: '2026-01-01', isInstallment: false, createdAt: '2026-01-01T00:00:00.000Z',
      payments: [], increases: [],
      ...d,
    } as Debt;
  }

  it('دين من غير زيادات إجماليه هو المبلغ الأساسي', () => {
    expect(debtGrandTotal(debt({ totalAmount: 1000 }))).toBe(1000);
  });

  it('الزيادات بتتضاف على المبلغ الأساسي', () => {
    const d = debt({
      totalAmount: 1000,
      increases: [
        { id: 'i1', date: '2026-02-01', amount: 300 },
        { id: 'i2', date: '2026-03-01', amount: 200 },
      ],
    });
    expect(debtGrandTotal(d)).toBe(1500);
  });

  it('دين قديم مالوش حقل increases خالص مبيكسرش الحساب', () => {
    const d = debt({ increases: undefined as unknown as Debt['increases'] });
    expect(debtGrandTotal(d)).toBe(1000);
  });

  it('دين لسه ما اتدفعش منه حاجة المدفوع فيه صفر', () => {
    expect(debtPaid(debt({}))).toBe(0);
  });

  it('الدفعات بتتجمع في المدفوع', () => {
    const d = debt({
      payments: [
        { id: 'p1', date: '2026-02-01', amount: 200, walletId: 'w1' },
        { id: 'p2', date: '2026-03-01', amount: 150, walletId: 'w1' },
      ],
    });
    expect(debtPaid(d)).toBe(350);
  });

  it('دين مدفوع جزئيًا: المتبقي = الإجمالي − المدفوع', () => {
    const d = debt({
      totalAmount: 1000,
      increases: [{ id: 'i1', date: '2026-02-01', amount: 500 }],
      payments: [{ id: 'p1', date: '2026-02-05', amount: 600, walletId: 'w1' }],
    });
    expect(debtGrandTotal(d) - debtPaid(d)).toBe(900);
  });

  it('دين مدفوع بالكامل المتبقي فيه صفر', () => {
    const d = debt({
      totalAmount: 1000,
      payments: [{ id: 'p1', date: '2026-02-05', amount: 1000, walletId: 'w1' }],
    });
    expect(debtGrandTotal(d) - debtPaid(d)).toBe(0);
  });

  it('دين اتدفع فيه أكتر من قيمته المتبقي بيبقى بالسالب (مش بيتقصّ على صفر)', () => {
    const d = debt({
      totalAmount: 1000,
      payments: [{ id: 'p1', date: '2026-02-05', amount: 1200, walletId: 'w1' }],
    });
    expect(debtGrandTotal(d) - debtPaid(d)).toBe(-200);
  });

  it('الزيادة بعد السداد الكامل بترجّع الدين مفتوح تاني', () => {
    const d = debt({
      totalAmount: 1000,
      payments: [{ id: 'p1', date: '2026-02-05', amount: 1000, walletId: 'w1' }],
      increases: [{ id: 'i1', date: '2026-03-01', amount: 400 }],
    });
    expect(debtGrandTotal(d) - debtPaid(d)).toBe(400);
  });
});

describe('addDays — الجمع والطرح على التواريخ', () => {
  it('يوم واحد بعد آخر يوم في شهر 31 بيروح للشهر اللي بعده', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
  });

  it('يوم واحد بعد آخر يوم في شهر 30', () => {
    expect(addDays('2026-04-30', 1)).toBe('2026-05-01');
  });

  it('فبراير في سنة عادية بيخلص يوم 28', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('فبراير في سنة كبيسة فيه يوم 29', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-02-29', 1)).toBe('2024-03-01');
  });

  it('31 ديسمبر + يوم بيعدّي للسنة الجديدة', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('1 يناير − يوم بيرجع للسنة اللي فاتت', () => {
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('طرح 6 أيام (فترة "آخر 7 أيام") بيعدّي بداية الشهر صح', () => {
    expect(addDays('2026-03-03', -6)).toBe('2026-02-25');
  });

  it('زيادة 30 يوم على تاريخ في فبراير كبيسة', () => {
    expect(addDays('2024-02-15', 30)).toBe('2024-03-16');
  });

  it('صفر يوم بيرجع نفس التاريخ', () => {
    expect(addDays('2026-07-04', 0)).toBe('2026-07-04');
  });
});

describe('startOfMonth و endOfMonth — حدود الشهر', () => {
  it('بداية الشهر دايمًا يوم 1 مهما كان اليوم', () => {
    expect(startOfMonth('2026-03-17')).toBe('2026-03-01');
    expect(startOfMonth('2026-03-01')).toBe('2026-03-01');
    expect(startOfMonth('2026-03-31')).toBe('2026-03-01');
  });

  it('آخر الشهر في شهر 31 يوم', () => {
    expect(endOfMonth('2026-01-15')).toBe('2026-01-31');
  });

  it('آخر الشهر في شهر 30 يوم', () => {
    expect(endOfMonth('2026-04-10')).toBe('2026-04-30');
  });

  it('آخر فبراير في سنة عادية = 28', () => {
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
  });

  it('آخر فبراير في سنة كبيسة = 29', () => {
    expect(endOfMonth('2024-02-10')).toBe('2024-02-29');
  });

  it('آخر ديسمبر مبيعديش للسنة اللي بعدها', () => {
    expect(endOfMonth('2026-12-05')).toBe('2026-12-31');
  });

  it('لو التاريخ نفسه آخر يوم في الشهر بيرجع نفسه', () => {
    expect(endOfMonth('2026-01-31')).toBe('2026-01-31');
  });
});

describe('daysUntil — كام يوم فاضل', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  function freeze(dayIso: string) {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(`${dayIso}T09:00:00.000Z`));
  }

  it('تاريخ النهاردة بيرجع صفر', () => {
    freeze('2026-03-10');
    expect(daysUntil('2026-03-10')).toBe(0);
  });

  it('بكرة بيرجع 1', () => {
    freeze('2026-03-10');
    expect(daysUntil('2026-03-11')).toBe(1);
  });

  it('امبارح بيرجع -1 (متأخر يوم)', () => {
    freeze('2026-03-10');
    expect(daysUntil('2026-03-09')).toBe(-1);
  });

  it('بيعدّي آخر الشهر صح', () => {
    freeze('2026-01-30');
    expect(daysUntil('2026-02-02')).toBe(3);
  });

  it('بيعدّي آخر السنة صح', () => {
    freeze('2026-12-30');
    expect(daysUntil('2027-01-02')).toBe(3);
  });

  it('بيعدّي 29 فبراير في السنة الكبيسة', () => {
    freeze('2024-02-27');
    expect(daysUntil('2024-03-01')).toBe(3);
  });
});

describe('fmt — تنسيق الأرقام', () => {
  it('بيحط فاصلة للآلاف', () => {
    expect(fmt(1234567)).toBe('1,234,567');
  });

  it('بيقرّب لخانتين عشريتين', () => {
    expect(fmt(1234.567)).toBe('1,234.57');
    expect(fmt(0.125)).toBe('0.13');
  });

  it('بيشيل الأصفار الزيادة بعد العلامة العشرية', () => {
    expect(fmt(1200.5)).toBe('1,200.5');
    expect(fmt(1200.0)).toBe('1,200');
  });

  it('الصفر بيرجع "0" مش فاضي', () => {
    expect(fmt(0)).toBe('0');
  });

  it('القيمة الناقصة بترجع "0" بدل NaN', () => {
    expect(fmt(undefined as unknown as number)).toBe('0');
    expect(fmt(null as unknown as number)).toBe('0');
  });

  it('الأرقام السالبة بتتنسق بعلامة ناقص', () => {
    expect(fmt(-2500.5)).toBe('-2,500.5');
  });
});

describe('formatTime — عرض الوقت بنظام 12 ساعة', () => {
  // بنبني الوقت بتوقيت الجهاز عشان الاختبار ميتأثرش بتوقيت السيرفر
  const iso = (h: number, m: number) => new Date(2026, 2, 10, h, m).toISOString();

  it('الوقت الصبح بيتكتب بـ ص', () => {
    expect(formatTime(iso(9, 5))).toBe('9:05 ص');
  });

  it('الوقت بعد الضهر بيتكتب بـ م بنظام 12 ساعة', () => {
    expect(formatTime(iso(13, 30))).toBe('1:30 م');
  });

  it('نص الليل بيتكتب 12 ص مش 0', () => {
    expect(formatTime(iso(0, 0))).toBe('12:00 ص');
  });

  it('الضهر بيتكتب 12 م', () => {
    expect(formatTime(iso(12, 0))).toBe('12:00 م');
  });

  it('الدقايق أقل من 10 بيتحط قدامها صفر', () => {
    expect(formatTime(iso(7, 3))).toBe('7:03 ص');
  });

  it('من غير وقت بترجع نص فاضي', () => {
    expect(formatTime(undefined)).toBe('');
    expect(formatTime('')).toBe('');
  });

  it('وقت مش مفهوم بيرجع فاضي بدل "Invalid Date"', () => {
    expect(formatTime('مش تاريخ')).toBe('');
  });
});

describe('categoryLabel — اسم الفئة مع الأيقونة', () => {
  it('الفئة اللي ليها أيقونة بتظهر بالأيقونة قبل الاسم', () => {
    expect(categoryLabel({ name: 'مواصلات', icon: '🚗' })).toBe('🚗 مواصلات');
  });

  it('الفئة من غير أيقونة بتظهر بالاسم بس', () => {
    expect(categoryLabel({ name: 'مواصلات' })).toBe('مواصلات');
  });

  it('فئة محذوفة (undefined) بترجع نص فاضي من غير كراش', () => {
    expect(categoryLabel(undefined)).toBe('');
  });
});

describe('transactionWalletLabel — وصف محافظ العملية', () => {
  const wallets = [{ id: 'w1', name: 'CASH' }, { id: 'w2', name: 'CIB' }];

  it('المصروف بيعرض اسم المحفظة بس', () => {
    expect(transactionWalletLabel({ type: 'expense', walletId: 'w1' }, wallets)).toBe('CASH');
  });

  it('السحب بيتكتب "من … إلى …" عشان الاتجاه ميلتبسش في العرض العربي', () => {
    expect(transactionWalletLabel({ type: 'withdraw', walletId: 'w1', toWalletId: 'w2' }, wallets))
      .toBe('من CASH إلى CIB');
  });

  it('الاتجاه بيتقلب لو المحفظتين اتبدلوا', () => {
    expect(transactionWalletLabel({ type: 'withdraw', walletId: 'w2', toWalletId: 'w1' }, wallets))
      .toBe('من CIB إلى CASH');
  });

  it('محفظة اتمسحت بترجع نص فاضي مكانها من غير كراش', () => {
    expect(transactionWalletLabel({ type: 'expense', walletId: 'محذوفة' }, wallets)).toBe('');
    expect(transactionWalletLabel({ type: 'withdraw', walletId: 'w1', toWalletId: 'محذوفة' }, wallets))
      .toBe('من CASH إلى ');
  });
});
