import React from 'react';
import { render, screen } from '@testing-library/react-native';
import FoldedSection from '@/components/FoldedSection';
import { ThemeProvider } from '@/context/ThemeContext';

/** العدد نص لوحده جنب العنوان (مش آخر سطر العنوان) عشان أندرويد ميقصّوش، ولسه بيتقري كله. */
const ui = (p: Partial<React.ComponentProps<typeof FoldedSection>> = {}) => (
  <ThemeProvider><FoldedSection title="ديون اتسددت" count={5} testID="f" {...p}><></></FoldedSection></ThemeProvider>
);

describe('FoldedSection: العدد', () => {
  it('العنوان والعدد موجودين كل واحد لوحده، والـlabel كامل', async () => {
    await render(ui());
    expect(screen.getByText('ديون اتسددت')).toBeTruthy();
    expect(screen.getByText('(5)')).toBeTruthy();
    expect(screen.getByTestId('f_toggle').props.accessibilityLabel).toBe('ديون اتسددت (5)');
  });
  it('a11yLabel يفضل بيغلب، وshowCount=false من غير عدد', async () => {
    await render(ui({ a11yLabel: 'خمس ديون' }));
    expect(screen.getByTestId('f_toggle').props.accessibilityLabel).toBe('خمس ديون');
    await screen.unmount();
    await render(ui({ showCount: false, status: 'فئتين' }));
    expect(screen.getByText('ديون اتسددت — فئتين')).toBeTruthy();
  });
});
