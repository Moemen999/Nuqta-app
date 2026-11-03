import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import DeleteAccountScreen, { DELETE_CONFIRM_PHRASE, DELETE_MSG } from '@/app/settings-screens/delete-account';
import { NoticeProvider } from '@/components/NoticeProvider';
import { ThemeProvider } from '@/context/ThemeContext';

/**
 * شاشة مسح الحساب (فرع `feat/account-delete`): الزرار مقفول لحد الجملة + الباسورد؛ الترتيب إعادة دخول ← مسح البيانات ←
 * حساب الدخول؛ وأي خطوة وقعت ← بيقف ورسالتها، **ومفيش "اتمسح" غير بعد آخر خطوة**.
 */
const calls: string[] = [];
const mockAuth: Record<string, unknown> = {};
const mockData: Record<string, unknown> = {};
jest.mock('@/context/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('expo-auth-session/providers/google', () => ({ useAuthRequest: () => [null, null, jest.fn()] }));

function setUp(o: { reauth?: string; data?: object; acc?: string; online?: boolean } = {}) {
  calls.length = 0;
  Object.assign(mockAuth, {
    user: { providerData: [{ providerId: 'password' }] },
    reauthenticate: jest.fn(async () => { calls.push('reauth'); return o.reauth ?? 'done'; }),
    deleteSignInAccount: jest.fn(async () => { calls.push('account'); return o.acc ?? 'done'; }),
  });
  Object.assign(mockData, {
    serverReachable: o.online ?? true,
    deleteAllMyData: jest.fn(async () => { calls.push('data'); return o.data ?? { outcome: 'done' }; }),
  });
}
const mount = () => render(<ThemeProvider><NoticeProvider><DeleteAccountScreen /></NoticeProvider></ThemeProvider>);
const fill = (phrase = DELETE_CONFIRM_PHRASE, pw = 'x') => act(async () => {
  fireEvent.changeText(screen.getByTestId('delete_phrase'), phrase);
  fireEvent.changeText(screen.getByTestId('delete_password'), pw);
});
const press = () => act(async () => { fireEvent.press(screen.getByTestId('delete_confirm')); });
const disabled = () => screen.getByTestId('delete_confirm').props.accessibilityState.disabled;

it('الزرار مقفول لحد الجملة بالظبط + الباسورد، ومن غير نت', async () => {
  setUp();
  await mount();
  expect(disabled()).toBe(true);
  await fill('امسح', 'x');
  expect(disabled()).toBe(true);
  await fill();
  expect(disabled()).toBe(false);
  setUp({ online: false });
  await mount();
  await fill();
  expect(disabled()).toBe(true);
  expect(screen.getByTestId('delete_offline')).toBeTruthy();
});

it('كله نجح ← بالترتيب: إعادة دخول ← البيانات ← الحساب، ورسالة "اتمسح"', async () => {
  setUp();
  await mount();
  await fill();
  await press();
  expect(calls).toEqual(['reauth', 'data', 'account']);
  expect(screen.getByTestId('notice_title').props.children).toBe(DELETE_MSG.done[0]);
});

it('الباسورد غلط ← مفيش أي مسح', async () => {
  setUp({ reauth: 'wrong-password' });
  await mount();
  await fill();
  await press();
  expect(calls).toEqual(['reauth']);
  expect(screen.getByTestId('notice_title').props.children).toBe(DELETE_MSG.reauth['wrong-password'][0]);
});

it('البيانات ما اتمسحتش كلها ← حساب الدخول مبيتمسحش، والرسالة بتقول نكمّل', async () => {
  setUp({ data: { outcome: 'failed', remaining: 12 } });
  await mount();
  await fill();
  await press();
  expect(calls).toEqual(['reauth', 'data']);
  expect(screen.getByTestId('notice_body').props.children).toBe(DELETE_MSG.dataNotDone(12)[1]);
});

it('البيانات اتمسحت والحساب لأ ← مش "اتمسح حسابك"', async () => {
  setUp({ acc: 'requires-recent-login' });
  await mount();
  await fill();
  await press();
  expect(calls).toEqual(['reauth', 'data', 'account']);
  expect(screen.getByTestId('notice_title').props.children).toBe(DELETE_MSG.accountNotDone[0]);
});
