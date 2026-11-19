import LockScreen, { FORGOT_BODY, FORGOT_CONFIRM, FORGOT_OFFLINE_TITLE, LOCK_LEFT_AFTER_LOGOUT, LOGOUT_FAILED_NOTICE, forgotBody } from '@/components/LockScreen';
import { ThemeProvider } from '@/context/ThemeContext';
import { pendingWritesSentence } from '@/lib/archiving';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';

/**
 * الميزة 11، بند 11: «نسيت الكود؟» والتعديلات اللي لسه بترفع (برّه الطابور المتشفّر) — بتتقال بعددها، والرسالة متوعدش
 * «كلها زي ما هي». والخروج اللي يقع بيتقال. ونصوص arabic-copy-reviewer.
 */
const mockLock = {
  lockType: 'pin' as 'pin' | 'password', verify: jest.fn(async () => 'wrong'), unlock: jest.fn(),
  clearLock: jest.fn(async () => {}), readFailed: false, retryRead: jest.fn(async () => null as boolean | null), waitUntil: 0,
};
const mockAuth = { logOut: jest.fn(async () => {}) };
const mockData = { serverReachable: true, pendingWrites: 0, outboxCount: 0 };
jest.mock('@/context/AppLockContext', () => ({ useAppLock: () => mockLock }));
jest.mock('@/context/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('@/context/DataContext', () => ({ useData: () => mockData }));

const alerts = () => (Alert.alert as unknown as jest.Mock).mock.calls;
beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockData, { serverReachable: true, pendingWrites: 0, outboxCount: 0 });
  mockLock.readFailed = false;
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
const renderLock = () => render(<ThemeProvider><LockScreen /></ThemeProvider>);
const pressForgot = async () => { await act(async () => { fireEvent.press(screen.getByTestId('lock_forgot_button')); }); };

describe('التعديلات اللي هتضيع', () => {
  it('مفيش ← FORGOT_BODY زي ما هو', async () => {
    await renderLock();
    await pressForgot();
    expect(alerts()[0][1]).toBe(FORGOT_BODY);
  });
  it('5 بترفع منهم 2 في الطابور ← العدد 3 في الرسالة، ومفيش «كلها زي ما هي»', async () => {
    Object.assign(mockData, { pendingWrites: 5, outboxCount: 2 });
    await renderLock();
    await pressForgot();
    expect(alerts()[0][1]).toBe(forgotBody(3));
    expect(alerts()[0][1]).toContain(pendingWritesSentence(3));
    expect(alerts()[0][1]).not.toContain('كلها زي ما هي');
  });
  it('الطابور بس (محفوظ) ← مفيش تحذير', async () => {
    Object.assign(mockData, { pendingWrites: 2, outboxCount: 2 });
    await renderLock();
    await pressForgot();
    expect(alerts()[0][1]).toBe(FORGOT_BODY);
  });
});

describe('الخروج وقع', () => {
  it('logOut رمى ← رسالة، والقفل ما اتشالش', async () => {
    mockAuth.logOut.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'auth/network-request-failed' }));
    await renderLock();
    await pressForgot();
    const confirm = alerts()[0][2].find((b: any) => b.text === FORGOT_CONFIRM);
    await act(async () => { await confirm.onPress(); });
    expect(mockLock.clearLock).not.toHaveBeenCalled();
    expect(alerts()[1][0]).toBe(LOGOUT_FAILED_NOTICE[0]);
  });
  it('خرج والقفل ما اتشالش ← «القفل لسه موجود»', async () => {
    mockLock.clearLock.mockRejectedValueOnce(new Error('keystore'));
    await renderLock();
    await pressForgot();
    const confirm = alerts()[0][2].find((b: any) => b.text === FORGOT_CONFIRM);
    await act(async () => { await confirm.onPress(); });
    expect(alerts()[1][0]).toBe('القفل لسه موجود');
    expect(alerts()[1][1]).toBe(LOCK_LEFT_AFTER_LOGOUT[1]);
    expect(LOCK_LEFT_AFTER_LOGOUT[1]).toBe('خرجنا من حسابك بس ما قدرناش نشيل القفل. دوس "نسيت الكود؟" تاني.');
  });
});

describe('النصوص', () => {
  it('من غير نت: زرار الرجوع «إلغاء»', async () => {
    mockData.serverReachable = false;
    await renderLock();
    await pressForgot();
    expect(alerts()[0][0]).toBe(FORGOT_OFFLINE_TITLE);
    expect(alerts()[0][2].find((b: any) => b.style === 'cancel').text).toBe('إلغاء');
  });
  it('«جرّب تاني» وهو شغال ← «بنجرّب…»', async () => {
    mockLock.readFailed = true;
    let release!: (v: boolean | null) => void;
    mockLock.retryRead.mockImplementationOnce(() => new Promise(r => { release = r; }));
    await renderLock();
    await act(async () => { fireEvent.press(screen.getByTestId('lock_read_retry')); });
    expect(screen.getByTestId('lock_read_retry')).toHaveTextContent('بنجرّب…');
    await act(async () => { release(true); });
  });
  it('pendingWritesSentence: الاتفاق مع العدد', () => {
    expect(pendingWritesSentence(1)).toBe('فيه تعديل واحد لسه بيترفع');
    expect(pendingWritesSentence(2)).toBe('فيه تعديلين لسه بيترفعوا');
    expect(pendingWritesSentence(3)).toBe('فيه 3 تعديلات لسه بتترفع');
    expect(pendingWritesSentence(11)).toBe('فيه 11 تعديل لسه بيترفع');
  });
});
