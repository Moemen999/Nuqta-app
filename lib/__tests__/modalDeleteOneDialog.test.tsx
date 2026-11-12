import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import AddTransactionModal from '@/app/modal';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { warmUp } from '@/test-utils/warmUp';

/**
 * D3 (بند 8): مسح عملية من المودال = **حوار واحد** مش اتنين فوق بعض.
 * - مفيش محفظة مؤرشفة هتتأثر ← `Alert` واحد 'حذف العملية' فيه سطر العدد
 * - فيه مؤرشفة ← مفيش `Alert`: شيت التسوية نفسها بتسأل "متأكد؟" وبتعرض التحذير
 *   وسطر العدد، وزرارها 'حذف' مش 'احفظ'
 * - فيه مؤرشفة ومفيش ولا شغالة ← شيت الممنوع من غير سؤال "متأكد؟"
 * الشيت الحقيقية (مش متمثّلة)؛ المحافظ في `useData` المتمثّل.
 */

let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/lib/atomicFailure', () => ({ reportAtomicFailure: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));

const LINK = 'دي دفعة في دين "صاحبي" — هتتشال من الدين كمان.';
const COUNT_LINE = 'عدد الأقساط هيرجع 12 بدل 10.';
const WARNING = `${LINK}\n${COUNT_LINE}`;
const QUESTION = 'متأكد إنك عايز تمسحها؟';

const archived = { id: 'a', name: 'مؤرشفة', openingBalance: 0, lowAlert: 0, archived: true };
const active = { id: 'w', name: 'كاش', openingBalance: 0, lowAlert: 0 };
const debt = {
  id: 'd1', personName: 'صاحبي', direction: 'owed_to_me', isInstallment: true, installmentCount: 10, totalAmount: 1000,
  date: '2026-03-10', createdAt: 'x', increases: [],
  payments: [{ id: 'p1', date: '2026-03-20', amount: 300, walletId: 'a', transactionId: 'tx_p' }],
};

function seed(wallets: unknown[], txWallet: string) {
  Object.assign(mockData, {
    wallets, categories: [],
    transactions: [{ id: 'tx_p', type: 'income', amount: 300, walletId: txWallet, date: '2026-03-20' }],
    debts: [debt], subscriptions: [], gamiyas: [], incomes: [], linkSourcesReady: true, loadErrors: [], retryLoad: jest.fn(),
    addTransaction: jest.fn(), updateTransaction: jest.fn(), deleteTransaction: jest.fn(),
    transactionLinkWarning: () => WARNING,
    updateDebtLinkedTransaction: jest.fn(async () => ({ outcome: 'done', note: null })),
  });
}

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  mockParams = { id: 'tx_p' };
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => alertSpy.mockRestore());

const ui = () => <ThemeProvider><PrivacyProvider><AddTransactionModal /></PrivacyProvider></ThemeProvider>;
warmUp(() => { seed([active], 'w'); return ui(); });

async function openAndPressDelete() {
  await render(ui());
  await act(async () => {});
  await act(async () => { fireEvent.press(screen.getByText('حذف')); });
}

it('مفيش مؤرشفة ← Alert واحد "حذف العملية" فيه سطر العدد، ومفيش شيت', async () => {
  seed([active], 'w');
  await openAndPressDelete();
  expect(alertSpy).toHaveBeenCalledTimes(1);
  const [title, message] = alertSpy.mock.calls[0];
  expect(title).toBe('حذف العملية');
  expect(message).toContain(QUESTION);
  expect(message).toContain(LINK);
  expect(message).toContain(COUNT_LINE);
  expect(screen.queryByTestId('settle_sheet')).toBeNull();
  expect(screen.queryByTestId('settle_blocked')).toBeNull();
});

it('مؤرشفة هتتأثر ← مفيش Alert، والشيت بتسأل وبتعرض التحذير وسطر العدد وزرارها "حذف"', async () => {
  seed([archived, active], 'a');
  await openAndPressDelete();
  expect(alertSpy).not.toHaveBeenCalled();
  const sheet = screen.getByTestId('settle_sheet');
  expect(within(sheet).getByText(new RegExp(QUESTION))).toBeTruthy();
  expect(within(sheet).getByText(new RegExp(LINK))).toBeTruthy();
  expect(within(sheet).getByText(new RegExp(COUNT_LINE.replace('.', '\\.')))).toBeTruthy();
  const confirm = screen.getByTestId('settle_confirm');
  expect(within(confirm).getByText('حذف')).toBeTruthy();
  expect(within(confirm).queryByText('احفظ')).toBeNull();
  // لسه ما اتمسحش حاجة قبل التأكيد
  expect(mockData.deleteTransaction).not.toHaveBeenCalled();
});

it('الشيت: اختيار المحفظة ثم "حذف" ← deleteTransaction بتسوية واحدة', async () => {
  seed([archived, active], 'a');
  await openAndPressDelete();
  const sheet = screen.getByTestId('settle_sheet');
  await act(async () => { fireEvent.press(within(sheet).getByText('كاش')); });
  await act(async () => { fireEvent.press(screen.getByTestId('settle_confirm')); });
  expect(mockData.deleteTransaction).toHaveBeenCalledTimes(1);
  expect(mockData.deleteTransaction).toHaveBeenCalledWith('tx_p', [
    expect.objectContaining({ archivedWalletId: 'a', targetWalletId: 'w' }),
  ]);
  expect(alertSpy).not.toHaveBeenCalled();
});

