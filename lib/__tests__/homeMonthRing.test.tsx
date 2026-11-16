import React from 'react';
import { processColor } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import MonthSummaryCard, { type MonthCardState } from '@/components/MonthSummaryCard';
import { PrivacyProvider, HIDE_AMOUNTS_KEY } from '@/context/PrivacyContext';
import { ThemeProvider, useTheme } from '@/context/ThemeContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { budgetLevel } from '@/lib/budgetForecast';
import { progressRing } from '@/lib/tokens';
import { snapPiastre } from '@/lib/finance';

/** دايرة الميزانية في كارت الشهر: نفس `spent`/`limit` بتوع الكارت، من غير ميزانية/تحميل ما تظهرش، وتفضل والمبالغ مخفية */
jest.mock('@/lib/useReduceMotion', () => ({ useReduceMotion: () => true }));

let colors: ReturnType<typeof useTheme>['colors'];
function Probe() { colors = useTheme().colors; return null; }
const wrap = (c: React.ReactNode) => <ThemeProvider><PrivacyProvider><Probe />{c}</PrivacyProvider></ThemeProvider>;
const ready = (spent: number, limit: number | null, budgetsFailed = false): MonthCardState => ({
  kind: 'ready', transfersFailed: false, budgetsFailed,
  summary: { spent, previous: null, budget: limit ? { limit, remaining: snapPiastre(limit - spent), level: budgetLevel(spent, limit) } : null } as never,
});
const show = (s: MonthCardState) => render(wrap(<MonthSummaryCard testID="m" onPress={() => {}} state={s} />));
const ring = () => screen.queryByTestId('home_month_ring', { includeHiddenElements: true });
const fill = () => screen.getByTestId('home_month_ring_fill', { includeHiddenElements: true });

describe('دايرة كارت الشهر', () => {
  it('1000 من 4000 = 25% (من نفس أرقام الكارت)', async () => {
    await show(ready(1000, 4000));
    expect(ring()).not.toBeNull();
    const c = 2 * Math.PI * ((progressRing.compact.size - progressRing.compact.stroke) / 2);
    const off = fill().props.strokeDashoffset;
    expect(Number(off?.__getValue?.() ?? off)).toBeCloseTo(c * 0.75, 3);
  });
  it('اللون زي لون شريط الكارت (under رمادي، near دهبي)', async () => {
    await show(ready(1000, 4000));
    expect(fill().props.stroke.payload).toBe(processColor(colors.textSecondary));
  });
  it('near ← دهبي', async () => {
    await show(ready(900, 1000));
    expect(fill().props.stroke.payload).toBe(processColor(colors.accentText));
  });
  it('من غير ميزانية: مفيش دايرة', async () => {
    await show(ready(1000, null));
    expect(ring()).toBeNull();
  });
  it('ميزانية فشلت جلبها: مفيش دايرة', async () => {
    await show(ready(1000, 4000, true));
    expect(ring()).toBeNull();
  });
  it('تحميل وخطأ: مفيش دايرة', async () => {
    await show({ kind: 'loading' });
    expect(ring()).toBeNull();
    await show({ kind: 'error' });
    expect(ring()).toBeNull();
  });
  it('بتفضل باينة والمبالغ مخفية، ومخفية عن القارئ', async () => {
    await AsyncStorage.setItem(HIDE_AMOUNTS_KEY, 'true');
    await show(ready(1000, 4000));
    expect(await screen.findByTestId('home_month_ring', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId('home_month_ring')).toBeNull(); // مخفية عن شجرة الوصولية
  });
});
