import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react-native';
import BudgetView from '@/components/BudgetView';
import ShakhbataView from '@/components/ShakhbataView';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { AUTOSAVE_DELAY_MS, useAmountDrafts } from '@/lib/useAmountDrafts';
import {
  PERCENTS_NOT_READY_TITLE, PERCENTS_UNSAVED_TITLE, parseBudgetInput, parsePercentInput, parseWalletAmountInput, planBudgetCommit,
  planWalletOpeningCommit,
} from '@/lib/finance';
import { WRITE_ERROR_TITLE } from '@/lib/writeError';
import { snapshotTrusted } from '@/lib/listenerTrust';

/**
 * الميزة 6 — الجولة الأخيرة (money-reviewer + silent-failure-hunter على 32e811d). كل اختبار هنا اتكتب قبل التصليح
 * واتشاف أحمر. (`notice` من غير Provider بترجع لـ`Alert.alert` — عشان كده الـspy)
 */
const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));

const now = new Date();
const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

function setData(extra: Record<string, unknown> = {}) {
  for (const k of Object.keys(mockData)) delete mockData[k];
  Object.assign(mockData, {
    wallets: [], categories: [{ id: 'c1', name: 'أكل', bucket: 'needs' }], transactions: [], budgets: {},
    debts: [], gamiyas: [], loadErrors: [], figuresPending: [], percentsReady: true, budgetsReady: true, incomeReady: true,
    shakhbataIncome: {}, shakhbataPercents: { needs: 50, wants: 30, future: 20 },
    setBudget: jest.fn(async () => true), setMonthlyIncome: jest.fn(async () => true),
    setShakhbataPercents: jest.fn(async () => true), updateCategory: jest.fn(),
    ...extra,
  });
}
const wrap = (c: React.ReactNode) => <ThemeProvider><PrivacyProvider>{c}</PrivacyProvider></ThemeProvider>;
const alertCalls = () => (Alert.alert as unknown as jest.Mock).mock.calls;

beforeEach(() => { jest.spyOn(Alert, 'alert').mockImplementation(() => {}); });
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

describe('1 — مفيش كتابة فوق أرقام لسه ما اتشافتش', () => {
  it('snapshot فاضي من الكاش مش «وصل»؛ من السيرفر أو فيه بيانات = وصل', () => {
    expect(snapshotTrusted({ fromCache: true, hasData: false })).toBe(false);
    expect(snapshotTrusted({ fromCache: true, hasData: true })).toBe(true);
    expect(snapshotTrusted({ fromCache: false, hasData: false })).toBe(true);
  });

  it('السقوف لسه ما وصلتش ← خانات الميزانية مقفولة', async () => {
    setData({ budgetsReady: false });
    await render(wrap(<BudgetView />));
    expect(screen.getByLabelText('الميزانية الإجمالية الشهرية').props.editable).toBe(false);
    expect(screen.getByLabelText('سقف أكل').props.editable).toBe(false);
  });

  it('دخل الشهر لسه ما وصلش ← الخانة مقفولة', async () => {
    setData({ incomeReady: false });
    await render(wrap(<ShakhbataView />));
    expect(screen.getByLabelText(/^دخل شهر/).props.editable).toBe(false);
  });

  it('النسب بطّلت «جاهزة» وانت بتعدّل ← «حفظ النسب» مبيكتبش وبيقول', async () => {
    setData();
    const view = await render(wrap(<ShakhbataView />));
    await act(async () => { fireEvent.press(screen.getByLabelText('عدّل النسب')); });
    await act(async () => { fireEvent.changeText(screen.getByLabelText('نسبة احتياجات'), '60'); fireEvent.changeText(screen.getByLabelText('نسبة رفاهيات'), '20'); });
    setData({ percentsReady: false });
    await view.rerender(wrap(<ShakhbataView />));
    await act(async () => { fireEvent.press(screen.getByLabelText('حفظ النسب')); });
    expect(mockData.setShakhbataPercents).not.toHaveBeenCalled();
    expect(alertCalls().some(([title]) => title === PERCENTS_NOT_READY_TITLE)).toBe(true);
    expect(screen.getByLabelText('نسبة احتياجات').props.value).toBe('60');
  });
});

describe('2 — الفاصلة قبل رقم أو رقمين غامضة: مرفوضة مش متخمّنة', () => {
  it('الميزانية والدخل', () => {
    expect(parseBudgetInput('1,5')).toBeNull();
    expect(parseBudgetInput('12,5')).toBeNull();
    expect(parseBudgetInput('1,50')).toBeNull();
    expect(parseBudgetInput('١٬٥')).toBeNull();
    expect(parseBudgetInput('1,500')).toBe(1500);
    expect(parseBudgetInput('١٬٥٠٠٫٥')).toBe(1500.5);
  });

  it('النسبة', () => {
    expect(parsePercentInput('12,5')).toBeNull();
    expect(parsePercentInput('٣٣٫٥')).toBe(33.5);
  });

  it('المحفظة (الرصيد الابتدائي وحد التنبيه): الأرقام العربية والآلاف بتتقري، والغامض مرفوض', () => {
    expect(parseWalletAmountInput('٢٠٠٠')).toBe(2000);
    expect(parseWalletAmountInput('1,500')).toBe(1500);
    expect(parseWalletAmountInput('−500')).toBe(-500);
    expect(parseWalletAmountInput('1,5')).toBeNull();
    expect(planWalletOpeningCommit('1,5', 1000)).toEqual({ action: 'reject' });
  });
});

