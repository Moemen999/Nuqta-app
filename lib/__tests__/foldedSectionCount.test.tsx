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

// جرد: عنوان + عدد بين قوسين في نص واحد ممنوع في أي شاشة — استخدم CountedText (أو FoldedSection).
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
describe('جرد: العدد بين قوسين نص لوحده', () => {
  const files: string[] = [];
  const visit = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '__tests__') visit(p); } else if (/\.tsx$/.test(e.name)) files.push(p);
    }
  };
  visit('app'); visit('components');
  const COUNT = /\(\$?\{[^{}:,]*(length|count|Count|percents)[^{}:,]*\}%?\)/;
  it('مفيش «عنوان ({عدد})» جوه Text واحد', () => {
    const bad: string[] = [];
    for (const f of files) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (/^\s*(return|const|let)\b/.test(line) || line.includes('styles.fixed')) return; // نصوص a11y/دوال مش JSX مرسوم
        if (COUNT.test(line)) bad.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
