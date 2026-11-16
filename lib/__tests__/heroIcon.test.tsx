import { AccessibilityInfo, StyleSheet } from 'react-native';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { HeroIcon } from '@/components/HeroIcon';
import { ThemeProvider } from '@/context/ThemeContext';

const ui = (key?: number) => <ThemeProvider><HeroIcon name="wallet-outline" size={64} animateKey={key} testID="hero" /></ThemeProvider>;
const opacity = () => StyleSheet.flatten(screen.getByTestId('hero', { includeHiddenElements: true }).props.style).opacity;

describe('HeroIcon', () => {
  afterEach(() => jest.restoreAllMocks());

  it('من غير animateKey: ثابتة من أول رسمة', async () => {
    await render(ui());
    expect(opacity()).toBe(1);
  });

  it('تقليل الحركة: ثابتة (opacity 1) حتى مع animateKey', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    await render(ui(0));
    await act(async () => { await Promise.resolve(); });
    await waitFor(() => expect(opacity()).toBe(1));
  });

  it('مخفية عن قارئ الشاشة', async () => {
    await render(ui(0));
    const n = screen.getByTestId('hero', { includeHiddenElements: true });
    expect(n.props.importantForAccessibility).toBe('no-hide-descendants');
  });
});
