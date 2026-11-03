/**
 * إعداد الدخول بجوجل — مكان واحد لشاشة الدخول وشاشة مسح الحساب (إعادة الدخول قبل المسح).
 * الأرقام دي **مش سر**: Client IDs عمومية بطبيعتها (OAuth)، والحماية في ربطها بالـSHA-1 وبالمشروع.
 */
// الـ Web Client ID بتاع مشروع Firebase "nuqta" — عمومي وآمن يتحط في الكود
export const GOOGLE_WEB_CLIENT_ID = '662258111881-r6c7jaudqjeud0oa7dsn119rf0tsv4tu.apps.googleusercontent.com';
// الـ Android Client ID (مرتبط بـ SHA-1 بتاع نسخة preview) — لازم يتحدث لو الـ keystore اتغيّر
export const GOOGLE_ANDROID_CLIENT_ID = '662258111881-suhr5mgqa116f56p5439mq5gmaj8682e.apps.googleusercontent.com';
// جوجل بترفض الـ scheme العادي لتطبيقات أندرويد وبتطلب الصيغة دي المبنية على الـ Client ID نفسه (معكوسة)
export const GOOGLE_REVERSED_SCHEME = 'com.googleusercontent.apps.662258111881-suhr5mgqa116f56p5439mq5gmaj8682e';
// جوجل بتطلب شرطة واحدة بعد النقطتين في الصيغة دي (scheme:/path مش scheme://path)
export const GOOGLE_REDIRECT_URI = `${GOOGLE_REVERSED_SCHEME}:/oauth2redirect`;
