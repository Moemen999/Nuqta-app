import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

/**
 * الميزة 11، بند 10 (الدخول بجوجل) وبند 12 (التسجيل) + نصوص شاشة الدخول (arabic-copy-reviewer).
 */

// ── شاشة الدخول ──
const mockAuth = {
  signIn: jest.fn(async (_e: string, _p: string) => {}),
  signUp: jest.fn(async (_e: string, _p: string, _n: string) => {}),
  signInWithGoogleCredential: jest.fn(async (_t: string) => {}),
  resetPassword: jest.fn(async (_email: string) => {}),
};
let mockGoogle: { request: unknown; response: unknown; prompt: jest.Mock } = { request: {}, response: null, prompt: jest.fn() };
jest.mock('@/context/AuthContext', () => {
  const actual = jest.requireActual('@/context/AuthContext');
  return { ...actual, useAuth: () => mockAuth };
});
jest.mock('expo-auth-session/providers/google', () => ({
  useAuthRequest: () => [mockGoogle.request, mockGoogle.response, mockGoogle.prompt],
}));
jest.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: jest.fn() }));
jest.mock('@/lib/atomicFailure', () => ({ reportAtomicFailure: jest.fn() }));

// ── AuthContext نفسه ──
const mockFa = {
  createUserWithEmailAndPassword: jest.fn(),
  updateProfile: jest.fn(),
  sendEmailVerification: jest.fn(),
  currentUser: null as unknown,
};
const mockSetDoc = jest.fn();
jest.mock('@/firebaseConfig', () => ({ get auth() { return { get currentUser() { return mockFa.currentUser; } }; }, db: {} }));
jest.mock('firebase/auth', () => ({
  onAuthStateChanged: () => () => {},
  createUserWithEmailAndPassword: (...a: unknown[]) => mockFa.createUserWithEmailAndPassword(...a),
  updateProfile: (...a: unknown[]) => mockFa.updateProfile(...a),
  sendEmailVerification: (...a: unknown[]) => mockFa.sendEmailVerification(...a),
  GoogleAuthProvider: { credential: jest.fn() },
  EmailAuthProvider: { credential: jest.fn() },
}));
jest.mock('firebase/firestore', () => ({ doc: jest.fn(() => 'ref'), serverTimestamp: jest.fn(), setDoc: (...a: unknown[]) => mockSetDoc(...a) }));
jest.mock('@/lib/outboxStore', () => ({ markUserSignOut: jest.fn() }));
jest.mock('@/lib/exportFiles', () => ({ sweepExportFiles: jest.fn(async () => {}) }));

/* eslint-disable import/first */
import AuthScreen, { GOOGLE_FAILED, RESET_TITLE, mapError, resetSentBody } from '@/app/(auth)/index';
import { AuthProvider, useAuth as realUseAuth } from '@/context/AuthContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { reportAtomicFailure } from '@/lib/atomicFailure';
/* eslint-enable import/first */

