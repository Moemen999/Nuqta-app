import { readFileSync } from 'fs';
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import ArchiveScreen from '@/app/archive';
import ReportsScreen from '@/app/(tabs)/reports';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { PERIOD_PRESET_WORDS, PREVIOUS_PERIOD_LABEL, chipText, periodPresets } from '@/lib/periodPresets';
import { MIN_TOUCH } from '@/lib/tokens';

/**
 * شرايح الفترة في التقارير والأرشيف:
 * - عامية مصري مش فصحى (قاعدة 1) — "هذا الشهر"/"الشهر الماضي"/"مخصص" كانت
 *   فصحى في أكتر شاشتين بيتفتحوا
 * - مفيش مسافة عادية جوه الشريحة + `numberOfLines={1}`: "هذا الشهر" كانت
 *   بتترسم "هذا" بس على 1.0.0.002. **السبب ماتشافش على الجهاز** — الإصلاح
 *   مش معتمد عليه (نفس `categoryLabelWrap.test.ts`)
 * - الشريحة طولها 44 على الأقل (كانت ~32 محسوبة من الأرقام، مش متقاسة)
 */

const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const FUSHA = /هذا|الماضي|مخصص|كل الوقت|السابقة|إلى/;

beforeEach(() => {
  Object.assign(mockData, {
    transactions: [], wallets: [], categories: [], debts: [], pendingTxIds: new Set(), serverReachable: true,
  });
});

describe('أسامي الفترات', () => {
  it('عامية مصري، مش فصحى', () => {
    expect(PERIOD_PRESET_WORDS).toEqual({
      thisMonth: 'الشهر ده', last7: 'آخر 7 أيام', lastMonth: 'الشهر اللي فات', all: 'الكل', custom: 'تواريخ تانية',
    });
    for (const w of [...Object.values(PERIOD_PRESET_WORDS), PREVIOUS_PERIOD_LABEL]) expect(w).not.toMatch(FUSHA);
  });

  it('الشريحة مفيهاش مسافة عادية تتكسر عندها — والكلام نفسه زي ما هو', () => {
    for (const p of periodPresets(['thisMonth', 'last7', 'lastMonth', 'all', 'custom'])) {
      expect(p.label).not.toContain(' ');
      expect(p.label.replace(/ /g, ' ')).toBe(PERIOD_PRESET_WORDS[p.key]);
    }
    expect(chipText('الشهر اللي فات')).toBe('الشهر اللي فات');
  });
});

describe.each([
  ['التقارير', ReportsScreen, 'reports_preset_', ['thisMonth', 'last7', 'lastMonth', 'custom']],
  ['الأرشيف', ArchiveScreen, 'archive_preset_', ['thisMonth', 'last7', 'lastMonth', 'all', 'custom']],
] as const)('شرايح الفترة في %s', (_name, Screen, prefix, keys) => {
  it('كل شريحة: الكلام المصري بمسافة مبتتكسرش، سطر واحد، و44 على الأقل', async () => {
    await render(<ThemeProvider><PrivacyProvider><Screen /></PrivacyProvider></ThemeProvider>);
    for (const key of keys) {
      const chip = screen.getByTestId(`${prefix}${key}`);
      expect(StyleSheet.flatten(chip.props.style).minHeight).toBeGreaterThanOrEqual(MIN_TOUCH);
      const text = screen.getByText(chipText(PERIOD_PRESET_WORDS[key]));
      expect(text.props.numberOfLines).toBe(1);
    }
    expect(screen.queryByText(/هذا الشهر|الشهر الماضي|مخصص|كل الوقت/)).toBeNull();
  });
});

describe('مفيش فصحى رجعت في الشاشات التلاتة', () => {
  it.each(['app/(tabs)/reports.tsx', 'app/archive.tsx', 'app/user-guide.tsx'])('%s', (file) => {
    const src = readFileSync(file, 'utf8');
    expect(src).not.toMatch(/هذا الشهر|الشهر الماضي|'مخصص'|كل الوقت|بالفترة السابقة|>إلى<|إلى: \{/);
  });

  it('الدليل بياخد الأسامي من نفس المصدر', () => {
    const src = readFileSync('app/user-guide.tsx', 'utf8');
    expect(src).toContain('PERIOD_PRESET_WORDS');
    expect(src).toContain('PREVIOUS_PERIOD_LABEL');
  });

  it('زرار التصدير بيعدّ بالعربي ("عملية واحدة" مش "1 عملية")', () => {
    expect(readFileSync('app/archive.tsx', 'utf8')).toContain('transactionsPhrase(filtered.length)');
  });
});
