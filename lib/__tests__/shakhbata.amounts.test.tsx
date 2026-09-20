import {
  PERCENT_MAX,
  PERCENT_MIN,
  parsePercentInput,
  percentInvalidBody,
  percentInvalidTitle,
  planBudgetCommit,
  planIncomeCommit,
} from '@/lib/finance';
import { AUTOSAVE_DELAY_MS, useAmountDrafts } from '@/lib/useAmountDrafts';
import { act, renderHook } from '@testing-library/react-native';

/**
 * الباگ اللي الملف ده موجود عشانه: خانة دخل شخبطة كانت `Number(raw) || 0`
 * مع حفظ تلقائي بعد ثانية **من غير ما يستنى الخروج من الخانة** — فنص رقم
 * أو لصقة غلط كانت بتكتب صفر لوحدها وتصفّر أهداف الشهر كله.
 *
 * نفس الباگ اتصلح في المحافظ قبل كده وعاش هنا لأن الكود كان متكرر تلات
 * مرات. فالاختبار الأساسي هنا اسمه بالحرف: "الحفظ التلقائي عمره ما بيكتب صفر".
 */

type Store = Record<string, number>;

async function setupIncome(initial: Store) {
  const store: Store = { ...initial };
  const write = jest.fn((id: string, value: number) => { store[id] = value; });
  const view = await renderHook(() =>
    useAmountDrafts(id => store[id] ?? 0, write, { plan: planIncomeCommit, blankWhenZero: true })
  );
  return { view, write, store };
}

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.runOnlyPendingTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });

describe('parsePercentInput — النسبة لازم تكون من 0 لـ100', () => {
  it('بيقبل الطرفين والكسور', () => {
    expect(parsePercentInput('0')).toBe(PERCENT_MIN);
    expect(parsePercentInput('100')).toBe(PERCENT_MAX);
    expect(parsePercentInput('50')).toBe(50);
    expect(parsePercentInput('33.5')).toBe(33.5);
  });

  it('الفاضي بصفر — ده الطريقة الطبيعية لمسح الخانة', () => {
    expect(parsePercentInput('')).toBe(0);
    expect(parsePercentInput('   ')).toBe(0);
  });

  it('بيرفض اللي برّه المدى بدل ما يقصّه', () => {
    expect(parsePercentInput('101')).toBeNull();
    expect(parsePercentInput('100.01')).toBeNull();
    expect(parsePercentInput('-1')).toBeNull();
    expect(parsePercentInput('-0.5')).toBeNull();
  });

  it('بيرفض الكلام واللانهاية — ومبيحوّلهمش لصفر', () => {
    expect(parsePercentInput('نص')).toBeNull();
    expect(parsePercentInput('abc')).toBeNull();
    expect(parsePercentInput('50%')).toBeNull();
    expect(parsePercentInput('Infinity')).toBeNull();
    expect(parsePercentInput('-Infinity')).toBeNull();
  });
});

describe('planIncomeCommit — دخل الشهر', () => {
  it('مفيش مسوّدة = مفيش كتابة', () => {
    expect(planIncomeCommit(undefined, 8000)).toEqual({ action: 'none' });
  });

  it('نفس الرقم المحفوظ = مفيش كتابة', () => {
    expect(planIncomeCommit('8000', 8000)).toEqual({ action: 'none' });
  });

  it('رقم جديد بيتكتب', () => {
    expect(planIncomeCommit('9500', 8000)).toEqual({ action: 'write', value: 9500 });
  });

  it('الكلام اللي مش رقم مترفوض — مش متحوّل لصفر', () => {
    expect(planIncomeCommit('تمن تلاف', 8000)).toEqual({ action: 'reject' });
    expect(planIncomeCommit('abc', 8000)).toEqual({ action: 'reject' });
  });

  it('الدخل السالب مترفوض من غير سؤال — مش زي رصيد المحفظة', () => {
    expect(planIncomeCommit('-500', 8000)).toEqual({ action: 'reject' });
  });

  it('الفاضي بيمسح الدخل لصفر عن قصد', () => {
    expect(planIncomeCommit('', 8000)).toEqual({ action: 'write', value: 0 });
  });

  it('planBudgetCommit بنفس القواعد بالظبط', () => {
    expect(planBudgetCommit('-1', 500)).toEqual({ action: 'reject' });
    expect(planBudgetCommit('700', 500)).toEqual({ action: 'write', value: 700 });
    expect(planBudgetCommit(undefined, 500)).toEqual({ action: 'none' });
  });
});