it('مؤرشفة ومفيش ولا شغالة ← شيت الممنوع من غير سؤال "متأكد؟" ومن غير Alert', async () => {
  seed([archived], 'a');
  await openAndPressDelete();
  expect(alertSpy).not.toHaveBeenCalled();
  const blocked = screen.getByTestId('settle_blocked');
  expect(within(blocked).queryByText(new RegExp(QUESTION))).toBeNull();
  expect(screen.queryByTestId('settle_sheet')).toBeNull();
  expect(screen.queryByTestId('settle_confirm')).toBeNull();
  expect(mockData.deleteTransaction).not.toHaveBeenCalled();
});

it('الإلغاء من الشيت ← مفيش مسح', async () => {
  seed([archived, active], 'a');
  await openAndPressDelete();
  await act(async () => { fireEvent.press(within(screen.getByTestId('settle_sheet')).getByText('إلغاء')); });
  expect(screen.queryByTestId('settle_sheet')).toBeNull();
  expect(mockData.deleteTransaction).not.toHaveBeenCalled();
});


/**
 * الجولة 1 على D3 (2026-10-30): silent-failure-hunter + react-reviewer + a11y-architect.
 */
describe('الجولة 1 على D3', () => {
  it('دوستين على "حذف" في الشيت في نفس اللحظة ← المسح والتسوية مرة واحدة (مش تحويلين)', async () => {
    seed([archived, active], 'a');
    await openAndPressDelete();
    const sheet = screen.getByTestId('settle_sheet');
    await act(async () => { fireEvent.press(within(sheet).getByText('كاش')); });
    const confirm = screen.getByTestId('settle_confirm');
    await act(async () => { fireEvent.press(confirm); fireEvent.press(confirm); });
    expect(mockData.deleteTransaction).toHaveBeenCalledTimes(1);
  });

  it('المسح وقع (رمى) ← المودال مبيتقفلش والرسالة بتظهر، والفشل بيوصل Sentry', async () => {
    seed([archived, active], 'a');
    (mockData.deleteTransaction as jest.Mock).mockImplementation(async () => { throw new Error('boom'); });
    const { router } = jest.requireMock('expo-router');
    router.back.mockClear();
    await openAndPressDelete();
    await act(async () => { fireEvent.press(within(screen.getByTestId('settle_sheet')).getByText('كاش')); });
    await act(async () => { fireEvent.press(screen.getByTestId('settle_confirm')); });
    await act(async () => {});
    expect(router.back).not.toHaveBeenCalled();
    expect(screen.getByText('حصل خطأ، جرب تاني')).toBeTruthy();
    const { reportAtomicFailure } = jest.requireMock('@/lib/atomicFailure');
    expect(reportAtomicFailure).toHaveBeenCalledWith('حذف العملية', expect.any(Error));
  });

  it('مسار Alert: المسح وقع ← نفس الرسالة ومفيش رجوع', async () => {
    seed([active], 'w');
    (mockData.deleteTransaction as jest.Mock).mockImplementation(async () => { throw new Error('boom'); });
    const { router } = jest.requireMock('expo-router');
    router.back.mockClear();
    await openAndPressDelete();
    const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => unknown }[];
    await act(async () => { await buttons.find(b => b.text === 'حذف')!.onPress!(); });
    await act(async () => {});
    expect(router.back).not.toHaveBeenCalled();
    expect(screen.getByText('حصل خطأ، جرب تاني')).toBeTruthy();
  });

  it('زرار التأكيد بيقول إنه زرار ومقفول لحد ما المحفظة تتختار، والشرايح بتقول مين المختار', async () => {
    seed([archived, active], 'a');
    await openAndPressDelete();
    const confirm = screen.getByTestId('settle_confirm');
    expect(confirm.props.accessibilityRole).toBe('button');
    expect(confirm.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
    const chip = within(screen.getByTestId('settle_sheet')).getByText('كاش');
    await act(async () => { fireEvent.press(chip); });
    const chipBtn = screen.getByTestId('settle_target_w');
    expect(chipBtn.props.accessibilityRole).toBe('radio');
    expect(chipBtn.props.accessibilityState).toEqual(expect.objectContaining({ checked: true }));
    expect(screen.getByTestId('settle_confirm').props.accessibilityState).toEqual(expect.objectContaining({ disabled: false }));
  });
});


/** الجولة 2 على D3 (silent-failure-hunter، الأخيرة) */
describe('الجولة 2 على D3', () => {
  it('رسالة الخطأ برّه الـScrollView (فوق الأزرار اللاصقة) — مبتضيعش تحت الفورم الطويل', () => {
    const src: string = require('fs').readFileSync('app/modal.tsx', 'utf8');
    const errorAt = src.indexOf('testID="tx_error"');
    expect(errorAt).toBeGreaterThan(src.lastIndexOf('</ScrollView>'));
    expect(errorAt).toBeLessThan(src.indexOf('<View style={styles.footer}>'));
  });

  it('محاولة مسح تانية بتشيل رسالة الخطأ القديمة', async () => {
    seed([archived, active], 'a');
    (mockData.deleteTransaction as jest.Mock).mockImplementationOnce(async () => { throw new Error('boom'); });
    await openAndPressDelete();
    await act(async () => { fireEvent.press(within(screen.getByTestId('settle_sheet')).getByText('كاش')); });
    await act(async () => { fireEvent.press(screen.getByTestId('settle_confirm')); });
    await act(async () => {});
    expect(screen.getByTestId('tx_error')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getAllByText('حذف')[0]); });
    expect(screen.queryByTestId('tx_error')).toBeNull();
  });
});
