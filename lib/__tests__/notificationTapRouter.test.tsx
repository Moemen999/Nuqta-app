import NotificationTapRouter, { resetHandledNotification } from '@/components/NotificationTapRouter';
import { render } from '@testing-library/react-native';
import React from 'react';

const mockNavigate = jest.fn();
const mockPush = jest.fn();
let mockResponse: unknown = null;
let mockLock = { enabled: true, isLocked: false, readFailed: false };
let mockUser: unknown = { uid: 'u' };

jest.mock('expo-router', () => ({
  router: { navigate: (...a: unknown[]) => mockNavigate(...a), push: (...a: unknown[]) => mockPush(...a) },
  useRootNavigationState: () => ({ key: 'k' }),
}));
jest.mock('expo-notifications', () => ({
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
  useLastNotificationResponse: () => mockResponse,
}));
jest.mock('@/context/AppLockContext', () => ({
  ...jest.requireActual('@/context/AppLockContext'),
  useAppLock: () => mockLock,
}));
const mockReport = jest.fn();
jest.mock('@/lib/atomicFailure', () => ({ reportAtomicFailure: (...a: unknown[]) => mockReport(...a) }));
jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));

const tap = (kind: string, id = 'n1') => ({
  actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
  notification: { date: 1, request: { identifier: id, content: { data: { kind } } } },
});

beforeEach(() => {
  mockNavigate.mockClear(); mockPush.mockClear(); mockReport.mockClear();
  mockLock = { enabled: true, isLocked: false, readFailed: false };
  mockUser = { uid: 'u' };
  resetHandledNotification();
});

it('اشتراك ← تاب الالتزامات على الاشتراكات', async () => {
  mockResponse = tap('subscription');
  await render(<NotificationTapRouter />);
  expect(mockNavigate).toHaveBeenCalledWith({ pathname: '/debts', params: expect.objectContaining({ tab: 'subscriptions' }) });
});

it('التذكير اليومي ← مودال إضافة عملية', async () => {
  mockResponse = tap('daily');
  await render(<NotificationTapRouter />);
  expect(mockPush).toHaveBeenCalledWith('/modal');
});

it('والقفل ظاهر ← مفيش تنقل، وبعد الفتح بيتنفذ مرة واحدة', async () => {
  mockResponse = tap('debt');
  mockLock = { enabled: true, isLocked: true, readFailed: false };
  const r = await render(<NotificationTapRouter />);
  expect(mockNavigate).not.toHaveBeenCalled();
  mockLock = { enabled: true, isLocked: false, readFailed: false };
  await r.rerender(<NotificationTapRouter />);
  expect(mockNavigate).toHaveBeenCalledTimes(1);
  await r.rerender(<NotificationTapRouter />);
  expect(mockNavigate).toHaveBeenCalledTimes(1);
});

it('فشل قراية القفل بيعتبر مقفول', async () => {
  mockResponse = tap('debt');
  mockLock = { enabled: false, isLocked: true, readFailed: true };
  await render(<NotificationTapRouter />);
  expect(mockNavigate).not.toHaveBeenCalled();
});

it('من غير مستخدم داخل ← مفيش تنقل', async () => {
  mockResponse = tap('daily');
  mockUser = null;
  await render(<NotificationTapRouter />);
  expect(mockPush).not.toHaveBeenCalled();
});

it('دوسة قديمة وانت مش داخل ← مبتنفّذش بعد تسجيل الدخول', async () => {
  mockResponse = tap('daily'); // date: 1 = قديمة جدًا
  mockUser = null;
  const r = await render(<NotificationTapRouter />);
  mockUser = { uid: 'u' };
  await r.rerender(<NotificationTapRouter />);
  expect(mockPush).not.toHaveBeenCalled();
});

it('دوسة طازجة وانت مش داخل ← بتتنفّذ بعد تسجيل الدخول', async () => {
  mockResponse = { ...tap('daily'), notification: { ...tap('daily').notification, date: Date.now() } };
  mockUser = null;
  const r = await render(<NotificationTapRouter />);
  expect(mockPush).not.toHaveBeenCalled();
  mockUser = { uid: 'u' };
  await r.rerender(<NotificationTapRouter />);
  expect(mockPush).toHaveBeenCalledTimes(1);
});

it('التنقل فشل ← بيتبلّغ وبيتعاد بعدين (مش متعلّم اتعالج)', async () => {
  mockResponse = tap('debt');
  mockNavigate.mockImplementationOnce(() => { throw new Error('x'); });
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const r = await render(<NotificationTapRouter />);
  expect(mockReport).toHaveBeenCalledWith('فتح مكان الإشعار', expect.any(Error));
  expect(mockReport).toHaveBeenCalledTimes(1);
  await r.rerender(<NotificationTapRouter />);
  warn.mockRestore();
});
