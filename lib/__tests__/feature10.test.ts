import {
  categoryArchiveBlock, categoryDeleteBlock, categoryDeleteConsequences, categoryLinkSummary, incomesPhrase,
  walletBalanceBlockNotice, walletDeleteConsequences, walletLinkSummary, type CategoryRefs, type WalletRefs,
} from '@/lib/archiving';
import { DATA_LOADING_BODY, categoryActionLoading, walletActionLoading } from '@/lib/listenerErrors';
import {
  WALLET_AMOUNT_MAX, planLowAlertCommit, planWalletOpeningCommit, walletAmountRejectReason,
} from '@/lib/finance';
import { openingConfirmCopy, walletAmountRejectNotice } from '@/lib/walletCopy';
import { settleBlockedHint, settleBody } from '@/components/ArchivedSettlement';
import {
  PERIOD_EXPORT_LOAD_FAILED, PERIOD_EXPORT_WAIT, PERIOD_EXPORT_WAIT_OFFLINE, UNSURE_COUNTED_NOTE,
} from '@/lib/periodExport';
import { CATEGORY_ICONS, CATEGORY_ICON_LABELS, categoryIconLabel } from '@/lib/finance';
import { plainAmount } from '@/lib/money';

/**
 * الميزة 10 (المحافظ والفئات والأرشفة والتسوية) — الجولة الأخيرة: الحسابات والكلام اللي بيتبني في lib/.
 * الشاشات نفسها في `feature10Screens.test.tsx`.
 */

const walletRefs = (over: Partial<WalletRefs> = {}): WalletRefs => ({
  transactions: 0, debts: 0, activeSubscriptions: [], activeGamiyas: [], inactiveSubscriptions: 0, inactiveGamiyas: 0,
  activeIncomes: [], inactiveIncomes: 0, ...over,
});
const catRefs = (over: Partial<CategoryRefs> = {}): CategoryRefs => ({
  transactions: 0, activeSubscriptions: [], inactiveSubscriptions: 0, debtPayments: 0, hasBudget: false, ...over,
});

describe('H1: البيانات لسه بتوصل', () => {
  it('المحافظ: أي مصدر للرصيد أو اللي مربوط بيها لسه ما وصلش', () => {
    expect(walletActionLoading([], [])).toEqual([]);
    expect(walletActionLoading(['transactions'], [])).toEqual(['transactions']);
    expect(walletActionLoading(['wallets'], [])).toEqual(['wallets']);
    expect(walletActionLoading([], ['incomes', 'budgets'])).toEqual(['incomes']);
    expect(walletActionLoading(['transactions'], ['transactions', 'debts'])).toEqual(['transactions', 'debts']);
  });
  it('الفئات: العمليات والاشتراكات والديون والميزانية والفئات نفسها', () => {
    expect(categoryActionLoading([], [])).toEqual([]);
    expect(categoryActionLoading(['transactions'], [])).toEqual(['transactions']);
    expect(categoryActionLoading(['wallets'], [])).toEqual([]);
    expect(categoryActionLoading([], ['budgets', 'gamiyas'])).toEqual(['budgets']);
  });
  it('الرسالة', () => {
    expect(DATA_LOADING_BODY).toBe('بياناتك لسه بتوصل — استنى شوية وجرّب تاني.');
  });
});

describe('آخر فئة شغالة مبتتمسحش', () => {
  it('categoryDeleteBlock', () => {
    const cats = [{ id: 'a' }, { id: 'b', archived: true }];
    expect(categoryDeleteBlock('a', cats)).toEqual({ kind: 'last-active' });
    expect(categoryDeleteBlock('b', cats)).toBeNull();
    expect(categoryDeleteBlock('a', [...cats, { id: 'c' }])).toBeNull();
  });
  it('الأرشفة زي ما هي', () => {
    expect(categoryArchiveBlock({ refs: catRefs(), activeCategoryCount: 1, otherActiveCategoryCount: 0 })).toEqual({ kind: 'last-active' });
  });
});

