import { Button } from '@/components/Button';
import { ThemeProvider } from '@/context/ThemeContext';
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { warmUp } from '@/test-utils/warmUp';
import { readFileSync } from 'fs';
import { join } from 'path';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

warmUp(() => <ThemeProvider><Button label="x" /></ThemeProvider>);

describe('Button', () => {
  it.each(['primary', 'secondary', 'danger', 'ghost'] as const)('بيرسم النوع %s ويضغط', async (variant) => {
    const onPress = jest.fn();
    await wrap(<Button testID="b" variant={variant} label="حفظ" onPress={onPress} />);
    await fireEvent.press(screen.getByTestId('b'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByText('حفظ')).toBeTruthy();
  });

  it('disabled بيمنع الضغط ويقول للقارئ', async () => {
    const onPress = jest.fn();
    await wrap(<Button testID="b" label="حفظ" disabled onPress={onPress} />);
    await fireEvent.press(screen.getByTestId('b'));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByTestId('b').props.accessibilityState).toMatchObject({ disabled: true, busy: false });
  });

  it('busy بيمنع الضغط، ويخفي النص ويفضل الاسم للقارئ', async () => {
    const onPress = jest.fn();
    await wrap(<Button testID="b" label="حفظ" busy onPress={onPress} />);
    await fireEvent.press(screen.getByTestId('b'));
    expect(onPress).not.toHaveBeenCalled();
    // النص بيفضل مرسوم (شفاف) عشان العرض ميتغيّرش
    expect(screen.getByText('حفظ')).toBeTruthy();
    expect(screen.getByTestId('b_spinner')).toBeTruthy();
    const b = screen.getByTestId('b');
    expect(b.props.accessibilityRole).toBe('button');
    expect(b.props.accessibilityLabel).toBe('حفظ، جاري التنفيذ');
    expect(b.props.accessibilityState).toMatchObject({ disabled: true, busy: true });
  });

  it('iconOnly مفيهوش نص مرئي والاسم للقارئ', async () => {
    await wrap(<Button testID="b" icon="add" iconOnly label="إضافة فئة" />);
    expect(screen.queryByText('إضافة فئة')).toBeNull();
    expect(screen.getByTestId('b').props.accessibilityLabel).toBe('إضافة فئة');
  });

  it('accessibilityLabel بيغلب الـlabel', async () => {
    await wrap(<Button testID="b" label="+" accessibilityLabel="ضيف" />);
    expect(screen.getByTestId('b').props.accessibilityLabel).toBe('ضيف');
  });
});

/** الملفات اللي اتنقلت على `Button` مبقاش فيها زرار حفظ/إضافة متعرّف بالإيد */
describe('جرد: مفيش saveBtn/addBtn بتاع StyleSheet في الملفات المنقولة', () => {
  const root = join(__dirname, '..', '..');
  const files: Record<string, RegExp> = {
    'app/modal.tsx': /\bsaveBtn:\s*\{[^}]*backgroundColor/,
    'app/(tabs)/debts.tsx': /\b(saveBtn|addBtn):\s*\{[^}]*backgroundColor/,
    'components/DebtEntryModals.tsx': /\bsaveBtn:\s*\{[^}]*backgroundColor/,
    'components/ArchiveSheet.tsx': /\bsaveBtn:\s*\{[^}]*backgroundColor/,
    'components/IncomesView.tsx': /\b(saveBtn|addBtn):\s*\{[^}]*backgroundColor/,
    'app/settings-screens/wallets.tsx': /\baddBtn:\s*\{[^}]*backgroundColor/,
    'app/settings-screens/categories.tsx': /\baddBtn:\s*\{[^}]*backgroundColor/,
    'app/settings-screens/lock.tsx': /\bprimaryBtn:/,
  };
  it.each(Object.keys(files))('%s', (f) => {
    const src = readFileSync(join(root, f), 'utf8');
    expect(src).toMatch(/from '@\/components\/Button'/);
    expect(src).not.toMatch(files[f]);
  });
});
