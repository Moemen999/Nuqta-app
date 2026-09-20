// إعداد Expo ديناميكي — موجود عشان `versionCode` يتحط وقت البناء.
//
// العدّاد هو `run_number` بتاع GitHub Actions، والورك فلو بيمرره في
// `NUQTA_RUN_NUMBER`. اخترناه لأن أوتو-إنكريمنت بتاع EAS **مبيشتغلش** مع
// `eas build --local`: التوثيق بيوصف `appVersionSource: "remote"` من غير ما
// يذكر `--local` خالص، وردّ Expo نفسه (brentvatne في expo/expo#17606) نصه:
// "its not supported at the moment, the `local` flag isn't intended to
// support all `remote` features".
//
// ⚠️ اقرا قسم "رقم البناء" في CLAUDE.md قبل ما تلمس أي حاجة هنا. باختصار:
// متمسحش ولا تعيد إنشاء ملف الورك فلو، ومتستخدمش زرار Re-run في GitHub.

const RUN_NUMBER_OFFSET = 5;

/**
 * الرقم اللي المستخدم شايفه = run_number − 5، بصفر على الشمال لتلات خانات.
 *
 * الطرح ده عشان البناء الجاي يطلع 000: الورك فلو كان اشتغل 5 مرات قبل ما
 * نربط العدّاد، والأرقام دي مش بتترجع. والصفر على الشمال بيكبر لوحده بعد
 * 999 (padStart مبيقصّش).
 *
 * العدّاد **مبيترجعش** لما إصدار التطبيق يتغيّر — هو رقم بناء مش رقم إصدار.
 */
function displayBuildNumber(runNumber) {
  return String(Math.max(0, runNumber - RUN_NUMBER_OFFSET)).padStart(3, '0');
}

function resolveBuild() {
  const raw = process.env.NUQTA_RUN_NUMBER;
  // بناء محلي على جهاز مطوّر: مفيش run_number، والرقم مالوش معنى
  if (!raw) return { versionCode: 1, buildNumber: 'dev' };

  const runNumber = Number(raw);
  // أقل رقم مقبول هو الإزاحة نفسها: 5 بيدّي 000، وده أول رقم بناء معروض.
  // أي رقم أقل معناه إن العدّاد اترجّع (ملف الورك فلو اتعمل من جديد)، وساعتها
  // الأرقام هتتكرر مع بناءات قديمة — فبنقف بدل ما نطلع APK برقم متكرر.
  if (!Number.isInteger(runNumber) || runNumber < RUN_NUMBER_OFFSET) {
    throw new Error(
      `NUQTA_RUN_NUMBER لازم يبقى رقم صحيح مش أقل من ${RUN_NUMBER_OFFSET}، وجه "${raw}". `
      + 'شوف قسم "رقم البناء" في CLAUDE.md.'
    );
  }
  return { versionCode: runNumber, buildNumber: displayBuildNumber(runNumber) };
}

/**
 * الـDSN بتاع Sentry بييجي من البيئة، **مش** من الريبو.
 *
 * هو مش سر بطبيعته (بيتشحن جوه أي تطبيق موبايل وأي حد يقدر يطلّعه من الـAPK)،
 * بس بنسيبه برّه الكود عشان حاجة تانية: من غيره Sentry مبتشتغلش خالص، فأي
 * بناء محلي أو fork مبيبعتش أخطاء لمشروعنا ومبيلخبطش أرقامنا.
 */
function resolveSentryDsn() {
  return process.env.EXPO_PUBLIC_SENTRY_DSN || undefined;
}

module.exports = ({ config }) => {
  const { versionCode, buildNumber } = resolveBuild();
  return {
    ...config,
    android: { ...config.android, versionCode },
    extra: { ...config.extra, buildNumber, sentryDsn: resolveSentryDsn() },
  };
};