describe('الكلام', () => {
  it('incomesPhrase', () => {
    expect(incomesPhrase(1)).toBe('دخل ثابت واحد');
    expect(incomesPhrase(2)).toBe('دخلين ثابتين');
    expect(incomesPhrase(3)).toBe('3 دخول ثابتة');
  });

  it('walletLinkSummary فيه الدخل الثابت، ومبيرجعش فاضي', () => {
    expect(walletLinkSummary(walletRefs({ activeIncomes: [{ id: 'i', name: 'مرتب' }] }))).toBe('دخل ثابت واحد');
    expect(walletLinkSummary(walletRefs({ inactiveIncomes: 2, inactiveSubscriptions: 1 }))).toBe('اشتراك واحد ودخلين ثابتين');
    expect(walletLinkSummary(walletRefs())).not.toBe('');
  });
  it('categoryLinkSummary مبيرجعش فاضي', () => {
    expect(categoryLinkSummary(catRefs())).not.toBe('');
  });

  it('مسح محفظة: الديون بعد «مربوط بيها»، والمثنى «هيظهروا»', () => {
    const lines = walletDeleteConsequences({ balance: 0, refs: walletRefs({ transactions: 2, debts: 3 }), money: plainAmount });
    expect(lines).toContain('عمليتين هيظهروا باسم محفظة ممسوحة.');
    expect(lines).toContain('مربوط بيها 3 ديون.');
  });
  it('مسح محفظة: اشتراك واحد ← «الاشتراك ده»', () => {
    const lines = walletDeleteConsequences({ balance: 0, refs: walletRefs({ activeSubscriptions: [{ id: 's', name: 'نتفليكس' }] }), money: plainAmount });
    expect(lines.join('\n')).toContain('الاشتراك ده هيقف لحد ما تختارله محفظة: نتفليكس.');
  });
  it('مسح محفظة: الرصيد بالاتجاه بالكلام، من غير علامة سالب', () => {
    const pos = walletDeleteConsequences({ balance: 250, refs: walletRefs(), money: plainAmount }).join('\n');
    expect(pos).toContain('إجمالي فلوسك هيقل 250 ج.م');
    const neg = walletDeleteConsequences({ balance: -250, refs: walletRefs(), money: plainAmount }).join('\n');
    expect(neg).toContain('إجمالي فلوسك هيزيد 250 ج.م');
    expect(neg).not.toMatch(/-\s?250/);
  });
  it('مسح محفظة: السطور عمرها ما تبقى فاضية', () => {
    expect(walletDeleteConsequences({ balance: 0, refs: walletRefs(), money: plainAmount }).length).toBeGreaterThan(0);
  });

  it('مسح فئة: الاشتراك بيفضل يتخصم (مش «هيقف»)', () => {
    const text = categoryDeleteConsequences(catRefs({ activeSubscriptions: [{ id: 's', name: 'نتفليكس' }] })).join('\n');
    expect(text).not.toContain('هتقف');
    expect(text).not.toContain('هيقف');
    expect(text).toContain('فئة ممسوحة');
    expect(text).toContain('نتفليكس');
  });
  it('مسح فئة: «هيظهروا» في المثنى، ومش فاضية', () => {
    expect(categoryDeleteConsequences(catRefs({ transactions: 2 }))).toContain('عمليتين هيظهروا باسم فئة ممسوحة.');
    expect(categoryDeleteConsequences(catRefs()).length).toBeGreaterThan(0);
  });

  it('منع الأرشفة: الرصيد السالب بكلامه، ومن غير علامة', () => {
    const [title, body] = walletBalanceBlockNotice('كارت', -300, plainAmount);
    expect(title).toBe('رصيدها لسه مش صفر');
    expect(body).toContain('رصيدها سالب 300 — حوّل فلوس ليها الأول عشان يبقى صفر');
    expect(body).not.toMatch(/-300/);
    const [, pos] = walletBalanceBlockNotice('كاش', 300, plainAmount);
    expect(pos).toContain('300 ج.م');
  });
  it('منع الأرشفة بيعدّي من money (الإخفاء)', () => {
    const [, body] = walletBalanceBlockNotice('كاش', 300, () => '••••');
    expect(body).toContain('••••');
    expect(body).not.toContain('300');
  });

  it('تأكيد الرصيد الابتدائي: «سالب X»، «من X لـY ج.م»، والفرق صفر', () => {
    expect(openingConfirmCopy('كاش', 100, -50).body).toContain('من 100 لـسالب 50 ج.م');
    expect(openingConfirmCopy('كاش', 100, -50).body).not.toMatch(/-50/);
    expect(openingConfirmCopy('كاش', 100, 100).body).toContain('الرقم نفسه ما اتغيّرش');
    expect(openingConfirmCopy('كاش', 100, 100).body).not.toContain('هيقل 0');
  });

  it('رقم مرفوض في المحفظة: اسم احتياطي لو مفيش اسم', () => {
    expect(walletAmountRejectNotice('حد التنبيه', '')[1]).toContain('للمحفظة دي');
    expect(walletAmountRejectNotice('حد التنبيه', '')[1]).not.toContain('""');
  });
  it('رقم مرفوض: كل سبب بكلامه', () => {
    expect(walletAmountRejectNotice('حد التنبيه', 'كاش', 'negative')[1]).toContain('من صفر وطالع');
    expect(walletAmountRejectNotice('الرصيد الابتدائي', 'كاش', 'too-large')[1]).toContain('أقل من');
    expect(walletAmountRejectNotice('حد التنبيه', 'كاش', 'negative')[0]).not.toBe('رصيد بالسالب؟');
  });

  it('التسوية: نسخة المسح، وجملة الممنوع', () => {
    expect(settleBody('قديمة', 100, true)).toContain('مسح العملية دي');
    expect(settleBody('قديمة', 100, false)).toContain('التعديل ده');
    expect(settleBlockedHint(true)).toContain('فالعملية ما اتمسحتش والرصيد زي ما هو.');
    expect(settleBlockedHint(false)).toContain('فالعملية ما اتعدّلتش والرصيد زي ما هو.');
  });

  it('تصدير الفترة', () => {
    expect(PERIOD_EXPORT_WAIT).toContain('وبياناتك توصل');
    expect(PERIOD_EXPORT_WAIT_OFFLINE).toContain('وبياناتك توصل');
    expect(PERIOD_EXPORT_LOAD_FAILED).toContain('جرّب تاني بعد شوية.');
    expect(UNSURE_COUNTED_NOTE).toContain('مكتوب قدامها');
    expect(UNSURE_COUNTED_NOTE).toContain('لحد ما الديون والجمعية توصل');
  });
});

