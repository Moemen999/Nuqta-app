import { Redirect } from 'expo-router';

/**
 * بيستقبل رجوع تسجيل الدخول بجوجل (nuqtaapp://oauth2redirect?...)
 * expo-auth-session بيقرا الكود من الرابط بنفسه، فالشاشة دي بس بترجّع للتطبيق
 * من غير ما يظهر "Unmatched Route".
 */
export default function OAuthRedirect() {
  return <Redirect href="/" />;
}
