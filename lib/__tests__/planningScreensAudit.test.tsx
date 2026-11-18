import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import BudgetView from '@/components/BudgetView';
import ShakhbataView from '@/components/ShakhbataView';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { AUTOSAVE_DELAY_MS } from '@/lib/useAmountDrafts';
import { PERCENTS_UNSAVED_TITLE } from '@/lib/finance';

/**
 * مراجعة التطبيق كله — الميزة 6 على الشاشتين نفسهم. اتكتبوا قبل التصليح واتشافوا أحمر.
 * (الرسايل `notice`/`confirm` من غير Provider بترجع لـ`Alert.alert` — عشان كده الـspy)
 */
const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));

const now = new Date();
const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
const day1 = `${month}-01`;

function setData(extra: Record<string, unknown> = {}) {
  for (const k of Object.keys(mockData)) delete mockData[k];
  Object.assign(mockData, {
    wallets: [], categories: [{ id: 'c1', name: 'أكل', bucket: 'needs' }], transactions: [], budgets: {},
    debts: [], gamiyas: [], loadErrors: [], figuresPending: [], percentsReady: true,
    shakhbataIncome: {}, shakhbataPercents: { needs: 50, wants: 30, future: 20 },
    setBudget: jest.fn(async () => true), setMonthlyIncome: jest.fn(async () => true),
    setShakhbataPercents: jest.fn(async () => true), updateCategory: jest.fn(),
    ...extra,
  });
}

const wrap = (c: React.ReactNode) => <ThemeProvider><PrivacyProvider>{c}</PrivacyProvider></ThemeProvider>;
/** النص كله جوه عنصر (نص متداخل زي `<Money>`) */
const textOf = (n: unknown): string => {
  if (n == null || typeof n === 'boolean') return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(textOf).join('');
  return textOf((n as { props?: { children?: unknown } }).props?.children);
};
const alertCalls = () => (Alert.alert as unknown as jest.Mock).mock.calls;

beforeEach(() => { jest.spyOn(Alert, 'alert').mockImplementation(() => {}); });
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

