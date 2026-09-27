import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import ChargeHomeCards from '@/components/ChargeHomeCards';
import { ThemeProvider } from '@/context/ThemeContext';
import { addMonths, todayStr } from '@/lib/finance';
import { useChargeAutoRecord } from '@/lib/useChargeAutoRecord';

/**
 * الخصم التلقائي من جهة الواجهة: التلقائي بيسجل كل اللي فات في **رسالة
 * واحدة** وإشعار واحد، و"بتأكيد" بيطلع كارت "اتخصم؟" ومبيتسجلش لوحده،
 * والفشل بيبان مش بيتبلع. (الحماية من الخصم مرتين في اختبارات المحاكي.)
 */

const mockData: any = {};
const mockNotify = jest.fn(async () => {});
let mockHidden = false;

jest.mock('@/context/DataContext', () => ({
  ...jest.requireActual('@/context/DataContext'),
  useData: () => mockData,
}));
jest.mock('@/context/NotificationsContext', () => ({ useNotifications: () => ({ enabled: true }) }));
jest.mock('@/context/PrivacyContext', () => ({
  usePrivacy: () => ({ amountsHidden: mockHidden, hidePreference: mockHidden, loaded: true, money: (n: number) => String(n) }),
}));
jest.mock('@/lib/notifications', () => ({ notifyNow: (...a: unknown[]) => (mockNotify as any)(...a) }));

const today = todayStr();
const start = addMonths(today, -1);

const sub = (over: Record<string, unknown> = {}) => ({
  id: 's1', name: 'نتفليكس', amount: 200, walletId: 'w', frequency: 'monthly', nextDueDate: start,
  reminderDaysBefore: 3, active: true, createdAt: '', history: [], ...over,
});
const gamiya = (over: Record<string, unknown> = {}) => ({
  id: 'g1', name: 'العيلة', monthlyAmount: 1000, totalMonths: 2, payoutMonthIndex: 2, payoutAmount: 2000,
  walletId: 'w', startDate: today, reminderDaysBefore: 3, createdAt: '',
  months: [
    { id: 'm1', monthIndex: 1, dueDate: today, isPayoutMonth: false, amount: 1000, status: 'pending' },
    { id: 'm2', monthIndex: 2, dueDate: addMonths(today, 1), isPayoutMonth: true, amount: 2000, status: 'pending' },
  ],
  ...over,
});

function Probe() {
  const { notices } = useChargeAutoRecord();
  return <>{notices.map(n => <Text key={n.id} testID={`notice_${n.kind}`}>{n.text}</Text>)}</>;
}

beforeEach(() => {
  mockNotify.mockClear();
  mockHidden = false;
  Object.assign(mockData, {
    subscriptions: [sub({ chargeMode: 'auto', chargeAutoSince: start })],
    gamiyas: [gamiya({ chargeMode: 'auto', chargeAutoSince: start })],
    wallets: [{ id: 'w', name: 'كاش', openingBalance: 0, lowAlert: 0 }],
    serverReachable: true,
    recordCharges: jest.fn(async (_k: string, _id: string, entries: { key: string }[]) => ({
      outcome: 'done', recorded: entries.map(e => e.key),
    })),
    skipSubscriptionCharge: jest.fn(async () => 'done'),
  });
});

describe('التلقائي', () => {
  it('اشتراك فاته شهرين + قسط جمعية ← رسالة واحدة وإشعار واحد', async () => {
    await render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('notice_recorded')).toBeTruthy());
    expect(screen.getAllByTestId('notice_recorded')).toHaveLength(1);
    expect(mockData.recordCharges).toHaveBeenCalledTimes(2);
    expect(mockData.recordCharges.mock.calls.every((c: unknown[]) => (c[3] as { auto: boolean }).auto)).toBe(true);
    const text = screen.getByTestId('notice_recorded').props.children;
    expect(text).toMatch(/^سجلنا لوحدنا: اشتراك "نتفليكس" \(.+ و.+\) وقسط جمعية "العيلة" \(شهر 1\)$/);
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect((mockNotify.mock.calls[0] as unknown as string[])[1]).toContain('1,400');
  });

  it('المبالغ مخفية ← الإشعار من غير رقم', async () => {
    mockHidden = true;
    await render(<Probe />);
    await waitFor(() => expect(mockNotify).toHaveBeenCalled());
    const body = (mockNotify.mock.calls[0] as unknown as string[])[1];
    expect(body.replace(/\d+ [^\s)]+|شهر \d+/g, '')).not.toMatch(/[0-9٠-٩]|ج\.م/);
  });

  it('"بتأكيد" ← مفيش ولا نداء تلقائي', async () => {
    mockData.subscriptions = [sub()];
    mockData.gamiyas = [gamiya()];
    await render(<Probe />);
    await new Promise(r => setTimeout(r, 50));
    expect(mockData.recordCharges).not.toHaveBeenCalled();
  });

  it('المحفظة اتأرشفت ← رسالة في الرئيسية **وإشعار** (التلقائي معناه إنه مش هيفتح يتأكد)', async () => {
    mockData.gamiyas = [];
    mockData.recordCharges = jest.fn(async () => ({ outcome: 'wallet-missing', recorded: [] }));
    await render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('notice_error')).toBeTruthy());
    expect(screen.getByTestId('notice_error').props.children).toContain('مفيش أي خصم اتسجل');
    expect(screen.getByTestId('notice_error').props.children).toContain('الديون ← الاشتراكات');
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect((mockNotify.mock.calls[0] as unknown as string[])[0]).toBe('ما سجلناش اشتراك "نتفليكس"');
  });
});

describe('كارت "اتخصم؟"', () => {
  const mount = () => render(<ThemeProvider><ChargeHomeCards /></ThemeProvider>);

  it('اشتراك "بتأكيد" معاده فات ← كارت بالأقدم، و"اتخصم" بيسجل الفترة دي بالمبلغ المعتاد', async () => {
    mockData.subscriptions = [sub()];
    mockData.gamiyas = [];
    await mount();
    expect(screen.getByTestId('charge_card_s1')).toBeTruthy();
    fireEvent.press(screen.getByTestId('charge_card_yes_s1'));
    await waitFor(() => expect(mockData.recordCharges).toHaveBeenCalledWith('subscription', 's1', [{ key: start, amount: 200 }]));
  });

  it('اتسجلت قبلنا (جهاز تاني) ← بيتقال، مش "اتسجل" وخلاص', async () => {
    const alert = jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(() => {});
    mockData.subscriptions = [sub()];
    mockData.gamiyas = [];
    mockData.recordCharges = jest.fn(async () => ({ outcome: 'done', recorded: [] }));
    await mount();
    fireEvent.press(screen.getByTestId('charge_card_yes_s1'));
    await waitFor(() => expect(alert).toHaveBeenCalledWith('اتسجلت قبل كده', expect.stringContaining('ما سجلناش تاني')));
    alert.mockRestore();
  });

  it('قسط الجمعية "لسه" ← الكارت بيستخبّى من غير أي كتابة', async () => {
    mockData.subscriptions = [];
    mockData.gamiyas = [gamiya()];
    await mount();
    fireEvent.press(screen.getByText('لسه'));
    await waitFor(() => expect(screen.queryByTestId('charge_card_g1')).toBeNull());
    expect(mockData.recordCharges).not.toHaveBeenCalled();
  });
});
