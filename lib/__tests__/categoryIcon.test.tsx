import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { CategoryIcon } from '@/components/CategoryIcon';
import { ThemeProvider } from '@/context/ThemeContext';

/** حاوية أيقونة الفئة: إيموجي مختار ← بيظهر؛ من غير أيقونة أو 🏷️ ← أيقونة خطية (LineIcon) مش العلامة. */
const wrap = async (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('CategoryIcon', () => {
  it('إيموجي مختار ← بيظهر جوه الدايرة', async () => {
    await wrap(<CategoryIcon icon="🍔" />);
    expect(screen.getByText('🍔', { includeHiddenElements: true })).toBeTruthy();
  });
  it.each([undefined, '', '🏷️'])('من غير أيقونة (%p) ← أيقونة خطية مش 🏷️', async icon => {
    await wrap(<CategoryIcon icon={icon} />);
    expect(screen.queryByText('🏷️', { includeHiddenElements: true })).toBeNull();
    expect(screen.getByTestId('category_icon', { includeHiddenElements: true })).toBeTruthy();
  });
  it('مخفية عن قارئ الشاشة (الاسم جنبها هو اللي بيتقري)', async () => {
    await wrap(<CategoryIcon icon="🍔" />);
    expect(screen.getByTestId('category_icon', { includeHiddenElements: true }).props.accessibilityElementsHidden).toBe(true);
  });
});
