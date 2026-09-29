import {
  cascadeDeleteBlock, cascadeDeleteConfirm, debtTransactionIds, gamiyaTransactionIds, linkedTransactions,
  subscriptionTransactionIds, type CascadeKind,
} from '@/lib/archiving';
import { readFileSync } from 'fs';
import type { Debt, Gamiya, Subscription } from '@/context/DataContext';

/**
 * مسح دين/اشتراك/جمعية بيشيل كل العمليات اللي اتولّدت منه ومبيعملش تسوية.
 * لو عملية منهم على محفظة مؤرشفة، المسح لازم يتمنع — وإلا رصيد المؤرشفة
 * بيبعد عن الصفر ومحدش شايفه. الشاشات و`DataContext` الاتنين بيسألوا
 * `cascadeDeleteBlock`، فالاختبار هنا على القرار نفسه.
 *
 * **مش مختبَر هنا:** إن الدفعة فعلاً ما اتبعتتش لفايرستور — ده محتاج المحاكي
 * (`npm run test:db`)، وما اتشغلش في الجلسة اللي كتبت الاختبارات دي.
 */

const ACTIVE = { id: 'w_active', name: 'الكاش' };
const ARCHIVED = { id: 'w_old', name: 'المحفظة القديمة', archived: true };
const ARCHIVED_2 = { id: 'w_old2', name: 'فودافون كاش', archived: true };
const wallets = [ACTIVE, ARCHIVED, ARCHIVED_2];

const tx = (id: string, type: 'expense' | 'income', walletId: string, amount = 100) => ({ id, type, amount, walletId });

const debt = {
  id: 'd', personName: 'أحمد', direction: 'owed_to_me',
  initialTransactionId: 't_lend',
  payments: [{ id: 'p1', amount: 400, date: '2026-01-02', walletId: 'x', transactionId: 't_pay' }],
  increases: [{ id: 'i1', amount: 50, date: '2026-01-03', transactionId: 't_inc' }],
} as unknown as Debt;
const sub = {
  id: 's', name: 'نتفليكس',
  history: [{ id: 'h1', transactionId: 't_s1' }, { id: 'h2', transactionId: 't_s2' }, { id: 'h3' }],
} as unknown as Subscription;
const gam = {
  id: 'g', name: 'جمعية الشغل',
  months: [{ id: 'm1', transactionId: 't_g1' }, { id: 'm2' }],
} as unknown as Gamiya;

describe('معرّفات العمليات لكل نوع', () => {
  it('الدين: المبلغ الأساسي والدفعات والزيادات', () => {
    expect(debtTransactionIds(debt)).toEqual(['t_lend', 't_pay', 't_inc']);
  });
  it('الاشتراك: الدفعات اللي ليها عملية بس', () => {
    expect(subscriptionTransactionIds(sub)).toEqual(['t_s1', 't_s2']);
  });
  it('الجمعية: الشهور اللي ليها عملية بس', () => {
    expect(gamiyaTransactionIds(gam)).toEqual(['t_g1']);
  });
  it('سجل مش موجود ← مفيش معرّفات', () => {
    expect(debtTransactionIds(undefined)).toEqual([]);
    expect(subscriptionTransactionIds(undefined)).toEqual([]);
    expect(gamiyaTransactionIds(undefined)).toEqual([]);
  });
  it('linkedTransactions بتسيب المعرّف اللي عمليته اتمسحت قبل كده', () => {
    expect(linkedTransactions(['a', 'gone'], [tx('a', 'expense', 'w'), tx('b', 'expense', 'w')]).map(t => t.id)).toEqual(['a']);
  });
});

const CASES: [CascadeKind, string, string][] = [
  ['debt', 'أحمد', 'دين "أحمد"'],
  ['subscription', 'نتفليكس', 'الاشتراك "نتفليكس"'],
  ['gamiya', 'جمعية الشغل', 'الجمعية "جمعية الشغل"'],
];

