import { ATTENTION_LINE_HINT, attentionSummaryPhrase } from '@/lib/attentionSummary';
import { pendingSummaryPhrase } from '@/lib/pendingSummary';

describe('attentionSummaryPhrase', () => {
  it.each([
    [0, null],
    [-1, null],
    [1.5, null],
    [NaN, null],
    [1, 'عندك حاجة محتاجة انتباهك'],
    [2, 'عندك حاجتين محتاجين انتباهك'],
    [3, 'عندك 3 حاجات محتاجة انتباهك'],
    [10, 'عندك 10 حاجات محتاجة انتباهك'],
    [11, 'عندك 11 حاجة محتاجة انتباهك'],
    [25, 'عندك 25 حاجة محتاجة انتباهك'],
  ])('%s ← %s', (n, expected) => {
    expect(attentionSummaryPhrase(n as number)).toBe(expected);
  });

  it('على نفس حدود «مستنيين ردك» (الصيغة بتتبدّل عند 1 و2 و3 و10 و11 في الاتنين)', () => {
    for (const n of [0, 1, 2, 3, 10, 11]) {
      expect(attentionSummaryPhrase(n) === null).toBe(pendingSummaryPhrase(n) === null);
    }
  });

  it('التلميح بالنص المتفق عليه', () => {
    expect(ATTENTION_LINE_HINT).toBe('بيفتح الحاجات اللي محتاجة انتباهك');
  });
});
