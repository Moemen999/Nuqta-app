import { ATTENTION_ROUTE, budgetDismissKey, buildAttentionItems, visibleAttention, type AttentionInput } from '@/lib/homeAttention';
import { bannerKey, type BannerType } from '@/lib/bannerDismiss';
import { MONEY_MASK, maskedAmount, plainAmount } from '@/lib/money';
import { currentMonth, todayStr } from '@/lib/finance';

/**
 * البناء الصافي لعناصر «محتاجة انتباهك» — الشروط والنصوص والمفاتيح نفس اللي البانرات كانت بتستخدمها
 * (`app/(tabs)/index.tsx` قبل 2026-11-13). التوقعات هنا منقولة من اختبارات البانرات القديمة
 * (`homeBudgetBanner`, `homeBannerDismiss`, `homeBannerOrder`) مش متكتبة من الكود الجديد.
 * **الوجهات:** الاشتراك والجمعية بيروحوا لوجهتهم القديمة (`/(tabs)/debts`). صف الرصيد (`/settings-screens/wallets`)
 * وصف الميزانية (`/(tabs)/planning`) وجهتهم **جديدة** بقرار مؤمن 2026-11-13 — البانرات القديمة ماكانتش بتتداس.
 */

const day = (offset: number) => {
  const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const exp = (id: string, amount: number, categoryId?: string) =>
  ({ id, type: 'expense', amount, walletId: 'w1', categoryId, date: todayStr(), createdAt: '2026-01-01T08:00:00Z' });

function input(over: Partial<AttentionInput> = {}): AttentionInput {
  return {
    activeWallets: [{ id: 'w1', name: 'كاش', openingBalance: 1000, lowAlert: 0 }] as never,
    balances: new Map([['w1', 1000]]),
    activeCategories: [], transactions: [exp('t0', 1)] as never, budgets: {}, transfers: new Set(),
    spendKnown: true, nowMonth: currentMonth(), subscriptions: [], gamiyas: [],
    hasTodayTx: true, offlineEmpty: false, noWallets: false, cold: false, dailyHour: 20, nowHour: 21,
    unverifiedEmail: null, money: plainAmount,
    ...over,
  };
}
const ids = (i: AttentionInput) => buildAttentionItems(i).map(x => x.id);

describe('رصيد قرب يخلص', () => {
  const low = (bal: number, alert: number) => input({
    activeWallets: [{ id: 'w1', name: 'كاش', openingBalance: 0, lowAlert: alert }] as never, balances: new Map([['w1', bal]]),
  });
  it('تحت الحد بس (مش مساوي) — نفس `<` القديمة', () => {
    expect(ids(low(499, 500))).toEqual(['low_w1']);
    expect(ids(low(500, 500))).toEqual([]);
    expect(ids(low(0, 0))).toEqual([]);
  });
  it('النص والـlabel والمفتاح زي البانر', () => {
    const [it0] = buildAttentionItems(low(100, 500));
    expect(it0.text).toBe('رصيد كاش قرب يخلص (100 ج.م)');
    expect(it0.label).toBe('رصيد كاش قرب يخلص (100 ج.م)');
    expect(it0).toMatchObject({ type: 'lowBalance', instance: 'w1', dismissName: 'كاش', route: '/settings-screens/wallets' });
    expect(bannerKey(it0.type, it0.instance)).toBe('lowBalance:w1');
  });
  it('العين مقفولة ← المبلغ مخفي في النص، و`speakable` في الـlabel بتقوله «مبلغ مخفي»', () => {
    const [it0] = buildAttentionItems({ ...low(100, 500), money: maskedAmount });
    expect(it0.text).toContain(MONEY_MASK);
    expect(it0.text).not.toContain('100');
    expect(it0.label).toBe('رصيد كاش قرب يخلص (مبلغ مخفي ج.م)');
  });
});

describe('ميزانية الفئة (توقعات homeBudgetBanner)', () => {
  const cat = (spent: number, limit = 1000) => input({
    activeCategories: [{ id: 'c1', name: 'أكل' }] as never, transactions: [exp('a', spent, 'c1')] as never, budgets: { c1: limit },
  });
  it('999.996 من 1000 ← خلصت (مش قربت)، 900 ← قربت، 799 ← مفيش', () => {
    expect(buildAttentionItems(cat(999.996))[0].text).toMatch(/^ميزانية أكل خلصت/);
    expect(buildAttentionItems(cat(900))[0].text).toMatch(/^ميزانية أكل قربت تخلص/);
    expect(buildAttentionItems(cat(799))).toEqual([]);
  });
  it('النص `صرف/حد` والـlabel `صرف من حد` ومفتاح الـ✕ بالدرجة (قربت ← near، غيرها ← over)', () => {
    const [near] = buildAttentionItems(cat(900));
    expect(near.text).toBe('ميزانية أكل قربت تخلص (900/1,000)');
    expect(near.label).toBe('ميزانية أكل قربت تخلص (900 من 1,000)');
    expect(near).toMatchObject({ type: 'budget', instance: 'c1:near', route: ATTENTION_ROUTE.budget, dismissName: 'أكل' });
    expect(buildAttentionItems(cat(1000))[0].instance).toBe('c1:over'); // «at» كمان over
    expect(buildAttentionItems(cat(1200))[0].instance).toBe('c1:over');
    expect(budgetDismissKey('c1', 'at')).toBe('c1:over');
  });
  it('الديون لسه بتتحمّل (spendKnown=false) ← مفيش ميزانية. والسلفة مش مصروف', () => {
    expect(ids({ ...cat(900), spendKnown: false })).toEqual([]);
    expect(ids({ ...cat(900), transfers: new Set(['a']) })).toEqual([]);
  });
  it('ميزانية فئة مؤرشفة أو من غير حد ← مفيش', () => {
    expect(ids({ ...cat(900), activeCategories: [] })).toEqual([]);
    expect(ids({ ...cat(900), budgets: { c1: 0 } })).toEqual([]);
  });
  it('مفيش بند «إجمالي» تاني (البانر الإجمالي اتشال — كارت الشهر هو اللي بيقول)', () => {
    expect(ids(input({ transactions: [exp('a', 999)] as never, budgets: { total_budget: 1000 } }))).toEqual([]);
  });
});

describe('اشتراك وجمعية جايين', () => {
  const sub = (offset: number, over: object = {}) => ({ id: 's1', name: 'نتفليكس', amount: 100, walletId: 'w1', active: true, nextDueDate: day(offset), reminderDaysBefore: 3, ...over });
  const gam = (offset: number, over: object = {}) => ({
    id: 'g1', name: 'العيلة', walletId: 'w1', reminderDaysBefore: 3,
    months: [{ id: 'm2', monthIndex: 2, dueDate: day(offset), isPayoutMonth: false, amount: 500, status: 'pending', ...over }],
  });
  it('جوه نافذة 1..reminderDaysBefore بس: النهارده والفايت والبعيد مش عناصر (بيروحوا لكروت «اتخصم؟»)', () => {
    expect(ids(input({ subscriptions: [sub(2)] as never }))).toEqual(['sub_s1']);
    expect(ids(input({ subscriptions: [sub(3)] as never }))).toEqual(['sub_s1']);
    expect(ids(input({ subscriptions: [sub(1)] as never }))).toEqual(['sub_s1']);
    for (const off of [0, -1, 4]) expect(ids(input({ subscriptions: [sub(off)] as never }))).toEqual([]);
    for (const off of [0, -2, 4]) expect(ids(input({ gamiyas: [gam(off)] as never }))).toEqual([]);
  });
  it('اشتراك موقوف أو شهر جمعية مدفوع ← مفيش', () => {
    expect(ids(input({ subscriptions: [sub(2, { active: false })] as never }))).toEqual([]);
    expect(ids(input({ gamiyas: [gam(2, { status: 'done' })] as never }))).toEqual([]);
  });
  it('نص الاشتراك والجمعية والمفتاح زي ما كانوا', () => {
    const [s] = buildAttentionItems(input({ subscriptions: [sub(2)] as never }));
    expect(s.text).toBe('اشتراك نتفليكس بعد 2 يوم (100 ج.م)');
    expect(s).toMatchObject({ type: 'subscriptionDue', instance: `s1@${day(2)}`, route: '/(tabs)/debts', label: s.text });
    const [g] = buildAttentionItems(input({ gamiyas: [gam(2)] as never }));
    expect(g.text).toBe('جمعية العيلة — القسط بعد 2 يوم (500 ج.م)');
    expect(g).toMatchObject({ type: 'gamiyaDue', instance: 'm2', route: '/(tabs)/debts' });
    const [p] = buildAttentionItems(input({ gamiyas: [gam(2, { isPayoutMonth: true })] as never }));
    expect(p.text).toBe('جمعية العيلة — شهر الاستلام بعد 2 يوم (500 ج.م)');
  });
  it('العين مقفولة ← المبلغ مخفي', () => {
    const [s] = buildAttentionItems(input({ subscriptions: [sub(2)] as never, money: maskedAmount }));
    expect(s.text).toBe(`اشتراك نتفليكس بعد 2 يوم (${MONEY_MASK} ج.م)`);
    expect(s.label).toBe('اشتراك نتفليكس بعد 2 يوم (مبلغ مخفي ج.م)');
  });
});

describe('«لسه ما سجلتش مصاريف النهاردة» (توقعات homeBannerDismiss)', () => {
  const noTx = (over: Partial<AttentionInput> = {}) => input({ hasTodayTx: false, ...over });
  it('بعد ساعة التذكير بس، ومعاها نفس الحرّاس القديمة', () => {
    expect(ids(noTx())).toEqual(['no_tx_today']);
    expect(ids(noTx({ nowHour: 20 }))).toEqual(['no_tx_today']);
    expect(ids(noTx({ nowHour: 19 }))).toEqual([]);
    expect(ids(noTx({ dailyHour: null }))).toEqual([]);
    expect(ids(noTx({ offlineEmpty: true }))).toEqual([]);
    expect(ids(noTx({ noWallets: true }))).toEqual([]);
    expect(ids(noTx({ cold: true }))).toEqual([]);
    expect(ids(input({ hasTodayTx: true }))).toEqual([]);
  });
  it('النص والمفتاح، ومن غير وجهة', () => {
    const [n] = buildAttentionItems(noTx());
    expect(n).toMatchObject({ text: 'لسه ما سجلتش مصاريف النهاردة', type: 'noTxToday' });
    expect(n.route).toBeUndefined();
    expect(n.instance).toBeUndefined();
  });
});

describe('تأكيد الإيميل', () => {
  it('إيميل مش مأكّد ← عنصر بنفس نص البانر ومفتاح `verifyEmail` من غير instance ومن غير وجهة', () => {
    const [v] = buildAttentionItems(input({ unverifiedEmail: 'a@b.c' }));
    expect(v).toMatchObject({ id: 'verify_email', type: 'verifyEmail' });
    expect(v.instance).toBeUndefined();
    expect(v.route).toBeUndefined();
    expect(v.text).toBe('إيميلك (a@b.c) لسه مش مأكّد — أكّده عشان تأمّن حسابك');
    expect(bannerKey(v.type, v.instance)).toBe('verifyEmail');
  });
  it('null ← مفيش', () => { expect(ids(input())).toEqual([]); });
});

describe('الترتيب', () => {
  it('ميزانيات (خلصت قبل قربت) ← محافظ ← اشتراكات/جمعية الأقرب الأول ← إيميل ← لسه ما سجلتش', () => {
    const all = input({
      activeWallets: [
        { id: 'w1', name: 'كاش', openingBalance: 0, lowAlert: 500 },
        { id: 'w2', name: 'البنك', openingBalance: 0, lowAlert: 500 },
      ] as never,
      balances: new Map([['w1', 10], ['w2', 20]]),
      activeCategories: [{ id: 'c1', name: 'أكل' }, { id: 'c2', name: 'نقل' }] as never,
      transactions: [exp('a', 900, 'c1'), exp('b', 1200, 'c2')] as never, budgets: { c1: 1000, c2: 1000 },
      subscriptions: [{ id: 's1', name: 'نتفليكس', amount: 100, walletId: 'w1', active: true, nextDueDate: day(3), reminderDaysBefore: 3 }] as never,
      gamiyas: [{ id: 'g1', name: 'العيلة', walletId: 'w1', reminderDaysBefore: 3,
        months: [{ id: 'm2', monthIndex: 2, dueDate: day(1), isPayoutMonth: false, amount: 500, status: 'pending' }] }] as never,
      hasTodayTx: false, unverifiedEmail: 'a@b.c',
    });
    expect(ids(all)).toEqual(['budget_c2', 'budget_c1', 'low_w1', 'low_w2', 'gamiya_m2', 'sub_s1', 'verify_email', 'no_tx_today']);
  });
});

describe('visibleAttention — نفس hidden(type, instance) بتاع البانرات', () => {
  const two = () => buildAttentionItems(input({
    activeWallets: [{ id: 'w1', name: 'كاش', openingBalance: 0, lowAlert: 500 }, { id: 'w2', name: 'البنك', openingBalance: 0, lowAlert: 500 }] as never,
    balances: new Map([['w1', 10], ['w2', 20]]),
  }));
  it('اللي اتقفل بمفتاحه القديم (`lowBalance:w1`) مش في القايمة، التاني فاضل', () => {
    const closed = new Set(['lowBalance:w1']);
    const vis = visibleAttention(two(), (t, i) => closed.has(bannerKey(t, i)));
    expect(vis.map(x => x.id)).toEqual(['low_w2']);
  });
  it('اشتراك اتقفل قبل كده بمفتاح `subscriptionDue:<id>@<معاد>` ← بره، والدورة الجاية (معاد تاني) ← جوه', () => {
    const build = (due: string) => buildAttentionItems(input({
      subscriptions: [{ id: 's1', name: 'x', amount: 1, walletId: 'w1', active: true, nextDueDate: due, reminderDaysBefore: 3 }] as never,
    }));
    const closed = new Set([`subscriptionDue:s1@${day(2)}`]);
    const hidden = (t: BannerType, i?: string) => closed.has(bannerKey(t, i));
    expect(visibleAttention(build(day(2)), hidden)).toEqual([]);
    expect(visibleAttention(build(day(3)), hidden)).toHaveLength(1);
  });
});
