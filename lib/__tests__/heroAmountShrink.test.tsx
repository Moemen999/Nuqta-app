import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { HeroAmount } from '@/components/HeroAmount';
import { Money } from '@/components/Money';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';

/**
 * رقم بطل طويل جدًا (12 رقم) لازم يقدر يتصغّر والوحدة «ج.م» تفضل ظاهرة ومتتصغّرش.
 * ده فحص بنية وخصائص بس — الرسم الحقيقي (إن الرقم فعلاً اتصغّر والوحدة ما اتزقتش برّه) مش بيتثبت في jest، والفحص الحقيقي بالعين على الموبايل.
 */
const big = 123456789012;

describe('HeroAmount مع رقم من 12 خانة', () => {
  it('الوحدة بتتعرض، مش بتتصغّر، والرقم بيقبل الانكماش', async () => {
    await render(
      <ThemeProvider><PrivacyProvider>
        <HeroAmount unitTestID="u"><Money value={big} currency={false} fit style={{ flexShrink: 1 }} /></HeroAmount>
      </PrivacyProvider></ThemeProvider>,
    );
    const unit = screen.getByTestId('u');
    expect(unit).toBeTruthy();
    expect(StyleSheet.flatten(unit.props.style).flexShrink).toBe(0);
    const num = screen.getByText(/123/);
    expect(num.props.adjustsFontSizeToFit).toBe(true);
    expect(num.props.numberOfLines).toBe(1);
    expect(StyleSheet.flatten(num.props.style).flexShrink).toBe(1);
  });
});
