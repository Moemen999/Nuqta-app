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
  it.each(['primary', 'secondary', 'outline', 'danger', 'ghost'] as const)('بيرسم النوع %s ويضغط', async (variant) => {
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
    expect(screen.getByTestId('b_spinner').props.animating).toBe(true);
    const b = screen.getByTestId('b');
    expect(b.props.accessibilityRole).toBe('button');
    expect(b.props.accessibilityLabel).toBe('حفظ، جاري التنفيذ');
    expect(b.props.accessibilityState).toMatchObject({ disabled: true, busy: true });
  });

  it('المؤشر متركّب دايمًا وbusy بيغيّر props بس (NUQTA-3)', async () => {
    const view = await wrap(<Button testID="b" label="حفظ" />);
    expect(screen.getByTestId('b_spinner', { includeHiddenElements: true }).props.animating).toBe(false);
    await view.rerender(<ThemeProvider><Button testID="b" label="حفظ" busy /></ThemeProvider>);
    expect(screen.getByTestId('b_spinner').props.animating).toBe(true);
    await view.rerender(<ThemeProvider><Button testID="b" label="حفظ" /></ThemeProvider>);
    expect(screen.getByTestId('b_spinner', { includeHiddenElements: true }).props.animating).toBe(false);
  });

  it('iconOnly مفيهوش نص مرئي والاسم للقارئ', async () => {
    await wrap(<Button testID="b" icon="add" iconOnly label="إضافة فئة" />);
    expect(screen.queryByText('إضافة فئة')).toBeNull();
    expect(screen.getByTestId('b').props.accessibilityLabel).toBe('إضافة فئة');
  });

  // الأزرار اللي اتنقلت من TouchableOpacity خرجت من مسح touchTargets.test.ts — فالحد الأدنى يتثبّت هنا مرة للكل
  it.each(['md', 'sm'] as const)('هدف اللمس ≥44 حتى بالمقاس %s', async (size) => {
    await wrap(<Button testID="b" label="حفظ" size={size} />);
    const style = screen.getByTestId('b').props.style;
    const flat = Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
    expect(flat.minHeight).toBeGreaterThanOrEqual(44);
  });

  it('accessibilityHint بيتمرر للـPressable', async () => {
    await wrap(<Button testID="b" label="لسه" accessibilityHint="الكارت هيستخبّى النهاردة بس" />);
    expect(screen.getByTestId('b').props.accessibilityHint).toBe('الكارت هيستخبّى النهاردة بس');
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
    'app/modal.tsx': /\b(saveBtn|noWalletsBtn):\s*\{[^}]*backgroundColor/,
    'app/(tabs)/debts.tsx': /\b(saveBtn|addBtn):\s*\{[^}]*backgroundColor/,
    'components/DebtEntryModals.tsx': /\bsaveBtn:\s*\{[^}]*backgroundColor/,
    'components/ArchiveSheet.tsx': /\bsaveBtn:\s*\{[^}]*backgroundColor/,
    'components/IncomesView.tsx': /\b(saveBtn|addBtn):\s*\{[^}]*backgroundColor/,
    'app/settings-screens/wallets.tsx': /\baddBtn:\s*\{[^}]*backgroundColor/,
    'app/settings-screens/categories.tsx': /\baddBtn:\s*\{[^}]*backgroundColor/,
    'app/settings-screens/lock.tsx': /\bprimaryBtn:/,
    'components/SubscriptionsView.tsx': /\b(saveBtn|addBtn|payBtn):\s*\{[^}]*backgroundColor/,
    'components/GamiyaView.tsx': /\b(saveBtn|addBtn|markBtn):\s*\{[^}]*backgroundColor/,
    'components/ChargeHomeCards.tsx': /\b(saveBtn|yesBtn):\s*\{[^}]*backgroundColor/,
    'components/IncomeHomeCards.tsx': /\b(saveBtn|yesBtn):\s*\{[^}]*backgroundColor/,
    'components/SetLockModal.tsx': /\bsaveBtn:\s*\{[^}]*backgroundColor/,
    'components/BrokenTransactions.tsx': /\b(saveBtn|deleteBtn):\s*\{[^}]*(backgroundColor|borderColor)/,
    'components/ArchivedSettlement.tsx': /\b(saveBtn|deleteBtn):\s*\{[^}]*(backgroundColor|borderColor)/,
    'components/FirstRunSetup.tsx': /\baddBtn:\s*\{[^}]*borderColor/,
  };
  it.each(Object.keys(files))('%s', (f) => {
    const src = readFileSync(join(root, f), 'utf8');
    expect(src).toMatch(/from '@\/components\/Button'/);
    expect(src).not.toMatch(files[f]);
  });
});

describe('Button — منع flatten/unflatten في Fabric (NUQTA-3)', () => {
  it('الـPressable وView المحتوى والمؤشر عليهم collapsable={false}', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../components/Button.tsx'), 'utf8') as string;
    expect(src).toMatch(/<Pressable\s+collapsable=\{false\}/);
    expect(src).toMatch(/<View collapsable=\{false\} style=\{\{ flexDirection: 'row-reverse'[^\n]*opacity: busy/);
    // ActivityIndicator مبيمرّرش collapsable للـView الخارجي بتاعه (RN 0.81) — فالـopacity/المكان لازم يبقوا على
    // View بتاعنا بـcollapsable={false} والمؤشر جوّاه من غير style (NUQTA-3 على 1.0.0.028: «at index 1»)
    expect(src).toMatch(/<View\s+collapsable=\{false\}[^>]*style=\{\{ position: 'absolute', opacity: busy \? 1 : 0 \}\}>\s*<ActivityIndicator/);
    const indicator = src.slice(src.indexOf('<ActivityIndicator'), src.indexOf('/>', src.indexOf('<ActivityIndicator')));
    expect(indicator).not.toMatch(/style=/);
  });
});