describe('الميزانية', () => {
  it('«٢٠٠٠» بيتحفظ 2000 بعد ثانية (كان بيترفض ساكت)', async () => {
    jest.useFakeTimers();
    setData();
    await render(wrap(<BudgetView />));
    await act(async () => { fireEvent.changeText(screen.getByLabelText('سقف أكل'), '٢٠٠٠'); });
    await act(async () => { jest.advanceTimersByTime(AUTOSAVE_DELAY_MS + 10); });
    expect(mockData.setBudget).toHaveBeenCalledWith('c1', 2000);
  });

  it('رقم مرفوض بيتقال بالاسم بدل ما يرجع ساكت', async () => {
    setData({ budgets: { c1: 1000 } });
    await render(wrap(<BudgetView />));
    const input = screen.getByLabelText('سقف أكل');
    await act(async () => { fireEvent.changeText(input, '-500'); });
    await act(async () => { fireEvent(input, 'blur'); });
    expect(mockData.setBudget).not.toHaveBeenCalled();
    expect(alertCalls().some(([, body]) => /سقف "أكل" لازم يكون رقم من صفر وطالع/.test(String(body)))).toBe(true);
  });

  it('مسح السقف: مفيش صفر بيتحفظ بعد ثانية والكارت مبيتنقلش للمطوي', async () => {
    jest.useFakeTimers();
    setData({ budgets: { c1: 1000 }, categories: [{ id: 'c1', name: 'أكل' }, { id: 'c2', name: 'مواصلات' }] });
    await render(wrap(<BudgetView />));
    const input = screen.getByLabelText('سقف أكل');
    await act(async () => { fireEvent(input, 'focus'); fireEvent.changeText(input, ''); });
    await act(async () => { jest.advanceTimersByTime(AUTOSAVE_DELAY_MS * 3); });
    expect(mockData.setBudget).not.toHaveBeenCalled();
    // لسه برّه المطوي (المطوي مقفول ← خانة مواصلات مش ظاهرة، وخانة أكل ظاهرة)
    expect(screen.getByLabelText('سقف أكل')).toBeTruthy();
    await act(async () => { fireEvent(screen.getByLabelText('سقف أكل'), 'blur'); });
    expect(mockData.setBudget).toHaveBeenCalledWith('c1', 0);
  });

  it('الكلام بتاع المتبقي للتوزيع والزيادة بالعملة', async () => {
    setData({ budgets: { total_budget: 1000, c1: 1200 } });
    await render(wrap(<BudgetView />));
    expect(screen.getByText('الفئات زوّدت عن الإجمالي بـ 200 ج.م')).toBeTruthy();
    setData({ budgets: { total_budget: 1000, c1: 400 } });
    await render(wrap(<BudgetView />));
    expect(screen.getByText('متبقي للتوزيع: 600 ج.م')).toBeTruthy();
  });

  it('قربت تخلص على الإجمالي بالكلام', async () => {
    setData({ budgets: { total_budget: 1000 }, transactions: [{ id: 't', type: 'expense', amount: 850, date: day1, walletId: 'w', categoryId: 'c1' }] });
    await render(wrap(<BudgetView />));
    expect(screen.getByTestId('budget_total_level').props.children).toBe('فاضل 150 ج.م — قربت تخلص');
  });

  it('الميزانيات ما وصلتش ← سطر بيقول، والخانات مقفولة (مفيش كتابة فوق أرقام مش شايفها)', async () => {
    setData({ budgets: {}, loadErrors: ['budgets'] });
    await render(wrap(<BudgetView />));
    expect(screen.getByTestId('budget_load_error')).toBeTruthy();
    expect(screen.getByLabelText('الميزانية الإجمالية الشهرية').props.editable).toBe(false);
  });

  it('العمليات لسه ما وصلتش ← «بنحمّل» مش صفر', async () => {
    setData({ budgets: { total_budget: 1000 }, figuresPending: ['transactions'] });
    await render(wrap(<BudgetView />));
    expect(screen.getByTestId('budget_total_loading')).toBeTruthy();
  });

  it('مفيش فئات ← جملة بتقول تعمل إيه', async () => {
    setData({ categories: [] });
    await render(wrap(<BudgetView />));
    expect(screen.getByText('مفيش فئات لسه — ضيف فئة من الإعدادات ← الفئات')).toBeTruthy();
  });

  it('كارت الفئة ليه وصف واحد لقارئ الشاشة', async () => {
    setData({ budgets: { c1: 1000 }, transactions: [{ id: 't', type: 'expense', amount: 850, date: day1, walletId: 'w', categoryId: 'c1' }] });
    await render(wrap(<BudgetView />));
    expect(screen.getByLabelText('فئة أكل: صرفت 850 ج.م من 1,000 ج.م، قرّبت تخلص')).toBeTruthy();
  });
});