describe('cascadeDeleteBlock — محفظة مؤرشفة', () => {
  it.each(CASES)('%s: عملية على محفظة مؤرشفة ← ممنوع، والرسالة بتسمّي السجل والمحفظة', (kind, name, subject) => {
    const b = cascadeDeleteBlock({
      kind, name, txIds: ['t1'], transactions: [tx('t1', 'expense', ARCHIVED.id)], wallets, loadErrors: [],
    });
    expect(b?.reason).toBe('wallet-archived');
    expect(b?.title).toBe('المحفظة دي مؤرشفة');
    expect(b?.body).toContain(subject);
    expect(b?.body).toContain(`"${ARCHIVED.name}"`);
    expect(b?.body).toContain('الإعدادات ← المحافظ');
  });

  it.each(CASES)('%s: كل العمليات على محفظة شغالة ← مسموح', (kind, name) => {
    expect(cascadeDeleteBlock({
      kind, name, txIds: ['t1', 't2'],
      transactions: [tx('t1', 'expense', ACTIVE.id), tx('t2', 'income', ACTIVE.id)], wallets, loadErrors: [],
    })).toBeNull();
  });

  it('عملية على شغالة وتانية على مؤرشفة ← ممنوع (المؤرشفة بس في الرسالة)', () => {
    const b = cascadeDeleteBlock({
      kind: 'subscription', name: 'نتفليكس', txIds: ['t1', 't2'],
      transactions: [tx('t1', 'expense', ACTIVE.id), tx('t2', 'expense', ARCHIVED.id)], wallets, loadErrors: [],
    });
    expect(b?.reason).toBe('wallet-archived');
    expect(b?.body).not.toContain(`"${ACTIVE.name}"`);
  });

  it('محفظتين مؤرشفتين ← الاتنين في الرسالة، بصيغة الجمع', () => {
    const b = cascadeDeleteBlock({
      kind: 'debt', name: 'أحمد', txIds: ['t1', 't2'],
      transactions: [tx('t1', 'expense', ARCHIVED.id), tx('t2', 'income', ARCHIVED_2.id, 30)], wallets, loadErrors: [],
    });
    expect(b?.title).toBe('المحافظ دي مؤرشفة');
    expect(b?.body).toContain(`"${ARCHIVED.name}"`);
    expect(b?.body).toContain(`"${ARCHIVED_2.name}"`);
  });

  it('قرض خرج من المؤرشفة ورجع ليها بالكامل ← أثره صفر، المسح مسموح', () => {
    expect(cascadeDeleteBlock({
      kind: 'debt', name: 'أحمد', txIds: ['lend', 'repay'],
      transactions: [tx('lend', 'expense', ARCHIVED.id, 1000), tx('repay', 'income', ARCHIVED.id, 1000)],
      wallets, loadErrors: [],
    })).toBeNull();
  });

  it('سداد جزئي على المؤرشفة ← الفرق مش صفر، ممنوع', () => {
    const b = cascadeDeleteBlock({
      kind: 'debt', name: 'أحمد', txIds: ['lend', 'repay'],
      transactions: [tx('lend', 'expense', ARCHIVED.id, 1000), tx('repay', 'income', ARCHIVED.id, 400)],
      wallets, loadErrors: [],
    });
    expect(b?.reason).toBe('wallet-archived');
  });

  it('التحويل لمحفظة مؤرشفة (الوجهة) بيتحسب برضه', () => {
    const b = cascadeDeleteBlock({
      kind: 'subscription', name: 'نتفليكس', txIds: ['t1'],
      transactions: [{ id: 't1', type: 'withdraw', amount: 50, walletId: ACTIVE.id, toWalletId: ARCHIVED.id }],
      wallets, loadErrors: [],
    });
    expect(b?.reason).toBe('wallet-archived');
  });

  it('سجل من غير عمليات ← مسموح حتى لو فيه مؤرشفة', () => {
    expect(cascadeDeleteBlock({ kind: 'gamiya', name: 'x', txIds: [], transactions: [], wallets, loadErrors: [] })).toBeNull();
  });
});

describe('cascadeDeleteBlock — البيانات ما وصلتش', () => {
  it.each([['wallets'], ['transactions']] as const)('%s ما وصلتش ← ممنوع، حتى لو القايمة شكلها آمن', (missing) => {
    const b = cascadeDeleteBlock({
      kind: 'subscription', name: 'نتفليكس', txIds: ['t1'], transactions: [], wallets: [ACTIVE], loadErrors: [missing],
    });
    expect(b?.reason).toBe('data-missing');
    expect(b?.body).toContain('الاشتراك "نتفليكس"');
  });

  it('مجموعة مالهاش دعوة (الميزانية) ما وصلتش ← مش بتمنع', () => {
    expect(cascadeDeleteBlock({
      kind: 'subscription', name: 'نتفليكس', txIds: ['t1'],
      transactions: [tx('t1', 'expense', ACTIVE.id)], wallets, loadErrors: ['budgets'],
    })).toBeNull();
  });
});

describe('cascadeDeleteBlock — البيانات لسه بتوصل (أول ثواني بعد الفتح)', () => {
  it.each([['wallets'], ['transactions']] as const)('%s لسه مرماش snapshot ← ممنوع، حتى لو القايمة فاضية وشكلها آمن', (pending) => {
    const b = cascadeDeleteBlock({
      kind: 'debt', name: 'أحمد', txIds: ['t1'], transactions: [], wallets: [], loadErrors: [], loading: [pending],
    });
    expect(b?.reason).toBe('data-loading');
    expect(b?.title).toBe('استنى البيانات توصل');
    expect(b?.body).toContain('لسه بتوصل');
    expect(b?.body).toContain('دين "أحمد"');
  });

  it('الفشل بيكسب على التحميل (رسالته فيها "جرّب تاني" بتاعة البانر)', () => {
    const b = cascadeDeleteBlock({
      kind: 'debt', name: 'أحمد', txIds: ['t1'], transactions: [], wallets: [], loadErrors: ['wallets'], loading: ['wallets'],
    });
    expect(b?.reason).toBe('data-missing');
  });

  it('الاتنين وصلوا ← الفحص العادي', () => {
    expect(cascadeDeleteBlock({
      kind: 'debt', name: 'أحمد', txIds: ['t1'], transactions: [tx('t1', 'expense', ACTIVE.id)], wallets, loadErrors: [], loading: [],
    })).toBeNull();
  });

  it('سجل من غير عمليات ← مسموح حتى والبيانات لسه بتوصل (مفيش رصيد يتحرك)', () => {
    expect(cascadeDeleteBlock({
      kind: 'gamiya', name: 'x', txIds: [], transactions: [], wallets: [], loadErrors: [], loading: ['wallets', 'transactions'],
    })).toBeNull();
  });
});