describe('الأرقام', () => {
  it('الرصيد الابتدائي: سقف من فوق — مفيش Infinity في التأكيد', () => {
    expect(planWalletOpeningCommit('1e400', 0)).toEqual({ action: 'reject' });
    expect(planWalletOpeningCommit(String(WALLET_AMOUNT_MAX), 0)).toEqual({ action: 'reject' });
    expect(planWalletOpeningCommit('-' + String(WALLET_AMOUNT_MAX), 0)).toEqual({ action: 'reject' });
    expect(planWalletOpeningCommit('999999999999', 0)).toEqual({ action: 'confirm', value: 999999999999 });
    expect(WALLET_AMOUNT_MAX).toBeLessThan(1e18);
  });
  it('حد التنبيه: مفيش سالب، ومقرّب للقرش، ومبيسألش', () => {
    expect(planLowAlertCommit('-5', 0)).toEqual({ action: 'reject' });
    expect(planLowAlertCommit('10.004', 0)).toEqual({ action: 'write', value: 10 });
    expect(planLowAlertCommit('1e300', 0)).toEqual({ action: 'reject' });
    expect(planLowAlertCommit('500', 0)).toEqual({ action: 'write', value: 500 });
  });
  it('سبب الرفض', () => {
    expect(walletAmountRejectReason('-5')).toBe('negative');
    expect(walletAmountRejectReason('1e300')).toBe('too-large');
    expect(walletAmountRejectReason('abc')).toBe('invalid');
  });
});

describe('أيقونات الفئات بالعربي لقارئ الشاشة', () => {
  it('كل أيقونة ليها اسم عربي', () => {
    for (const ic of CATEGORY_ICONS) expect(CATEGORY_ICON_LABELS[ic]).toMatch(/[؀-ۿ]/);
    expect(categoryIconLabel('🚗')).toBe(CATEGORY_ICON_LABELS['🚗']);
    expect(categoryIconLabel('🦄')).toBe('أيقونة مخصصة');
  });
});