describe('توزيع الدخل', () => {
  it('النسب لسه ما وصلتش أو اترفضت ← «عدّل النسب» مقفول وفيه سطر', async () => {
    setData({ percentsReady: false });
    await render(wrap(<ShakhbataView />));
    expect(screen.getByLabelText('عدّل النسب').props.accessibilityState).toMatchObject({ disabled: true });
    setData({ percentsReady: false, loadErrors: ['shakhbata_settings'] });
    await render(wrap(<ShakhbataView />));
    expect(screen.getByTestId('shakhbata_load_error')).toBeTruthy();
  });

  it('زرار إلغاء بيرجّع النسب المحفوظة', async () => {
    setData();
    await render(wrap(<ShakhbataView />));
    await act(async () => { fireEvent.press(screen.getByLabelText('عدّل النسب')); });
    await act(async () => { fireEvent.changeText(screen.getByLabelText('نسبة احتياجات'), '70'); });
    await act(async () => { fireEvent.press(screen.getByLabelText('إلغاء تعديل النسب')); });
    expect(screen.queryByLabelText('نسبة احتياجات')).toBeNull();
    expect(mockData.setShakhbataPercents).not.toHaveBeenCalled();
  });

  it('تعديل ما اتحفظش والشاشة اتشالت ← رسالة', async () => {
    setData();
    const view = await render(wrap(<ShakhbataView />));
    await act(async () => { fireEvent.press(screen.getByLabelText('عدّل النسب')); });
    await act(async () => { fireEvent.changeText(screen.getByLabelText('نسبة احتياجات'), '70'); });
    await act(async () => { view.unmount(); });
    expect(alertCalls().some(([title]) => title === PERCENTS_UNSAVED_TITLE)).toBe(true);
  });

  it('نسبة فاضية مش صفر — الحفظ بيقف ويسمّيها', async () => {
    setData();
    await render(wrap(<ShakhbataView />));
    await act(async () => { fireEvent.press(screen.getByLabelText('عدّل النسب')); });
    await act(async () => { fireEvent.changeText(screen.getByLabelText('نسبة احتياجات'), ''); });
    await act(async () => { fireEvent.press(screen.getByLabelText('حفظ النسب')); });
    expect(mockData.setShakhbataPercents).not.toHaveBeenCalled();
  });

  it('الحفظ ما اتمش (مفيش حساب) ← المسوّدة بتفضل', async () => {
    setData({ setShakhbataPercents: jest.fn(async () => false) });
    await render(wrap(<ShakhbataView />));
    await act(async () => { fireEvent.press(screen.getByLabelText('عدّل النسب')); });
    await act(async () => { fireEvent.changeText(screen.getByLabelText('نسبة احتياجات'), '60'); fireEvent.changeText(screen.getByLabelText('نسبة رفاهيات'), '20'); });
    await act(async () => { fireEvent.press(screen.getByLabelText('حفظ النسب')); });
    expect(screen.getByLabelText('نسبة احتياجات')).toBeTruthy();
  });

  it('مجموع النسب بيتعرض مقرّب', async () => {
    setData();
    await render(wrap(<ShakhbataView />));
    await act(async () => { fireEvent.press(screen.getByLabelText('عدّل النسب')); });
    await act(async () => {
      fireEvent.changeText(screen.getByLabelText('نسبة احتياجات'), '10.1');
      fireEvent.changeText(screen.getByLabelText('نسبة رفاهيات'), '20.2');
      fireEvent.changeText(screen.getByLabelText('نسبة خطط مستقبلية'), '30.3');
    });
    expect(screen.getByTestId('shakhbata_sum_warn').props.children).toBe('مجموع النسب دلوقتي 60.6% — الأحسن يبقى 100%، بس تقدر تسيبه كده لو ده قصدك');
  });

  it('القسم: الصرف = المخطط «خلص» (دهبي)، ونسبة صفر وفيه صرف «عدّى»', async () => {
    setData({
      shakhbataIncome: { [month]: 1000 }, shakhbataPercents: { needs: 50, wants: 0, future: 50 },
      categories: [{ id: 'c1', name: 'أكل', bucket: 'needs' }, { id: 'c2', name: 'خروج', bucket: 'wants' }],
      transactions: [
        { id: 't1', type: 'expense', amount: 500, date: day1, walletId: 'w', categoryId: 'c1' },
        { id: 't2', type: 'expense', amount: 30, date: day1, walletId: 'w', categoryId: 'c2' },
      ],
    });
    await render(wrap(<ShakhbataView />));
    expect(textOf(screen.getByTestId('shakhbata_spend_needs'))).toMatch(/^خلص — /);
    expect(textOf(screen.getByTestId('shakhbata_spend_wants'))).toMatch(/^عدّى — /);
    expect(textOf(screen.getByTestId('shakhbata_spend_wants'))).toMatch(/زيادة 30 ج\.م/);
  });

  it('مفيش دخل ← جملة بتقول اكتبه والنسب', async () => {
    setData();
    await render(wrap(<ShakhbataView />));
    expect(screen.getByText('اكتب دخل الشهر فوق عشان نوزّعه على النسب: احتياجات 50% · رفاهيات 30% · خطط مستقبلية 20%')).toBeTruthy();
  });

  it('الدخل المرفوض بيتقال', async () => {
    setData();
    await render(wrap(<ShakhbataView />));
    const input = screen.getByLabelText(/^دخل شهر/);
    await act(async () => { fireEvent.changeText(input, 'abc'); });
    await act(async () => { fireEvent(input, 'blur'); });
    expect(alertCalls().some(([, body]) => /الدخل لازم يكون رقم من صفر وطالع/.test(String(body)))).toBe(true);
  });

  it('مفيش فئات ← جملة بتقول تعمل إيه', async () => {
    setData({ categories: [] });
    await render(wrap(<ShakhbataView />));
    expect(screen.getByText('مفيش فئات لسه — ضيف فئة من الإعدادات ← الفئات')).toBeTruthy();
  });
});