describe('3 — رسالة «النسب ما اتحفظتش» بس لو فيه تغيير فعلاً', () => {
  it('نسب قديمة 33.333: فتحت التعديل وخرجت من غير تغيير ← مفيش رسالة، والخانات مقرّبة', async () => {
    setData({ shakhbataPercents: { needs: 33.333, wants: 33.333, future: 33.334 } });
    const view = await render(wrap(<ShakhbataView />));
    await act(async () => { fireEvent.press(screen.getByLabelText('عدّل النسب')); });
    expect(screen.getByLabelText('نسبة احتياجات').props.value).toBe('33.33');
    await act(async () => { view.unmount(); });
    expect(alertCalls().some(([title]) => title === PERCENTS_UNSAVED_TITLE)).toBe(false);
  });

  it('النسب اتغيّرت من جهاز تاني وانت فاتح التعديل من غير ما تكتب ← مفيش رسالة', async () => {
    setData();
    const view = await render(wrap(<ShakhbataView />));
    await act(async () => { fireEvent.press(screen.getByLabelText('عدّل النسب')); });
    setData({ shakhbataPercents: { needs: 60, wants: 20, future: 20 } });
    await view.rerender(wrap(<ShakhbataView />));
    await act(async () => { view.unmount(); });
    expect(alertCalls().some(([title]) => title === PERCENTS_UNSAVED_TITLE)).toBe(false);
  });
});

describe('5 — الفاضي بعد التنضيف، والرقم اللي بيتقرّب لصفر', () => {
  it('«,» لوحدها مبتتحفظش صفر بعد ثانية', async () => {
    jest.useFakeTimers();
    const write = jest.fn();
    const view = await renderHook(() => useAmountDrafts(() => 1000, write, { plan: planBudgetCommit, blankWhenZero: true, autosaveBlank: false }));
    await act(async () => { view.result.current.onChange('c1', ','); });
    await act(async () => { jest.advanceTimersByTime(AUTOSAVE_DELAY_MS * 3); });
    expect(write).not.toHaveBeenCalled();
  });

  it('رقم مش صفر بيتقرّب لصفر مرفوض، و-0 بيتكتب 0 مش -0', () => {
    expect(parseBudgetInput('0.004')).toBeNull();
    expect(parseBudgetInput('-0.004')).toBeNull();
    expect(Object.is(parseBudgetInput('-0'), 0)).toBe(true);
    expect(parsePercentInput('0.004')).toBeNull();
    expect(Object.is(parsePercentInput('-0'), 0)).toBe(true);
  });
});

describe('6 — كتابة اترمت ووقعت بتتقال', () => {
  it('setBudget وقع ← رسالة «فيه تعديل ما اتحفظش»', async () => {
    jest.useFakeTimers();
    setData({ setBudget: jest.fn(async () => { throw new Error('boom'); }) });
    await render(wrap(<BudgetView />));
    await act(async () => { fireEvent.changeText(screen.getByLabelText('سقف أكل'), '500'); });
    await act(async () => { jest.advanceTimersByTime(AUTOSAVE_DELAY_MS + 10); });
    jest.useRealTimers();
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(alertCalls().some(([title]) => title === WRITE_ERROR_TITLE)).toBe(true);
  });

  it('setMonthlyIncome وقع ← نفس الرسالة', async () => {
    jest.useFakeTimers();
    setData({ setMonthlyIncome: jest.fn(async () => { throw new Error('boom'); }) });
    await render(wrap(<ShakhbataView />));
    await act(async () => { fireEvent.changeText(screen.getByLabelText(/^دخل شهر/), '5000'); });
    await act(async () => { jest.advanceTimersByTime(AUTOSAVE_DELAY_MS + 10); });
    jest.useRealTimers();
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(alertCalls().some(([title]) => title === WRITE_ERROR_TITLE)).toBe(true);
  });
});

describe('8 — خانة اتسابت فاضية واتحفظت صفر بتتقال', () => {
  it('سقف اتمسح وسبت الخانة ← «اتشال سقف "أكل"»', async () => {
    setData({ budgets: { c1: 1000 } });
    await render(wrap(<BudgetView />));
    const input = screen.getByLabelText('سقف أكل');
    await act(async () => { fireEvent.changeText(input, ''); });
    await act(async () => { fireEvent(input, 'blur'); });
    expect(mockData.setBudget).toHaveBeenCalledWith('c1', 0);
    expect(alertCalls().some(([title]) => title === 'اتشال سقف "أكل"')).toBe(true);
  });

  it('صفر مكتوب بإيدك ← مفيش رسالة', async () => {
    setData({ budgets: { c1: 1000 } });
    await render(wrap(<BudgetView />));
    const input = screen.getByLabelText('سقف أكل');
    await act(async () => { fireEvent.changeText(input, '0'); });
    await act(async () => { fireEvent(input, 'blur'); });
    expect(mockData.setBudget).toHaveBeenCalledWith('c1', 0);
    expect(alertCalls().some(([title]) => String(title).startsWith('اتشال'))).toBe(false);
  });

  it('الدخل اتمسح والشاشة اتشالت ← «اتشال الدخل»', async () => {
    setData({ shakhbataIncome: { [month]: 5000 } });
    const view = await render(wrap(<ShakhbataView />));
    await act(async () => { fireEvent.changeText(screen.getByLabelText(/^دخل شهر/), ''); });
    await act(async () => { view.unmount(); });
    expect(mockData.setMonthlyIncome).toHaveBeenCalledWith(month, 0);
    expect(alertCalls().some(([title]) => title === 'اتشال الدخل')).toBe(true);
  });
});
