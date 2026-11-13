import { useAuth } from '@/context/AuthContext';
import { useBusy } from '@/lib/useBusy';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * حالة «إيميلك لسه مش مأكّد» اتشالت من `EmailVerificationBanner` (كانت جوه `app/(tabs)/index.tsx`) لهوك،
 * عشان عدّاد «حاجات محتاجة انتباهك» يعرفها (2026-11-13). **السلوك زي ما هو بالظبط:**
 * بيطلب إيميل وباسورد ولسه مش مأكّد (مستخدمين جوجل مأكّدين تلقائيًا)، وبيعمل `user.reload()` أول
 * ما الشاشة تفتح وكل ما التطبيق يرجع active — فايربيز بتخزّن الحالة في الكاش ومبتحدّثهاش لما المستخدم
 * يدوس اللينك في إيميله، وده اللي بيخلّي التنبيه يختفي من غير خروج ودخول. من غير نت `reload` بيفشل
 * والحالة اللي عندنا بتفضل. زرار إعادة الإرسال بحالاته (مشغول / اتبعت / فشل) هنا كمان عشان تفضل
 * عايشة لما الشيت يتقفل ويتفتح.
 */

/**
 * رسالة التأكيد **بتوصل** — بس بتقع في الـSpam (اتأكد 2026-09-28 بحساب جديد).
 * المستخدم اللي مش لاقيها في الوارد هيفتكر التطبيق بايظ، فالسطر ده ظاهر على طول
 * مع التنبيه. نفس صياغة رابط "نسيت الباسورد؟" (`resetSentBody`).
 */
export const VERIFY_SPAM_HINT = 'رسالة التأكيد لو ملقتهاش في الوارد، بصّ في الـSpam.';

export const VERIFY_RESEND_LABEL = 'أعد إرسال رسالة التأكيد';
export const VERIFY_SENT_TEXT = 'بعتنالك رسالة تأكيد جديدة، شوف إيميلك';
export const VERIFY_RESEND_FAILED = 'مقدرناش نبعت الرسالة دلوقتي، جرب كمان شوية';

export type EmailVerification = {
  /** الإيميل لو لسه مش مأكّد (إيميل وباسورد)، وإلا null */
  unverifiedEmail: string | null;
  busy: boolean;
  sent: boolean;
  error: string;
  resend: () => void;
};

export function useEmailVerification(): EmailVerification {
  const { user, resendVerificationEmail } = useAuth();
  const { busy, run: runResend } = useBusy();
  const [verified, setVerified] = useState(true);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const usesPassword = !!user?.providerData?.some(p => p.providerId === 'password');

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      await user.reload();
    } catch {
      // لو مفيش نت، بنسيب الحالة اللي عندنا زي ما هي
    }
    setVerified(!!user.emailVerified);
  }, [user]);

  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  function resend() {
    setError('');
    runResend(async () => {
      try {
        await resendVerificationEmail();
        setSent(true);
      } catch (err) {
        // رسالة المستخدم فاضلة زي ما هي — التسجيل ده للتشخيص بس
        console.error('[auth] resendVerificationEmail failed:', err);
        setError(VERIFY_RESEND_FAILED);
      }
    });
  }

  const unverifiedEmail = !user || !usesPassword || verified ? null : (user.email ?? '');
  return { unverifiedEmail, busy, sent, error, resend };
}
