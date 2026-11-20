import { parseBudgetInput, parsePercentInput, planBudgetCommit, planIncomeCommit } from '@/lib/finance';
import { AUTOSAVE_DELAY_MS, useAmountDrafts } from '@/lib/useAmountDrafts';
import { budgetDismissKey, buildAttentionItems, type AttentionInput } from '@/lib/homeAttention';
import { budgetForecastText } from '@/lib/budgetForecast';
import { requestPlanning, takePlanningRequest } from '@/lib/planningRequest';
import { act, renderHook } from '@testing-library/react-native';

/**
 * مراجعة التطبيق كله — الميزة 6 (الميزانية وتوزيع الدخل). كل اختبار هنا اتكتب **قبل** التصليح واتشاف أحمر:
 * - «٢٠٠٠» و«1,500» كانوا بيترفضوا ساكت (الخانة بترجع للمحفوظ من غير كلمة) — نفس الكيبورد العربي اللي
 *   أول شاشة بتقبله (`normalizeAmountInput`)
 * - مسح السقف عشان تكتبه من جديد كان بيتحفظ صفر بعد ثانية والكارت ينط للمطوي
 * - نسبة فاضية كانت بتتحسب صفر
 * - ✕ على بانر ميزانية الشهر ده كان بيخبّي تعدّي الشهر الجاي (المفتاح من غير شهر)
 */

describe('خانات الفلوس بتقبل اللي الكيبورد العربي بيكتبه', () => {
  it('الأرقام العربية والفواصل والمسافات', () => {
    expect(parseBudgetInput('٢٠٠٠')).toBe(2000);
    expect(parseBudgetInput('1,500')).toBe(1500);
    expect(parseBudgetInput('١٬٥٠٠٫٥')).toBe(1500.5);
    expect(parseBudgetInput(' 700 ')).toBe(700);
  });

  it('بيتقرّب للقرش — الرقم اللي بيتخزّن هو اللي بيتعرض', () => {
    expect(parseBudgetInput('12.345')).toBe(12.35);
    expect(planIncomeCommit('8000.004', 8000)).toEqual({ action: 'none' });
  });

  it('السالب (حتى بعلامة الطرح العربية) واللي يطلع لانهاية بعد التقريب مرفوضين', () => {
    expect(parseBudgetInput('−500')).toBeNull();
    expect(parseBudgetInput('-500')).toBeNull();
    expect(parseBudgetInput('1e307')).toBeNull();
  });

  it('النسبة: أرقام عربية، والفاضي غلط مش صفر، وبتتقرّب لرقمين بعد العلامة', () => {
    expect(parsePercentInput('٥٠')).toBe(50);
    expect(parsePercentInput('')).toBeNull();
    expect(parsePercentInput('  ')).toBeNull();
    expect(parsePercentInput('33.333')).toBe(33.33);
  });
});

type Store = Record<string, number>;
async function setupBudget(initial: Store, extra: { onReject?: jest.Mock; onDroppedReject?: jest.Mock } = {}) {
  const store: Store = { ...initial };
  const write = jest.fn((id: string, value: number) => { store[id] = value; });
  const view = await renderHook(() => useAmountDrafts(id => store[id] ?? 0, write, {
    plan: planBudgetCommit, blankWhenZero: true, autosaveBlank: false, ...extra,
  }));
  return { view, write };
}

describe('useAmountDrafts — الفاضي والرفض', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.runOnlyPendingTimers(); jest.useRealTimers(); });

  it('مسح الخانة عشان تكتب من جديد: مفيش حفظ صفر بعد ثانية — بس الخروج بيمسح', async () => {
    const { view, write } = await setupBudget({ c1: 1000 });
    await act(async () => { view.result.current.onChange('c1', ''); });
    await act(async () => { jest.advanceTimersByTime(AUTOSAVE_DELAY_MS * 3); });
    expect(write).not.toHaveBeenCalled();
    await act(async () => { view.result.current.onBlur('c1'); });
    expect(write).toHaveBeenCalledWith('c1', 0);
  });

  it('رقم مرفوض عند الخروج من الخانة بيتقال (onReject) مش بيرجع ساكت', async () => {
    const onReject = jest.fn();
    const { view, write } = await setupBudget({ c1: 1000 }, { onReject });
    await act(async () => { view.result.current.onChange('c1', '-500'); });
    await act(async () => { view.result.current.onBlur('c1'); });
    expect(write).not.toHaveBeenCalled();
    expect(onReject).toHaveBeenCalledWith('c1');
  });

  it('رقم مرفوض والشاشة اتشالت بيتقال (onDroppedReject)', async () => {
    const onDroppedReject = jest.fn();
    const { view, write } = await setupBudget({ c1: 1000 }, { onDroppedReject });
    await act(async () => { view.result.current.onChange('c1', 'abc'); });
    await act(async () => { view.unmount(); });
    expect(write).not.toHaveBeenCalled();
    expect(onDroppedReject).toHaveBeenCalledWith('c1');
  });
});

describe('بانر الميزانية في الرئيسية', () => {
  const base = (spent: number) => ({
    spendKnown: true, nowMonth: '2026-11', transfers: new Set(), money: (n: number) => n.toLocaleString('en-US'),
    activeCategories: [{ id: 'c1', name: 'الأكل' }], budgets: { c1: 1000 }, activeWallets: [], balances: new Map(), subscriptions: [], gamiyas: [],
    transactions: [{ id: 'a', type: 'expense', amount: spent, date: '2026-11-03', walletId: 'w', categoryId: 'c1' }],
  } as unknown as AttentionInput);

  it('مفتاح الـ✕ فيه الشهر — قفل تعدّي الشهر ده ميخبّيش الشهر الجاي', () => {
    expect(budgetDismissKey('c1', '2026-11', 'over')).toBe('c1:2026-11:over');
    expect(budgetDismissKey('c1', '2026-12', 'over')).not.toBe(budgetDismissKey('c1', '2026-11', 'over'));
    expect(buildAttentionItems(base(1200))[0].instance).toBe('c1:2026-11:over');
  });

  it('الكلام من غير شرطة مايلة', () => {
    expect(buildAttentionItems(base(1200))[0].text).toBe('عدّيت ميزانية الأكل (1,200 من 1,000)');
    expect(buildAttentionItems(base(850))[0].text).toBe('ميزانية الأكل قربت تخلص (850 من 1,000)');
    expect(buildAttentionItems(base(1000))[0].text).toBe('ميزانية الأكل خلصت (1,000 من 1,000)');
  });
});

describe('التوقع', () => {
  it('كارت الفئة بيقول «ميزانية الفئة دي»، والإجمالي زي ما هو', () => {
    expect(budgetForecastText(20, '2026-11-10', 'category')).toBe('لو كمّلت بنفس المعدل، ميزانية الفئة دي هتخلص يوم 20 نوفمبر');
    expect(budgetForecastText(20, '2026-11-10')).toBe('لو كمّلت بنفس المعدل، الميزانية هتخلص يوم 20 نوفمبر');
  });
});

describe('بانر الميزانية بيفتح تاب الميزانية الفرعي', () => {
  it('طلب واحد بيتاخد مرة ويتمسح', () => {
    requestPlanning('budget');
    expect(takePlanningRequest()).toBe('budget');
    expect(takePlanningRequest()).toBeNull();
  });
});