describe('الحفظ التلقائي عمره ما بيكتب صفر', () => {
  it('كلام مش رقم + عدّت الثانية = مفيش كتابة خالص', async () => {
    const { view, write } = await setupIncome({ '2026-09': 8000 });
    await act(() => { view.result.current.onChange('2026-09', 'تمانية'); });
    await act(() => { jest.advanceTimersByTime(AUTOSAVE_DELAY_MS + 50); });
    expect(write).not.toHaveBeenCalled();
  });

  it('رقم سالب + عدّت الثانية = مفيش كتابة (الدخل مبيبقاش سالب)', async () => {
    const { view, write } = await setupIncome({ '2026-09': 8000 });
    await act(() => { view.result.current.onChange('2026-09', '-3'); });
    await act(() => { jest.advanceTimersByTime(AUTOSAVE_DELAY_MS + 50); });
    expect(write).not.toHaveBeenCalled();
  });

  it('نص رقم وانت لسه بتكتب مبيتكتبش صفر', async () => {
    const { view, write } = await setupIncome({ '2026-09': 8000 });
    await act(() => { view.result.current.onChange('2026-09', '-'); });
    await act(() => { jest.advanceTimersByTime(AUTOSAVE_DELAY_MS + 50); });
    expect(write).not.toHaveBeenCalled();
  });

  it('الشاشة تتشال والمسوّدة غلط = مفيش كتابة صفر ورا ضهر المستخدم', async () => {
    const { view, write } = await setupIncome({ '2026-09': 8000 });
    await act(() => { view.result.current.onChange('2026-09', 'abc'); });
    await view.unmount();
    expect(write).not.toHaveBeenCalled();
  });

  it('رقم صحيح بيتحفظ لوحده بعد ثانية', async () => {
    const { view, write } = await setupIncome({ '2026-09': 8000 });
    await act(() => { view.result.current.onChange('2026-09', '9000'); });
    await act(() => { jest.advanceTimersByTime(AUTOSAVE_DELAY_MS + 50); });
    expect(write).toHaveBeenCalledWith('2026-09', 9000);
  });

  it('الصفر بيتكتب لما المستخدم يقصده فعلاً (خانة فاضية)', async () => {
    const { view, write } = await setupIncome({ '2026-09': 8000 });
    await act(() => { view.result.current.onChange('2026-09', ''); });
    await act(() => { jest.advanceTimersByTime(AUTOSAVE_DELAY_MS + 50); });
    expect(write).toHaveBeenCalledWith('2026-09', 0);
  });
});

describe('numberFor — المعاينة الحيّة مبتديش صفر', () => {
  it('مسوّدة غلط بتوري المحفوظ مش صفر', async () => {
    const { view } = await setupIncome({ '2026-09': 8000 });
    await act(() => { view.result.current.onChange('2026-09', 'abc'); });
    expect(view.result.current.numberFor('2026-09', 8000)).toBe(8000);
  });

  it('مسوّدة صح بتوري الرقم الجديد على طول', async () => {
    const { view } = await setupIncome({ '2026-09': 8000 });
    await act(() => { view.result.current.onChange('2026-09', '12000'); });
    expect(view.result.current.numberFor('2026-09', 8000)).toBe(12000);
  });
});

describe('valueFor + blankWhenZero', () => {
  it('صفر محفوظ بيتعرض خانة فاضية في الدخل والميزانية', async () => {
    const { view } = await setupIncome({});
    expect(view.result.current.valueFor('2026-09', 0)).toBe('');
  });

  it('رصيد محفظة بصفر لسه بيتعرض "0" (السلوك الافتراضي ما اتغيرش)', async () => {
    const write = jest.fn();
    const view = await renderHook(() => useAmountDrafts(() => 0, write));
    expect(view.result.current.valueFor('w1', 0)).toBe('0');
  });
});

describe('رسالة النسبة الغلط', () => {
  it('واحدة', () => {
    expect(percentInvalidTitle(1)).toBe('نسبة مش مظبوطة');
    expect(percentInvalidBody(['احتياجات'])).toBe('احتياجات لازم تكون رقم من 0 لـ100. صلّح وحاول تاني.');
  });

  it('اتنين', () => {
    expect(percentInvalidTitle(2)).toBe('نسب مش مظبوطة');
    expect(percentInvalidBody(['احتياجات', 'رفاهيات']))
      .toBe('احتياجات ورفاهيات لازم يكونوا رقم من 0 لـ100. صلّح وحاول تاني.');
  });

  it('تلاتة', () => {
    expect(percentInvalidBody(['احتياجات', 'رفاهيات', 'خطط مستقبلية']))
      .toBe('احتياجات، رفاهيات وخطط مستقبلية لازم يكونوا رقم من 0 لـ100. صلّح وحاول تاني.');
  });
});
