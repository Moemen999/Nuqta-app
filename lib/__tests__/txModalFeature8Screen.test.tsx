import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import AddTransactionModal from '@/app/modal';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { warmUp } from '@/test-utils/warmUp';

/**
 * مراجعة التطبيق كله — الميزة 8: مودال العملية. قارئ المبلغ الواحد (المتخزّن = المعروض)، المحفظة لازم تكون شغالة وقت
 * الحفظ، تغيير النوع بيشيل الحقول القديمة، والوصولية (أسامي الخانات، الرسالة بتتمسح، "حذف" مش بيلف وقت الحفظ).
 */

let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));

const cash = { id: 'w1', name: 'كاش', openingBalance: 0, lowAlert: 0 };
const bank = { id: 'w2', name: 'بنك', openingBalance: 1000, lowAlert: 0 };
const freeTx = { id: 'tx_f', type: 'expense', amount: 50, walletId: 'w1', date: '2026-03-20', categoryId: 'c1' };
const moveTx = { id: 'tx_m', type: 'withdraw', amount: 30, walletId: 'w1', toWalletId: 'w2', date: '2026-03-20' };

function seed(extra: Record<string, unknown> = {}) {
  for (const k of Object.keys(mockData)) delete mockData[k];
  Object.assign(mockData, {
    wallets: [cash, bank], categories: [{ id: 'c1', name: 'أكل' }], transactions: [freeTx, moveTx], brokenTransactions: [],
    debts: [], subscriptions: [], gamiyas: [], incomes: [],
    linkSourcesReady: true, loadErrors: [], retryLoad: jest.fn(),
    addTransaction: jest.fn(async () => 'new_id'), updateTransaction: jest.fn(async () => {}), deleteTransaction: jest.fn(async () => ({ outcome: 'done' })),
    transactionLinkWarning: () => null, updateDebtLinkedTransaction: jest.fn(),
    ...extra,
  });
}

let announce: jest.SpyInstance;
beforeEach(() => {
  mockParams = {}; seed(); (router.back as jest.Mock).mockClear();
  announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  announce.mockClear();
});
afterEach(() => announce.mockRestore());

const ui = () => <ThemeProvider><PrivacyProvider><AddTransactionModal /></PrivacyProvider></ThemeProvider>;
warmUp(() => { seed(); return ui(); });

async function open(id?: string) {
  mockParams = id ? { id } : {};
  const r = await render(ui());
  await act(async () => {});
  return r;
}
const type = (v: string) => act(async () => { fireEvent.changeText(screen.getByTestId('tx_amount_input'), v); });
const save = () => act(async () => { fireEvent.press(screen.getByTestId('tx_save_button')); });
const errorText = () => screen.queryByTestId('tx_error')?.props.children;

describe('M: قارئ واحد للمبلغ', () => {
  it('«1,5» ← مرفوض برسالة الكسر (مش 15 ساكت)', async () => {
    await open();
    await type('1,5');
    await save();
    expect(mockData.addTransaction).not.toHaveBeenCalled();
    expect(errorText()).toBe('الكسر بنقطة (1.5) مش بفاصلة');
  });

  it('«1,500» و«٢٠٠» ← بيتقروا (كانوا NaN ومرفوضين)', async () => {
    await open();
    await type('1,500');
    await save();
    expect(mockData.addTransaction).toHaveBeenCalledWith(expect.objectContaining({ amount: 1500 }), { durable: true });
  });

  it('التعديل بيتحفظ بالمقرّب، والمعاينة بنفس الرقم', async () => {
    await open('tx_f');
    await type('٢٠٠٫٠٠٤');
    // المعاينة (قبل كده `Number("٢٠٠٫٠٠٤")` = NaN ← مفيش معاينة): من -30 (التحويل) إلى -230 بالمقرّب
    expect(screen.getByLabelText(/^كاش، من -30 إلى -230 جنيه$/)).toBeTruthy();
    await save();
    expect(mockData.updateTransaction).toHaveBeenCalledWith('tx_f', expect.objectContaining({ amount: 200 }), []);
  });

  it('رسايل منفصلة: المبلغ لوحده', async () => {
    await open();
    await type('');
    await save();
    expect(errorText()).toBe('اكتب مبلغ أكبر من صفر');
  });

  it('الرسالة بتتمسح أول ما يكتب', async () => {
    await open();
    await save();
    expect(errorText()).toBe('اكتب مبلغ أكبر من صفر');
    await type('5');
    expect(screen.queryByTestId('tx_error')).toBeNull();
  });
});

describe('M: المحفظة لازم تكون شغالة وقت الحفظ', () => {
  it('المحفظة اتأرشفت والفورم مفتوح ← مفيش حفظ، والرسالة باسمها', async () => {
    const r = await open();
    await type('100');
    mockData.wallets = [{ ...cash, archived: true }, bank];
    await r.rerender(ui());
    await save();
    expect(mockData.addTransaction).not.toHaveBeenCalled();
    expect(errorText()).toContain('محفظة "كاش"');
  });

  it('وجهة التحويل اتمسحت ← مفيش حفظ', async () => {
    const r = await open('tx_m');
    mockData.wallets = [cash];
    await r.rerender(ui());
    await save();
    expect(mockData.updateTransaction).not.toHaveBeenCalled();
    expect(errorText()).toMatch(/مبقتش شغالة/);
  });
});

it('L: تغيير النوع في التعديل (تحويل ← مصروف) بيشيل الوجهة', async () => {
  await open('tx_m');
  await act(async () => { fireEvent.press(screen.getByTestId('tx_type_expense')); });
  await save();
  expect(mockData.updateTransaction).toHaveBeenCalledWith('tx_m', expect.objectContaining({ type: 'expense' }), [], { clear: ['toWalletId'] });
});

it('L: مصروف ← دخل بيشيل الفئة', async () => {
  await open('tx_f');
  await act(async () => { fireEvent.press(screen.getByTestId('tx_type_income')); });
  await save();
  expect(mockData.updateTransaction).toHaveBeenCalledWith('tx_f', expect.objectContaining({ type: 'income' }), [], { clear: ['toWalletId', 'categoryId'] });
});

describe('الوصولية', () => {
  it('أسامي الخانات والتاريخ', async () => {
    await open();
    const amt = screen.getByTestId('tx_amount_input');
    expect(amt.props.accessibilityLabel).toBe('المبلغ');
    expect(amt.props.accessibilityHint).toBe('رقم بالجنيه');
    expect(screen.getByLabelText('ملاحظة')).toBeTruthy();
    const date = screen.getByTestId('tx_date_button');
    expect(date.props.accessibilityLabel).toMatch(/^التاريخ، /);
    expect(date.props.accessibilityHint).toBe('يفتح التقويم');
  });

  it('«حذف» مش بيلف وقت الحفظ، وبيتقفل', async () => {
    let finish: () => void = () => {};
    (mockData.updateTransaction as jest.Mock).mockImplementation(() => new Promise<void>(r => { finish = r; }));
    await open('tx_f');
    await type('60');
    await save();
    const del = screen.getByTestId('tx_delete_button');
    expect(del.props.accessibilityState).toMatchObject({ busy: false, disabled: true });
    await act(async () => { finish(); });
  });

  it('الحفظ بيتقال قبل الرجوع', async () => {
    await open();
    await type('10');
    await save();
    expect(announce).toHaveBeenCalledWith('اتسجلت');
  });
});