/**
 * الفحص جوه `deleteWithTransactions` لازم يقرا **آخر** حالة، مش اللي في الـclosure:
 * الـAlert بينادي نسخة `deleteDebt` من الـrender اللي فتح التأكيد، فلو قرا
 * `wallets`/`transactions` مباشرة كان هيعيد نفس فحص الشاشة ومحفظة اتأرشفت
 * والتأكيد مفتوح مكانتش هتتمسك (money-reviewer + silent-failure-hunter).
 * حارس أسماء على `DataContext.tsx` — السلوك نفسه محتاج المحاكي.
 */
describe('DataContext: الفحص لحظة الدوسة بيقرا آخر حالة', () => {
  const src = readFileSync('context/DataContext.tsx', 'utf8');
  const start = src.indexOf('  function deleteWithTransactions(');
  const body = src.slice(start, src.indexOf('\n  }\n', start));

  it('بينادي cascadeDeleteBlock بـcascadeInputs.current وpendingFigures()', () => {
    expect(body).toMatch(/cascadeDeleteBlock\(\{[^}]*\.\.\.cascadeInputs\.current[^}]*loading: pendingFigures\(\)/);
  });

  it('وcascadeInputs بيتحدّث كل render', () => {
    expect(src).toContain('cascadeInputs.current = { wallets, transactions, loadErrors };');
  });

  it('والفحص قبل أي كتابة', () => {
    const check = body.indexOf('cascadeDeleteBlock(');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(body.indexOf('writeBatch('));
  });
});

describe('cascadeDeleteConfirm — التأكيد بيقول إن العمليات هتتمسح والرصيد هيتغيّر', () => {
  it.each(CASES)('%s: فيه عمليات ← العدد وتحذير الرصيد', (kind, name) => {
    const { body } = cascadeDeleteConfirm(kind, name, 3);
    expect(body).toContain(`"${name}"`);
    expect(body).toContain('هيتمسح');
    expect(body).toContain('3 عمليات');
    expect(body).toContain('هيغيّر أرصدة المحافظ');
  });

  it('العناوين زي ما هي', () => {
    expect(cascadeDeleteConfirm('debt', 'أحمد', 0).title).toBe('مسح الدين');
    expect(cascadeDeleteConfirm('subscription', 'نتفليكس', 0).title).toBe('مسح الاشتراك');
    expect(cascadeDeleteConfirm('gamiya', 'جمعية الشغل', 0).title).toBe('مسح الجمعية');
  });

  it('عملية واحدة ← مفرد', () => {
    expect(cascadeDeleteConfirm('subscription', 'نتفليكس', 1).body).toContain('عملية واحدة');
  });

  it('عمليتين ← مثنى', () => {
    expect(cascadeDeleteConfirm('subscription', 'نتفليكس', 2).body).toContain('عمليتين');
  });

  it('الجمعية مؤنث ← "معاها"', () => {
    expect(cascadeDeleteConfirm('gamiya', 'جمعية الشغل', 2).body).toContain('هيتمسح معاها عمليتين');
    expect(cascadeDeleteConfirm('subscription', 'نتفليكس', 2).body).toContain('هيتمسح معاه عمليتين');
  });

  it('النص كامل بالظبط (الصيغة اللي راجعها arabic-copy-reviewer)', () => {
    expect(cascadeDeleteConfirm('gamiya', 'جمعية الشغل', 5).body)
      .toBe('متأكد إنك عايز تمسح "جمعية الشغل"؟ (هيتمسح معاها 5 عمليات كمان، وده هيغيّر أرصدة المحافظ المرتبطة)');
  });

  it('مفيش عمليات ← السؤال بس، من غير كلام عن الأرصدة', () => {
    const { body } = cascadeDeleteConfirm('subscription', 'نتفليكس', 0);
    expect(body).toBe('متأكد إنك عايز تمسح "نتفليكس"؟');
    expect(body).not.toContain('أرصدة');
  });

  it('الدين بيفضل "دين فلان"', () => {
    expect(cascadeDeleteConfirm('debt', 'أحمد', 0).body).toBe('متأكد إنك عايز تمسح دين "أحمد"؟');
  });
});
