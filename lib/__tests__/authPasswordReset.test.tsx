import AuthScreen, { RESET_LABEL, RESET_NEEDS_EMAIL, RESET_TITLE } from '@/app/(auth)/index';
import { ThemeProvider } from '@/context/ThemeContext';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';

/**
 * ده الطرف التاني لمخرج "نسيت الكود؟" في شاشة القفل.
 *
 * هناك بنشيل القفل وبنخرّج المستخدم من حسابه، وبنفترض إنه يقدر يدخل تاني.
 * الافتراض ده كان غلط لناس حقيقية: اللي سجّل بإيميل وباسورد ونسي الاتنين
 * (كود القفل وباسورد الحساب) مكانش قدامه أي طريق يرجع لفلوسه — مكانش فيه
 * `sendPasswordResetEmail` في التطبيق كله.
 */

const mockAuth = {
  signIn: jest.fn(async () => {}),
  signUp: jest.fn(async () => {}),
  signInWithGoogleCredential: jest.fn(async () => {}),
  resetPassword: jest.fn(async (_email: string) => {}),
};

jest.mock('@/context/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('expo-auth-session/providers/google', () => ({
  useAuthRequest: () => [null, null, jest.fn()],
}));
jest.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: jest.fn() }));

async function renderAuth() {
  return render(<ThemeProvider><AuthScreen /></ThemeProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('شاشة الدخول بتقدّم كل الطرق', () => {
  it('جوجل موجود', async () => {
    await renderAuth();
    expect(screen.getByText('تسجيل الدخول بحساب جوجل')).toBeTruthy();
  });

  it('إيميل وباسورد موجودين', async () => {
    await renderAuth();
    expect(screen.getByTestId('auth_email_input')).toBeTruthy();
    expect(screen.getByTestId('auth_password_input')).toBeTruthy();
  });

  it('و"نسيت الباسورد؟" موجود', async () => {
    await renderAuth();
    expect(screen.getByTestId('auth_reset_button')).toBeTruthy();
    expect(screen.getByText(RESET_LABEL)).toBeTruthy();
  });

  it('مش بيظهر في وضع إنشاء حساب — مالوش معنى هناك', async () => {
    await renderAuth();
    await act(async () => { fireEvent.press(screen.getByText('لسه معندكش حساب؟ سجّل واحد')); });
    expect(screen.queryByTestId('auth_reset_button')).toBeNull();
  });
});

describe('"نسيت الباسورد؟"', () => {
  it('من غير إيميل بيقول اكتب إيميلك الأول ومبيبعتش', async () => {
    await renderAuth();
    await act(async () => { fireEvent.press(screen.getByTestId('auth_reset_button')); });

    expect(mockAuth.resetPassword).not.toHaveBeenCalled();
    expect(screen.getByText(RESET_NEEDS_EMAIL)).toBeTruthy();
  });

  it('بيبعت على الإيميل المكتوب، متقلّم', async () => {
    await renderAuth();
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('auth_email_input'), '  ahmed@example.com  ');
    });
    await act(async () => { fireEvent.press(screen.getByTestId('auth_reset_button')); });

    expect(mockAuth.resetPassword).toHaveBeenCalledWith('ahmed@example.com');
  });

  it('بيقول للمستخدم إنه بعت، وبينبّه اللي داخل بجوجل', async () => {
    await renderAuth();
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('auth_email_input'), 'ahmed@example.com');
    });
    await act(async () => { fireEvent.press(screen.getByTestId('auth_reset_button')); });

    const [title, body] = (Alert.alert as unknown as jest.Mock).mock.calls[0];
    expect(title).toBe(RESET_TITLE);
    expect(body).toContain('ahmed@example.com');
    expect(body).toContain('جوجل');
  });

  it('الفشل بيبان — مش بيتبلع', async () => {
    mockAuth.resetPassword.mockRejectedValueOnce(
      Object.assign(new Error('x'), { code: 'auth/network-request-failed' })
    );
    await renderAuth();
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('auth_email_input'), 'ahmed@example.com');
    });
    await act(async () => { fireEvent.press(screen.getByTestId('auth_reset_button')); });

    expect(screen.getByText('مفيش نت. وصّل النت وحاول تاني')).toBeTruthy();
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('الزرار بيرجع شغال بعد الفشل — مش بيفضل "..." للأبد', async () => {
    mockAuth.resetPassword.mockRejectedValueOnce(
      Object.assign(new Error('x'), { code: 'auth/too-many-requests' })
    );
    await renderAuth();
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('auth_email_input'), 'ahmed@example.com');
    });
    await act(async () => { fireEvent.press(screen.getByTestId('auth_reset_button')); });

    expect(screen.getByText(RESET_LABEL)).toBeTruthy();
  });
});
