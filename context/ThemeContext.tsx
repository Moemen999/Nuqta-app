import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type ThemeName = 'dark' | 'light';

export type ThemeColors = {
  bg: string;
  surface: string;
  surface2: string;
  nav: string;
  border: string;
  borderStrong: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  danger: string;
  dangerBorder: string;
  success: string;
  accent: string;
  onAccent: string;
  /**
   * الدهبي **كنص** (2026-09-29). `accent` (#C9A961) على الكريمي في الفاتح 2.2:1
   * بس — كلام البانرات ومبلغ السحب كانوا باهتين (اتشاف على الـRedmi). في الفاتح
   * ده الدهبي الغامق اللي في الباليتة أصلاً (`selectedBorder`)، مش لون جديد؛
   * في الغامق هو `accent` نفسه. النسب في theme.contrast.test.ts.
   */
  accentText: string;
  /**
   * مبلغ المصروف والدخل **كنص** (2026-09-29). في الفاتح الأحمر/الأخضر الفاتحين
   * كانوا 2.99:1 و2.59:1 على الكريمي — دي أرقام كل سطر في الرئيسية والأرشيف. في
   * الفاتح دول الأحمر والأخضر الغامقين اللي في الباليتة أصلاً
   * (`selectedDangerBorder`/`selectedSuccessBorder`)؛ في الغامق نفس اللونين
   * القدام بالظبط (#D97878/#7FA98F). النسب في theme.contrast.test.ts.
   */
  expenseText: string;
  /** الأحمر كنص (خطأ، "حذف"، بانر خطر) — `danger` كنص تحت 4.5 (4.42 في الفاتح). نفس قيم expenseText */
  dangerText: string;
  incomeText: string;
  warnBorder: string;
  /**
   * ألوان العنصر المختار في أي مجموعة اختيار (محفظة، فئة، نوع، تاب...).
   *
   * قبل كده الاختيار كان إطار دهبي رقيق بس (`accent`). في الوضع الفاتح ده
   * كان بيضيع: الإطار الدهبي ضد الخلفية الدافية = 1.96:1، وضد إطار العنصر
   * غير المختار = 1.19:1 — يعني المختار وغير المختار شكلهم واحد تقريبًا.
   * فبقى فيه خلفية ملوّنة خفيفة + إطار أغمق، والاختيار بيتقري بالمساحة مش
   * بخط رقيق. النسب متقاسة في lib/__tests__/theme.contrast.test.ts.
   */
  selectedBg: string;
  selectedBorder: string;
  selectedSuccessBg: string;
  selectedSuccessBorder: string;
  selectedDangerBg: string;
  selectedDangerBorder: string;
  /**
   * ألوان الرسوم (شرايح التقارير ونقط المحافظ والفئات).
   *
   * ليها نسخة لكل ثيم عن قصد: لون واحد ينفع على خلفية فاتحة وغامقة مع بعض
   * شبه مستحيل، والقلب الآلي بيطلّع ألوان وحشة. فالنسختين متختارين ومتقاسين
   * كل واحدة على خلفياتها.
   *
   * الباليتة القديمة كانت فاشلة في أربع فحوصات مش واحدة (شوف
   * lib/__tests__/theme.chart.test.ts): ستة من تمن ألوان تحت حد التشبّع
   * فبيتقروا رمادي، والتفريق عند عمى الألوان 4.2 (الحد 8)، وحتى بعين
   * سليمة تمامًا أقرب لونين كان بينهم 10.3 (الحد 15) — يعني حد شايف كويس
   * مكانش يعرف يفرّق بينهم.
   */
  chartPalette: string[];
};

// إلهام قناع توت عنخ آمون: الدهبي (المعدن)، الأزرق العميق (اللازورد في الخطوط واللحية)،
// والدرجات الدافية (العقيق الأحمر والفيروز) بدل الألوان المحايدة العادية
export const DARK: ThemeColors = {
  bg: '#0A0E14', surface: '#151B24', surface2: '#1C2530', nav: '#0E131A',
  border: '#1C2530', borderStrong: '#28323F',
  // textMuted كان 2.8–3.5:1 — تحت 4.5 (WCAG 1.4.3)؛ بقى ≥4.5 على كل الخلفيات (بند E، theme.contrast.test)
  text: '#F0E6D2', textSecondary: '#9CA8B8', textMuted: '#808D9D',
  danger: '#C1554A', dangerBorder: '#5A2E28',
  success: '#4E9E7A', accent: '#C9A961', onAccent: '#0A0E14', accentText: '#C9A961',
  expenseText: '#D97878', incomeText: '#7FA98F', dangerText: '#D97878',
  warnBorder: '#5A4A20',
  selectedBg: '#3B321D', selectedBorder: '#C9A961',
  selectedSuccessBg: '#16332A', selectedSuccessBorder: '#4E9E7A',
  selectedDangerBg: '#3A1E1A', selectedDangerBorder: '#CC6055',
  chartPalette: ['#3987E5', '#D95926', '#199E70', '#C98500', '#D55181', '#008300', '#9085E9', '#E66767'],
};

export const LIGHT: ThemeColors = {
  bg: '#F5EFE0', surface: '#FFFDF7', surface2: '#F0E8D4', nav: '#FFFDF7',
  border: '#E3D7BA', borderStrong: '#CDBB94',
  // textMuted كان 2.3–2.8:1 وtextSecondary 4.26 على surface2 — الاتنين بقوا ≥4.5 (بند E). الثانوي أغمق بدرجة باينة (1.36:1
  // بينهم، زي الغامق 1.40) عشان التلات مستويات (نص/ثانوي/باهت) ميبقوش اتنين (visual-identity-reviewer)
  text: '#2B2416', textSecondary: '#5E5239', textMuted: '#736648',
  danger: '#C1554A', dangerBorder: '#E8C4BE',
  success: '#4E9E7A', accent: '#C9A961', onAccent: '#0A0E14', accentText: '#7D6320',
  expenseText: '#A8453B', incomeText: '#2F654B', dangerText: '#A8453B',
  warnBorder: '#E3D2A0',
  selectedBg: '#D9C07A', selectedBorder: '#7D6320',
  selectedSuccessBg: '#B2D9C5', selectedSuccessBorder: '#2F654B',
  selectedDangerBg: '#F2C9C3', selectedDangerBorder: '#A8453B',
  chartPalette: ['#2A78D6', '#C4501F', '#0F8F62', '#A87200', '#CC5A83', '#008300', '#4A3AA7', '#C2332F'],
};

type ThemeContextType = {
  theme: ThemeName;
  colors: ThemeColors;
  setTheme: (t: ThemeName) => void;
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);
const STORAGE_KEY = 'nuqta-theme';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>('dark');

  useEffect(() => {
    (async () => {
      try {
        const v = await AsyncStorage.getItem(STORAGE_KEY);
        if (v === 'light' || v === 'dark') setThemeState(v);
      } catch {
        // لو التخزين المحلي مش متاح لأي سبب، التطبيق يكمل بالوضع الافتراضي
      }
    })();
  }, []);

  function setTheme(t: ThemeName) {
    setThemeState(t);
    AsyncStorage.setItem(STORAGE_KEY, t).catch(() => {});
  }

  const colors = theme === 'dark' ? DARK : LIGHT;

  return (
    <ThemeContext.Provider value={{ theme, colors, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}