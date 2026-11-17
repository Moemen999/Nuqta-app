import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { CategoryIcon } from '@/components/CategoryIcon';
import { ThemeProvider } from '@/context/ThemeContext';

/** حاوية أيقونة الفئة: إيموجي مختار ← بيظهر؛ من غير أيقونة أو 🏷️ ← أيقونة خطية (LineIcon) مش العلامة. */
const wrap = async (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('CategoryIcon', () => {
  it('إيموجي مختار ← بيظهر جوه الدايرة', async () => {
    await wrap(<CategoryIcon icon="🍔" testID="ci" />);
    expect(screen.getByText('🍔', { includeHiddenElements: true })).toBeTruthy();
  });
  it.each([undefined, '', '🏷️'])('من غير أيقونة (%p) ← أيقونة خطية مش 🏷️', async icon => {
    await wrap(<CategoryIcon icon={icon} testID="ci" />);
    expect(screen.queryByText('🏷️', { includeHiddenElements: true })).toBeNull();
    expect(screen.getByTestId('ci', { includeHiddenElements: true })).toBeTruthy();
  });
  it('tint ← خلفية بلون الفئة بشفافية، ومن غيره سطح + إطار', async () => {
    await wrap(<CategoryIcon icon="🍔" tint="#3987E5" testID="ci" />);
    expect(screen.getByTestId('ci', { includeHiddenElements: true })).toHaveStyle({ backgroundColor: '#3987E52E' });
  });
  it('مخفية عن قارئ الشاشة (الاسم جنبها هو اللي بيتقري)', async () => {
    await wrap(<CategoryIcon icon="🍔" testID="ci" />);
    expect(screen.getByTestId('ci', { includeHiddenElements: true }).props.accessibilityElementsHidden).toBe(true);
  });
});