const err = (code: string) => Object.assign(new Error('x'), { code });
beforeEach(() => {
  jest.clearAllMocks();
  mockGoogle = { request: {}, response: null, prompt: jest.fn(async () => ({ type: 'dismiss' })) };
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
const renderAuth = () => render(<ThemeProvider><AuthScreen /></ThemeProvider>);

describe('mapError', () => {
  it('الأكواد الجديدة', () => {
    expect(mapError('auth/network-request-failed')).toBe('مفيش نت. وصّل النت وجرّب تاني');
    expect(mapError('auth/user-disabled')).toMatch(/الحساب ده متوقف/);
    expect(mapError('auth/invalid-login-credentials')).toBe('الإيميل أو الباسورد غلط');
    expect(mapError('auth/account-exists-with-different-credential')).toMatch(/بطريقة تانية/);
    expect(mapError('auth/operation-not-allowed')).toMatch(/مش متاحة دلوقتي/);
    expect(mapError('auth/operation-not-allowed')).toBe('الطريقة دي مش متاحة دلوقتي. جرّب تاني بعد شوية أو بطريقة تانية.');
    // «جرّب» في كل الرسايل، مش «حاول» (arabic-copy-reviewer)
    for (const c of ['auth/too-many-requests', 'auth/network-request-failed', 'auth/operation-not-allowed', 'x']) {
      expect(mapError(c)).not.toMatch(/حاول/);
    }
    expect(mapError('auth/email-already-in-use')).toContain('لو سجّلت بجوجل، ادخل بزرار جوجل.');
    expect(mapError('whatever')).toBe('حصل خطأ، جرّب تاني');
  });
});

describe('جوجل', () => {
  it('نجاح من غير توكن ← رسالة مش سكوت', async () => {
    mockGoogle.response = { type: 'success', params: {} };
    await renderAuth();
    expect(screen.getByText(GOOGLE_FAILED)).toBeTruthy();
    expect(GOOGLE_FAILED).toBe('مقدرناش ندخلك بجوجل. جرّب تاني');
    expect(mockAuth.signInWithGoogleCredential).not.toHaveBeenCalled();
  });
  it('فايربيز رفضت بكود النت ← رسالة النت، وSentry بالكود بس', async () => {
    mockAuth.signInWithGoogleCredential.mockRejectedValueOnce(err('auth/network-request-failed'));
    mockGoogle.response = { type: 'success', params: { id_token: 't' } };
    await renderAuth();
    await act(async () => {});
    expect(screen.getByText('مفيش نت. وصّل النت وجرّب تاني')).toBeTruthy();
    expect(reportAtomicFailure).toHaveBeenCalledWith('دخول جوجل', expect.objectContaining({ code: 'auth/network-request-failed' }));
  });
  it('جوجل رجّعت error ← نفس الرسالة الموحّدة', async () => {
    mockGoogle.response = { type: 'error' };
    await renderAuth();
    expect(screen.getByText(GOOGLE_FAILED)).toBeTruthy();
  });
  it('promptAsync رمى ← رسالة مش unhandled', async () => {
    mockGoogle.prompt = jest.fn(async () => { throw new Error('browser'); });
    await renderAuth();
    await act(async () => { fireEvent.press(screen.getByTestId('auth_google_button')); });
    expect(screen.getByText(GOOGLE_FAILED)).toBeTruthy();
  });
  it('الطلب لسه ما اتجهزش ← الزرار مقفول', async () => {
    mockGoogle.request = null;
    await renderAuth();
    expect(screen.getByTestId('auth_google_button').props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
    await act(async () => { fireEvent.press(screen.getByTestId('auth_google_button')); });
    expect(mockGoogle.prompt).not.toHaveBeenCalled();
  });
});

describe('نصوص شاشة الدخول', () => {
  it('فاضي ← «لازم تكتب كل الحقول»', async () => {
    await renderAuth();
    await act(async () => { fireEvent.press(screen.getByTestId('auth_submit_button')); });
    expect(screen.getByText('لازم تكتب كل الحقول')).toBeTruthy();
  });
  it('وضع التسجيل: «اعمل حسابك» و«عندك حساب؟»', async () => {
    await renderAuth();
    await act(async () => { fireEvent.press(screen.getByTestId('auth_switch_mode')); });
    expect(screen.getByText('اعمل حسابك')).toBeTruthy();
    expect(screen.getByTestId('auth_switch_mode')).toHaveTextContent(/عندك حساب؟/);
  });
  it('رابط الباسورد: «راجع إيميلك» والجملة مبتأكدش إن الحساب موجود', async () => {
    await renderAuth();
    await act(async () => { fireEvent.changeText(screen.getByTestId('auth_email_input'), 'a@b.co'); });
    await act(async () => { fireEvent.press(screen.getByTestId('auth_reset_button')); });
    expect(RESET_TITLE).toBe('راجع إيميلك');
    expect(resetSentBody('a@b.co')).toBe('لو فيه حساب على a@b.co، هيوصله رابط تغيّر منه الباسورد. لو ملقتهوش في الوارد، بصّ في الـSpam.');
    expect((Alert.alert as unknown as jest.Mock).mock.calls[0][0]).toBe('راجع إيميلك');
  });
});

describe('12: التسجيل (AuthContext)', () => {
  const holder: { current: ReturnType<typeof realUseAuth> | null } = { current: null };
  // useAuth متبدّل في الملف ده — بنقرا الـcontext الحقيقي من AuthProvider بـProbe بيستخدم الأصلي
  const { useAuth: actualUseAuth } = jest.requireActual('@/context/AuthContext');
  function Probe() { holder.current = actualUseAuth(); return null; }
  const user = { uid: 'u1' };
  beforeEach(() => {
    mockFa.createUserWithEmailAndPassword.mockResolvedValue({ user });
    mockFa.updateProfile.mockResolvedValue(undefined);
    mockFa.sendEmailVerification.mockResolvedValue(undefined);
    mockSetDoc.mockResolvedValue(undefined);
    mockFa.currentUser = null;
  });

  it('الاسم وقع ← بيانات المستخدم بتتكتب وإيميل التأكيد بيتبعت، والكود بيوصل Sentry', async () => {
    mockFa.updateProfile.mockRejectedValueOnce(err('auth/network-request-failed'));
    await render(<AuthProvider><Probe /></AuthProvider>);
    await act(async () => { await holder.current!.signUp('a@b.co', '123456', 'أحمد'); });
    expect(mockSetDoc).toHaveBeenCalled();
    expect(mockFa.sendEmailVerification).toHaveBeenCalledWith(user);
    expect(reportAtomicFailure).toHaveBeenCalledWith('التسجيل: الاسم', expect.anything());
  });
  it('كتابة users وقعت ← Sentry', async () => {
    mockSetDoc.mockRejectedValueOnce(err('permission-denied'));
    await render(<AuthProvider><Probe /></AuthProvider>);
    await act(async () => { await holder.current!.signUp('a@b.co', '123456', 'أحمد'); });
    await act(async () => {});
    expect(reportAtomicFailure).toHaveBeenCalledWith('التسجيل: بيانات المستخدم', expect.anything());
  });
  it('إيميل التأكيد وقع ← Sentry بالكود', async () => {
    mockFa.sendEmailVerification.mockRejectedValueOnce(err('auth/too-many-requests'));
    await render(<AuthProvider><Probe /></AuthProvider>);
    await act(async () => { await holder.current!.signUp('a@b.co', '123456', 'أحمد'); });
    expect(reportAtomicFailure).toHaveBeenCalledWith('التسجيل: إيميل التأكيد', expect.objectContaining({ code: 'auth/too-many-requests' }));
  });
  it('إعادة إرسال التأكيد من غير مستخدم ← بترمي (مش نجاح ساكت)', async () => {
    await render(<AuthProvider><Probe /></AuthProvider>);
    await expect(holder.current!.resendVerificationEmail()).rejects.toThrow();
  });
});
