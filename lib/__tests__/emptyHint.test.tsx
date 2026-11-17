import { EmptyHint } from '@/components/EmptyHint';
import { ThemeProvider } from '@/context/ThemeContext';
import { render, screen } from '@testing-library/react-native';
import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (f: string) => readFileSync(join(__dirname, '..', '..', f), 'utf8');
const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('EmptyHint', () => {
  it('بيرسم الجملة والأيقونة مخبّية عن قارئ الشاشة', async () => {
    await wrap(<EmptyHint testID="e" icon="repeat-outline" message="مفيش اشتراكات مسجلة" />);
    expect(screen.getByTestId('e')).toBeTruthy();
    expect(screen.getByText('مفيش اشتراكات مسجلة')).toBeTruthy();
    expect(screen.getByText('مفيش اشتراكات مسجلة').props.accessibilityElementsHidden).toBeFalsy();
    const icon = screen.getByTestId('e_icon', { includeHiddenElements: true });
    expect(icon.props.accessibilityElementsHidden).toBe(true);
    expect(icon.props.importantForAccessibility).toBe('no-hide-descendants');
  });
});

describe('جرد الحالات الفاضية في الالتزامات', () => {
  it.each([
    ['components/SubscriptionsView.tsx', 'subs_empty', 'مفيش اشتراكات مسجلة'],
    ['components/SubscriptionsView.tsx', 'subs_empty_active', 'مفيش اشتراكات شغالة دلوقتي'],
    ['components/GamiyaView.tsx', 'gamiya_empty', 'مفيش جمعية مسجلة'],
    ['app/(tabs)/debts.tsx', 'debts_owed_empty', 'مفيش حد مديون ليك دلوقتي'],
    ['app/(tabs)/debts.tsx', 'debts_iowe_empty', 'مفيش عليك ديون دلوقتي'],
  ])('%s: %s بيعدّي على EmptyHint', (file, id, msg) => {
    const src = read(file);
    expect(src).toMatch(new RegExp(`<EmptyHint[^>]*testID="${id}"[^>]*message="${msg}"`));
    expect(src).not.toMatch(/styles\.emptyState/);
  });
  it('debts.tsx من غير إيموجي 👤', () => {
    expect(read('app/(tabs)/debts.tsx')).not.toContain('👤');
  });
});
