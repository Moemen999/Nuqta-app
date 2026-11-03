import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import DeleteAccountScreen, { DELETE_CONFIRM_PHRASE, DELETE_MSG } from '@/app/settings-screens/delete-account';
import { NoticeProvider } from '@/components/NoticeProvider';
import { ThemeProvider } from '@/context/ThemeContext';

/**
 * شاشة مسح الحساب (فرع `feat/account-delete`): الزرار مقفول ويقول ليه لحد الجملة + الإثبات؛ الترتيب إعادة دخول ← مسح
 * البيانات ← تنضيف الجهاز ← حساب الدخول؛ وأي خطوة وقعت ← بيقف برسالة صادقة، **ومفيش "اتمسح" غير بعد آخر خطوة**.
 */
const calls: string[] = [];
const mockAuth: Record<string, unknown> = {};
const mockData: Record<string, unknown> = {};
jest.mock('@/context/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('expo-auth-session/providers/google', () => ({ useAuthRequest: () => [null, null, jest.fn()] }));
const mockCancel = jest.fn(async () => {});
jest.mock('@/lib/notifications', () => ({ cancelAllReminders: () => mockCancel() }));

function setUp(o: { reauth?: string; data?: object; acc?: string; online?: boolean } = {}) {
  calls.length = 0;
  mockCancel.mockClear();
  Object.assign(mockAuth, {
    user: { uid: 'u1', providerData: [{ providerId: 'password' }] },
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
});

it('الزرار المقفول بيقول ليه (ظاهر + hint)، بالأولوية', async () => {
  setUp({ online: false });
  await mount();
  expect(screen.getByTestId('delete_reason').props.children).toMatch(/محتاج نت/);
  setUp();
  await mount();
  expect(screen.getByTestId('delete_reason').props.children).toMatch(/اكتب «امسح حسابي»/);
  await fill(DELETE_CONFIRM_PHRASE, '');
  expect(screen.getByTestId('delete_reason').props.children).toMatch(/باسورد/);
  expect(screen.getByTestId('delete_confirm').props.accessibilityHint).toMatch(/باسورد/);
});

it('مسافات زيادة في الجملة مبتقفلش الزرار', async () => {
  setUp();
  await mount();
  await fill('  امسح   حسابي ', 'x');
  expect(disabled()).toBe(false);
});

it('كله نجح ← بالترتيب، التذكيرات بتتلغي، ورسالة "اتمسح"', async () => {
  setUp();
  await mount();
  await fill();
  await press();
  expect(calls).toEqual(['reauth', 'data', 'account']);
  expect(mockCancel).toHaveBeenCalledTimes(1);
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

it.each([
  ['جزء اتمسح', { outcome: 'failed', deleted: 12, uncertain: false }, /جزء من بياناتك اتمسح وفاضل/],
  ['مفيش حاجة اتمسحت', { outcome: 'failed', deleted: 0, uncertain: false }, /مفيش حاجة اتمسحت/],
  ['مش متأكدين (timeout)', { outcome: 'failed', deleted: 0, uncertain: true }, /ممكن يكون جزء/],
])('البيانات ما خلصتش (%s) ← حساب الدخول مبيتمسحش، والرسالة صادقة', async (_, data, msg) => {
  setUp({ data });
  await mount();
  await fill();
  await press();
  expect(calls).toEqual(['reauth', 'data']);
  expect(screen.getByTestId('notice_body').props.children).toMatch(msg);
  expect(mockCancel).not.toHaveBeenCalled();
});

it.each(['requires-recent-login', 'no-connection', 'failed'] as const)('البيانات اتمسحت والحساب لأ (%s) ← رسالته بالظبط، مش "اتمسح حسابك"', async acc => {
  setUp({ acc });
  await mount();
  await fill();
  await press();
  expect(calls).toEqual(['reauth', 'data', 'account']);
  expect(screen.getByTestId('notice_body').props.children).toBe(DELETE_MSG.account[acc][1]);
  // الباسورد بيتمسح بس لما فايربيز تطلب دخول تاني
  expect(screen.getByTestId('delete_password').props.value).toBe(acc === 'requires-recent-login' ? '' : 'x');
});
