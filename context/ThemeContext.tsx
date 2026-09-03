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
  warnBorder: string;
};

// إلهام قناع توت عنخ آمون: الدهبي (المعدن)، الأزرق العميق (اللازورد في الخطوط واللحية)،
// والدرجات الدافية (العقيق الأحمر والفيروز) بدل الألوان المحايدة العادية
const DARK: ThemeColors = {
  bg: '#0A0E14', surface: '#151B24', surface2: '#1C2530', nav: '#0E131A',
  border: '#1C2530', borderStrong: '#28323F',
  text: '#F0E6D2', textSecondary: '#9CA8B8', textMuted: '#5C6A7A',
  danger: '#C1554A', dangerBorder: '#5A2E28',
  success: '#4E9E7A', accent: '#C9A961', onAccent: '#0A0E14',
  warnBorder: '#5A4A20',
};

const LIGHT: ThemeColors = {
  bg: '#F5EFE0', surface: '#FFFDF7', surface2: '#F0E8D4', nav: '#FFFDF7',
  border: '#E3D7BA', borderStrong: '#CDBB94',
  text: '#2B2416', textSecondary: '#7A6B4E', textMuted: '#A6997A',
  danger: '#C1554A', dangerBorder: '#E8C4BE',
  success: '#4E9E7A', accent: '#C9A961', onAccent: '#0A0E14',
  warnBorder: '#E3D2A0',
};

type ThemeContextType = {
  theme: ThemeName;
  colors: ThemeColors;
  setTheme: (t: ThemeName) => void;
  toggleTheme: () => void;
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
  function toggleTheme() {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }

  const colors = theme === 'dark' ? DARK : LIGHT;

  return (
    <ThemeContext.Provider value={{ theme, colors, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}