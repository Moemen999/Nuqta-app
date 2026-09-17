import {
  FEEDBACK_MAX_LENGTH, FEEDBACK_TYPES, FEEDBACK_TYPE_LABEL,
  buildFeedbackDoc, deviceInfo, feedbackRemaining, feedbackTextValid,
} from '@/lib/feedback';

describe('feedbackTextValid', () => {
  it('نص عادي ماشي', () => {
    expect(feedbackTextValid('التطبيق حلو بس ناقصه حاجة')).toBe(true);
  });

  it('الفاضي مرفوض', () => {
    expect(feedbackTextValid('')).toBe(false);
  });

  it('المسافات لوحدها مرفوضة — مش رأي', () => {
    expect(feedbackTextValid('   ')).toBe(false);
    expect(feedbackTextValid('\n\t  \n')).toBe(false);
  });

  it('الحد الأقصى بالظبط ماشي', () => {
    expect(feedbackTextValid('ا'.repeat(FEEDBACK_MAX_LENGTH))).toBe(true);
  });

  it('حرف زيادة مرفوض', () => {
    expect(feedbackTextValid('ا'.repeat(FEEDBACK_MAX_LENGTH + 1))).toBe(false);
  });

  it('الطول بيتقاس بعد التقليم — ده اللي بيتبعت فعلاً', () => {
    const padded = '  ' + 'ا'.repeat(FEEDBACK_MAX_LENGTH) + '  ';
    expect(feedbackTextValid(padded)).toBe(true);
  });
});

describe('feedbackRemaining', () => {
  it('بيعدّ المكتوب زي ما هو', () => {
    expect(feedbackRemaining('')).toBe(FEEDBACK_MAX_LENGTH);
    expect(feedbackRemaining('اهلا')).toBe(FEEDBACK_MAX_LENGTH - 4);
  });

  it('بيوصل صفر عند الحد', () => {
    expect(feedbackRemaining('ا'.repeat(FEEDBACK_MAX_LENGTH))).toBe(0);
  });
});

describe('buildFeedbackDoc', () => {
  it('بيقلّم النص قبل ما يتبعت', () => {
    expect(buildFeedbackDoc('u1', 'bug', '  فيه باگ  ').text).toBe('فيه باگ');
  });

  it('بيحط uid والنوع', () => {
    const doc = buildFeedbackDoc('u1', 'idea', 'اقتراح');
    expect(doc.uid).toBe('u1');
    expect(doc.type).toBe('idea');
  });

  it('مفيش createdAt — التاريخ بييجي من السيرفر', () => {
    expect('createdAt' in buildFeedbackDoc('u1', 'praise', 'حلو')).toBe(false);
  });

  it('مفيش أي بيانات مالية في المستند — ده اللي بنقوله للمستخدم', () => {
    const doc = buildFeedbackDoc('u1', 'bug', 'نص') as Record<string, unknown>;
    expect(Object.keys(doc).sort()).toEqual(
      ['appVersion', 'deviceModel', 'platform', 'text', 'type', 'uid']
    );
  });
});

describe('deviceInfo', () => {
  it('كل الحقول نصوص — القواعد بتشترط كده', () => {
    const info = deviceInfo();
    expect(typeof info.appVersion).toBe('string');
    expect(typeof info.platform).toBe('string');
    expect(typeof info.deviceModel).toBe('string');
  });

  it('مفيش اسم الجهاز — على آيفون بيبقى فيه اسم المستخدم الشخصي', () => {
    expect(JSON.stringify(deviceInfo())).not.toContain('deviceName');
  });
});

describe('أنواع الرأي', () => {
  it('تلات أنواع، كل واحد ليه اسم عربي', () => {
    expect(FEEDBACK_TYPES).toEqual(['bug', 'idea', 'praise']);
    expect(FEEDBACK_TYPES.map(t => FEEDBACK_TYPE_LABEL[t])).toEqual(['مشكلة', 'اقتراح', 'رأي']);
  });
});
