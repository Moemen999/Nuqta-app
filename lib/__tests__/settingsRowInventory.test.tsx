import SettingsScreen from '@/app/(tabs)/settings';
import { ThemeProvider } from '@/context/ThemeContext';
import { render, screen } from '@testing-library/react-native';
import React from 'react';

/**
 * جرد صفوف الإعدادات.
 *
 * إعادة التنظيم ضيّعت قسم القفل من غير ما حد يلاحظ، لأن مفيش اختبار كان
 * بيسأل "كل الصفوف لسه هنا؟". الاختبار ده بيسأل: أي نقلة جاية بترمي صف
 * أو قسم هتفشّله.
 *
 * ملحوظة مقصودة: الاختبار ده بيغطي **وجود** الصفوف بس. سلوك كل شاشة جوّه
 * ليه اختباراته لوحده (زي `settingsLockControls`) — عشان فشل الجرد يقول
 * "صف ضاع" بالظبط مش "حاجة في الإعدادات بايظة".
 */

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'test@nuqta.app' }, logOut: jest.fn() }),
}));
jest.mock('@/context/AppLockContext', () => ({
  useAppLock: () => ({ enabled: false }),
}));
jest.mock('@/context/NotificationsContext', () => ({
  useNotifications: () => ({ enabled: false, dailyEnabled: false, dailyHour: 20 }),
}));
jest.mock('@/context/DataContext', () => ({
  useData: () => ({ wallets: [], categories: [], pendingWrites: 0 }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

/** كل قسم وكل صف كان موجود قبل إعادة التنظيم أو اتضاف بعدها بموافقة */
const EXPECTED_SECTIONS = ['بياناتك', 'التطبيق', 'المساعدة', 'الحساب'];
const EXPECTED_ROWS = [
  'المحافظ',
  'الفئات',
  'أرشيف العمليات وتصدير إكسيل',
  'الإشعارات',
  'قفل التطبيق',
  'الشكل',
  'دليل المستخدم',
  'إعادة عرض شاشة الترحيب',
  'شاركنا رأيك',
  'عن التطبيق',
  'تسجيل الخروج',
];

async function renderSettings() {
  return render(<ThemeProvider><SettingsScreen /></ThemeProvider>);
}

describe('جرد شاشة الإعدادات', () => {
  it('كل الأقسام موجودة', async () => {
    await renderSettings();
    EXPECTED_SECTIONS.forEach(title => expect(screen.getByText(title)).toBeTruthy());
  });

  it('كل الصفوف موجودة', async () => {
    await renderSettings();
    EXPECTED_ROWS.forEach(title => expect(screen.getByText(title)).toBeTruthy());
  });

  it('إيميل المستخدم ظاهر — كان تحت العنوان وبقى تحت "الحساب"', async () => {
    await renderSettings();
    expect(screen.getByText('test@nuqta.app')).toBeTruthy();
  });

  it('صف القفل بيوصّل لشاشة القفل مش لمودال التغيير على طول', async () => {
    // الباگ كان إن الصف بيفتح 'change' فورًا، فإلغاء القفل مكانش ليه أي طريق
    const src = require('fs').readFileSync('app/(tabs)/settings.tsx', 'utf8');
    expect(src).toContain("router.push('/settings-screens/lock')");
    expect(src).not.toContain("setLockModalMode(lockEnabled ? 'change' : 'enable')");
  });
});
