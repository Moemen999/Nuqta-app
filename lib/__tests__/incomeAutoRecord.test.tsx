import React from 'react';
import { Text } from 'react-native';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { addDays, todayStr } from '@/lib/finance';
import type { RecurringIncome } from '@/lib/recurringIncome';
import { INCOME_RETRY_MS, useIncomeAutoRecord } from '@/lib/useIncomeAutoRecord';

/**
 * التسجيل التلقائي أول ما التطبيق يتفتح: بيسجل كل الفترات اللي فاتت في نداء
 * واحد برسالة واحدة، ومن غير نت ساكت، والفشل بيبان مرة واحدة مش بيتبلع.
 */

const mockData: any = {};
const mockNotify = jest.fn(async () => {});
let mockHidden = false;

jest.mock('@/context/DataContext', () => ({ useData: () => mockData }));
jest.mock('@/context/NotificationsContext', () => ({ useNotifications: () => ({ enabled: true }) }));
jest.mock('@/context/PrivacyContext', () => ({ usePrivacy: () => ({ amountsHidden: mockHidden, loaded: true }) }));
jest.mock('@/lib/notifications', () => ({ notifyNow: (...a: unknown[]) => (mockNotify as any)(...a) }));

const today = todayStr();

function income(over: Partial<RecurringIncome> = {}): RecurringIncome {
  // أسبوعي بدأ من ١٥ يوم ⇒ فترتين أو تلاتة معادها فات
  return {
    id: 'i1', name: 'المرتب', amount: 8000, walletId: 'w', frequency: 'weekly',
    weekday: new Date(`${addDays(today, -1)}T00:00:00Z`).getUTCDay(),
    mode: 'auto', status: 'active', startDate: addDays(today, -15), closed: {}, createdAt: '',
    ...over,
  };
}

function Probe() {
  const { notices } = useIncomeAutoRecord();
  return <>{notices.map(n => <Text key={n.id} testID={`notice_${n.kind}`}>{n.text}</Text>)}</>;
}

beforeEach(() => {
  mockNotify.mockClear();
  mockHidden = false;
  Object.assign(mockData, {
    incomes: [income()],
    serverReachable: true,
    recordIncomePeriods: jest.fn(async (_id: string, entries: { key: string }[]) => ({
      outcome: 'done', recorded: entries.map(e => e.key),
    })),
  });
});

it('كل الفترات اللي فاتت في نداء واحد، ورسالة واحدة، وإشعار', async () => {
  await render(<Probe />);
  await waitFor(() => expect(screen.getByTestId('notice_recorded')).toBeTruthy());
  expect(mockData.recordIncomePeriods).toHaveBeenCalledTimes(1);
  const [, entries] = mockData.recordIncomePeriods.mock.calls[0];
  expect(entries.length).toBeGreaterThanOrEqual(2);
  expect(entries.every((e: { amount: number }) => e.amount === 8000)).toBe(true);
  expect(screen.getByTestId('notice_recorded').props.children).toMatch(/^سجلنا «المرتب» عن أسبوع .+ وأسبوع /);
  expect(mockNotify).toHaveBeenCalledTimes(1);
});

it('المبالغ مخفية ← الإشعار من غير رقم', async () => {
  mockHidden = true;
  await render(<Probe />);
  await waitFor(() => expect(mockNotify).toHaveBeenCalled());
  const body = (mockNotify.mock.calls[0] as unknown as string[])[1];
  expect(body.replace(/أسبوع \d+/g, '')).not.toMatch(/[0-9٠-٩]|ج\.م|•/);
});

it('اللي بيستنى تأكيد مش بيتسجل لوحده', async () => {
  mockData.incomes = [income({ mode: 'confirm' })];
  await render(<Probe />);
  await new Promise(r => setTimeout(r, 20));
  expect(mockData.recordIncomePeriods).not.toHaveBeenCalled();
});

it('من غير نت ← مفيش نداء أصلاً', async () => {
  mockData.serverReachable = false;
  await render(<Probe />);
  await new Promise(r => setTimeout(r, 20));
  expect(mockData.recordIncomePeriods).not.toHaveBeenCalled();
});

it('المحفظة اتأرشفت ← كارت بيقول ما اتسجلش وإزاي يتصلح، ومفيش إشعار', async () => {
  mockData.recordIncomePeriods = jest.fn(async () => ({ outcome: 'wallet-missing', recorded: [] }));
  await render(<Probe />);
  await waitFor(() => expect(screen.getByTestId('notice_error')).toBeTruthy());
  expect(screen.getByTestId('notice_error').props.children).toContain('ومفيش حاجة اتسجلت');
  expect(mockNotify).not.toHaveBeenCalled();
});

it('النت وقع وسط التسجيل (no-connection) ← ساكت، هيتنادى تاني لما يرجع', async () => {
  mockData.recordIncomePeriods = jest.fn(async () => ({ outcome: 'no-connection', recorded: [] }));
  await render(<Probe />);
  await waitFor(() => expect(mockData.recordIncomePeriods).toHaveBeenCalled());
  expect(screen.queryByTestId('notice_error')).toBeNull();
  expect(screen.queryByTestId('notice_recorded')).toBeNull();
});

