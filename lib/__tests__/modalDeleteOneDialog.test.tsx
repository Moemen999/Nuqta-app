import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import AddTransactionModal from '@/app/modal';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { NoticeProvider } from '@/components/NoticeProvider';
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
    debts: [debt], subscriptions: [], gamiyas: [], incomes: [], brokenTransactions: [], linkSourcesReady: true, loadErrors: [], retryLoad: jest.fn(),
    addTransaction: jest.fn(), updateTransaction: jest.fn(), deleteTransaction: jest.fn(async () => ({ outcome: 'done' })),
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
  ], { expectedTxs: [{ id: 'tx_p', amount: 300, walletId: 'a', type: 'income' }] });
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
    expect(screen.getByText('العملية ما اتمسحتش وهي لسه موجودة، جرب تاني')).toBeTruthy();
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
    expect(screen.getByText('العملية ما اتمسحتش وهي لسه موجودة، جرب تاني')).toBeTruthy();
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

/**
 * الجولة 2 (بند 1): مسح عملية دفعة/زيادة دين بقى ذرة من السيرفر بنتيجة — المودال لازم يقرا النتيجة:
 * مش `done` ← بيفضل مفتوح والرسالة بتقول الحالة؛ `dueNotRestored` ← "المعاد ما رجعش" بكلام الدفعة، والمودال بيقفل.
 */
describe('نتيجة مسح عملية الدين', () => {
  const { TX_DELETE_OUTCOME_ALERT } = jest.requireActual('@/context/DataContext');
  const { DUE_NOT_RESTORED_PAYMENT } = jest.requireActual('@/lib/reopenDue');
  async function pressDeleteViaAlert() {
    await openAndPressDelete();
    const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => unknown }[];
    await act(async () => { await buttons.find(b => b.text === 'حذف')!.onPress!(); });
    await act(async () => {});
  }
  const ui2 = () => <ThemeProvider><NoticeProvider><PrivacyProvider><AddTransactionModal /></PrivacyProvider></NoticeProvider></ThemeProvider>;
  async function openWithNotice() {
    await render(ui2());
    await act(async () => {});
    await act(async () => { fireEvent.press(screen.getByText('حذف')); });
  }

  it.each(['no-connection', 'failed', 'uncertain'] as const)('%s ← المودال مفتوح والرسالة بتاعة الحالة', async (outcome) => {
    seed([active], 'w');
    mockData.deleteTransaction = jest.fn(async () => ({ outcome }));
    const { router } = jest.requireMock('expo-router');
    router.back.mockClear();
    await openWithNotice();
    const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => unknown }[];
    await act(async () => { await buttons.find(b => b.text === 'حذف')!.onPress!(); });
    await act(async () => {});
    expect(router.back).not.toHaveBeenCalled();
    expect(screen.getByText(TX_DELETE_OUTCOME_ALERT[outcome].title)).toBeTruthy();
    // الزرار رجع يشتغل: محاولة تانية بتنادي تاني
    alertSpy.mockClear();
    await act(async () => { fireEvent.press(screen.getAllByText('حذف')[0]); });
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });

  it('done + dueNotRestored ← "المعاد ما رجعش" والمودال بيقفل', async () => {
    seed([active], 'w');
    mockData.deleteTransaction = jest.fn(async () => ({ outcome: 'done', dueNotRestored: 'payment' }));
    const { router } = jest.requireMock('expo-router');
    router.back.mockClear();
    await openWithNotice();
    const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => unknown }[];
    await act(async () => { await buttons.find(b => b.text === 'حذف')!.onPress!(); });
    await act(async () => {});
    expect(screen.getByText(DUE_NOT_RESTORED_PAYMENT.body)).toBeTruthy();
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('done من غير dueNotRestored ← مفيش رسالة والمودال بيقفل', async () => {
    seed([active], 'w');
    const { router } = jest.requireMock('expo-router');
    router.back.mockClear();
    await pressDeleteViaAlert();
    expect(router.back).toHaveBeenCalledTimes(1);
  });
});

/**
 * الجولة 1 على 3a72d99 (بند 2): مسح عملية من شهر استلام الجمعية — المودال بيبعت العمليات اللي حسب عليها التسوية
 * (`expectedTxIds`)، والذرة بترفض لو السيرفر عليه غيرهم (`changed`) ← الرسالة والمودال بيتقفل (الأرقام قدامه قديمة).
 */
describe('مسح عملية من شهر استلام الجمعية', () => {
  const { TX_DELETE_OUTCOME_ALERT_GAMIYA } = jest.requireActual('@/context/DataContext');
  const ui2 = () => <ThemeProvider><NoticeProvider><PrivacyProvider><AddTransactionModal /></PrivacyProvider></NoticeProvider></ThemeProvider>;
  function seedPayout(withInst: boolean) {
    seed([active], 'w');
    mockParams = { id: 'gamiya_g_m1' };
    Object.assign(mockData, {
      debts: [],
      transactions: [
        { id: 'gamiya_g_m1', type: 'income', amount: 10000, walletId: 'w', date: '2026-03-20', gamiyaId: 'g', periodKey: 'm1' },
        ...(withInst ? [{ id: 'gamiya_g_m1_inst', type: 'expense', amount: 1000, walletId: 'w', date: '2026-03-20', gamiyaId: 'g', periodKey: 'm1' }] : []),
      ],
      gamiyas: [{
        id: 'g', name: 'العيلة', monthlyAmount: 1000, walletId: 'w',
        months: [{ id: 'm1', monthIndex: 1, dueDate: '2026-03-20', amount: 10000, status: 'done', isPayoutMonth: true, transactionId: 'gamiya_g_m1', installmentTransactionId: 'gamiya_g_m1_inst' }],
      }],
      transactionLinkWarning: () => null,
    });
  }
  async function deleteViaAlert() {
    await render(ui2());
    await act(async () => {});
    await act(async () => { fireEvent.press(screen.getByText('حذف')); });
    const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => unknown }[];
    await act(async () => { await buttons.find(b => b.text === 'حذف')!.onPress!(); });
    await act(async () => {});
  }

  const PAYOUT = { id: 'gamiya_g_m1', amount: 10000, walletId: 'w', type: 'income' };
  const INST = { id: 'gamiya_g_m1_inst', amount: 1000, walletId: 'w', type: 'expense' };
  it.each([
    [true, [PAYOUT, INST]],
    // قسطك مش موجود عندنا ← المودال مبيوعدش بيه، والذرة بتقارن على ده
    [false, [PAYOUT]],
  ])('قسطك موجود=%p ← expectedTxs = اللي التسوية اتحسبت عليه (بالمبلغ والمحفظة والنوع — الجولة 2)', async (withInst, expected) => {
    seedPayout(withInst);
    await deleteViaAlert();
    expect(mockData.deleteTransaction).toHaveBeenCalledWith('gamiya_g_m1', [], { expectedTxs: expected });
  });

  it('قسطك بايظ (موجود بس برّه transactions) ← بيتبعت بالمعرّف بس، عشان الذرة متقولش "اتغيّرت" للأبد (الجولة 2)', async () => {
    seedPayout(false);
    mockData.brokenTransactions = [{ id: 'gamiya_g_m1_inst', reasons: ['amount'] }];
    await deleteViaAlert();
    expect(mockData.deleteTransaction).toHaveBeenCalledWith('gamiya_g_m1', [], { expectedTxs: [PAYOUT, { id: 'gamiya_g_m1_inst' }] });
  });

  it('changed ← "الأرقام اتغيّرت" والمودال بيتقفل', async () => {
    seedPayout(true);
    mockData.deleteTransaction = jest.fn(async () => ({ outcome: 'changed', subject: 'gamiya' }));
    const { router } = jest.requireMock('expo-router');
    router.back.mockClear();
    await deleteViaAlert();
    expect(screen.getByText(TX_DELETE_OUTCOME_ALERT_GAMIYA.changed.title)).toBeTruthy();
    expect(router.back).toHaveBeenCalledTimes(1);
  });
});