it('جهاز تاني سبقنا (done من غير فترات) ← مفيش "سجلنا"', async () => {
  mockData.recordIncomePeriods = jest.fn(async () => ({ outcome: 'done', recorded: [] }));
  await render(<Probe />);
  await waitFor(() => expect(mockData.recordIncomePeriods).toHaveBeenCalled());
  expect(screen.queryByTestId('notice_recorded')).toBeNull();
  expect(mockNotify).not.toHaveBeenCalled();
});

/**
 * silent-failure-hunter: لو انتظار الكتابات خلص وقته والنت لسه "شغال"، مفيش
 * حاجة كانت هتصحّي الهوك لحد ما التطبيق يروح الخلفية ويرجع.
 */
it('no-connection والنت شغال ← بيجرب تاني بعد دقيقة لوحده', async () => {
  jest.useFakeTimers();
  try {
    mockData.recordIncomePeriods = jest.fn()
      .mockResolvedValueOnce({ outcome: 'no-connection', recorded: [] })
      .mockImplementation(async (_id: string, entries: { key: string }[]) => ({ outcome: 'done', recorded: entries.map(e => e.key) }));
    await render(<Probe />);
    await waitFor(() => expect(mockData.recordIncomePeriods).toHaveBeenCalledTimes(1));
    await act(async () => { jest.advanceTimersByTime(INCOME_RETRY_MS + 10); });
    await waitFor(() => expect(mockData.recordIncomePeriods).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('notice_recorded')).toBeTruthy());
  } finally {
    jest.useRealTimers();
  }
});

it('الخطأ بيظهر تاني مع كل تشغيل جديد لو لسه موجود (مش متخزّن يتقفل للأبد)', async () => {
  mockData.recordIncomePeriods = jest.fn(async () => ({ outcome: 'wallet-missing', recorded: [] }));
  const view = await render(<Probe key="first" />);
  await waitFor(() => expect(screen.getByTestId('notice_error')).toBeTruthy());
  // key جديد = الهوك بيتشال ويترسم من الأول، زي تشغيل جديد للتطبيق
  await view.rerender(<Probe key="second" />);
  await waitFor(() => expect(mockData.recordIncomePeriods).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByTestId('notice_error')).toBeTruthy());
});

/**
 * silent-failure-hunter: `incomes` و`recordIncomePeriods` مراجع جديدة مع كل
 * رسمة لـ DataContext، فخطأ ثابت كان بيعمل runTransaction مع كل snapshot.
 */
it('خطأ ثابت + رسمات كتير بنفس البيانات ← محاولة واحدة بس', async () => {
  mockData.recordIncomePeriods = jest.fn(async () => ({ outcome: 'wallet-missing', recorded: [] }));
  const view = await render(<Probe />);
  await waitFor(() => expect(mockData.recordIncomePeriods).toHaveBeenCalledTimes(1));
  for (let i = 0; i < 5; i++) {
    // نفس الدخل بمرجع جديد — زي أي snapshot في مجموعة تانية
    mockData.incomes = mockData.incomes.map((x: RecurringIncome) => ({ ...x }));
    mockData.recordIncomePeriods = Object.assign(
      jest.fn(async () => ({ outcome: 'wallet-missing', recorded: [] })),
      { calls: 0 },
    );
    await view.rerender(<Probe />);
  }
  await new Promise(r => setTimeout(r, 20));
  expect(mockData.recordIncomePeriods).not.toHaveBeenCalled();
});

it('النت رجع (false ← true) ← محاولة جديدة حتى لو الفترات هي هي', async () => {
  mockData.recordIncomePeriods = jest.fn(async () => ({ outcome: 'failed', recorded: [] }));
  const view = await render(<Probe />);
  await waitFor(() => expect(mockData.recordIncomePeriods).toHaveBeenCalledTimes(1));
  mockData.serverReachable = false;
  await view.rerender(<Probe />);
  mockData.serverReachable = true;
  await view.rerender(<Probe />);
  await waitFor(() => expect(mockData.recordIncomePeriods).toHaveBeenCalledTimes(2));
});

it('دخل تاني استحق وإحنا في نص محاولة ← بيتسجل بعدها مش بيتفوّت', async () => {
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  mockData.recordIncomePeriods = jest.fn(async (_id: string, entries: { key: string }[]) => {
    await gate;
    return { outcome: 'done', recorded: entries.map(e => e.key) };
  });
  const view = await render(<Probe />);
  await waitFor(() => expect(mockData.recordIncomePeriods).toHaveBeenCalledTimes(1));
  // وهو مستني السيرفر: دخل تاني ظهر
  mockData.incomes = [...mockData.incomes, income({ id: 'i2', name: 'الإيجار' })];
  await view.rerender(<Probe />);
  await act(async () => { release(); });
  await waitFor(() => expect(mockData.recordIncomePeriods.mock.calls.some((c: string[]) => c[0] === 'i2')).toBe(true));
});
