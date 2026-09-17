import * as Device from 'expo-device';
import {
  FEEDBACK_MAX_LENGTH, FEEDBACK_TYPES, FEEDBACK_TYPE_LABEL, UNKNOWN_DEVICE,
  buildFeedbackDoc, deviceInfo, feedbackRemaining, feedbackTextValid, formatDeviceModel,
} from '@/lib/feedback';

/** expo-device بيقرا من الناتيف، وفي jest القيم بتبقى null — فبنزرعها بنفسنا */
function stubDevice(values: Partial<Record<'manufacturer' | 'modelName' | 'osVersion' | 'deviceName', string | null>>) {
  Object.entries(values).forEach(([k, v]) => {
    Object.defineProperty(Device, k, { value: v, configurable: true });
  });
}

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
      ['appVersion', 'deviceModel', 'osVersion', 'platform', 'text', 'type', 'uid']
    );
  });

  /**
   * أهم اختبار في الملف ده. `Device.deviceName` بيرجّع الاسم اللي المستخدم
   * سمّى بيه جهازه، والمثال في توثيق expo-device نفسه "Vivian's iPhone XS".
   * لو تسرّب للمستند، الجملة اللي بنقولها للمستخدم ("نوع الموبايل بس")
   * بتبقى كدب.
   */
  it('اسم الجهاز مبيوصلش للمستند حتى لو الجهاز راجعه', () => {
    stubDevice({
      deviceName: 'موبايل أحمد محمد',
      manufacturer: 'samsung',
      modelName: 'SM-A546B',
      osVersion: '14',
    });
    const doc = buildFeedbackDoc('u1', 'bug', 'نص');
    const serialized = JSON.stringify(doc);

    expect(serialized).not.toContain('موبايل أحمد محمد');
    expect(serialized).not.toContain('أحمد');
    expect(Object.keys(doc)).not.toContain('deviceName');
    // وبنتأكد إن الاسم كان متاح فعلاً — وإلا الاختبار بيعدّي من غير ما يختبر حاجة
    expect(Device.deviceName).toBe('موبايل أحمد محمد');
  });
});

describe('formatDeviceModel', () => {
  it('الشركة + الموديل', () => {
    expect(formatDeviceModel('samsung', 'SM-A546B')).toBe('samsung SM-A546B');
  });

  it('مبيكررش اسم الشركة لو الموديل بادئ بيه', () => {
    expect(formatDeviceModel('Google', 'Google Pixel 7')).toBe('Google Pixel 7');
    expect(formatDeviceModel('google', 'Google Pixel 7')).toBe('Google Pixel 7');
  });

  it('واحد ناقص: بنستخدم الموجود', () => {
    expect(formatDeviceModel(null, 'iPhone 15')).toBe('iPhone 15');
    expect(formatDeviceModel('Apple', null)).toBe('Apple');
  });

  it('الاتنين ناقصين: "غير معروف" مش خانة فاضية', () => {
    expect(formatDeviceModel(null, null)).toBe(UNKNOWN_DEVICE);
    expect(formatDeviceModel('  ', '  ')).toBe(UNKNOWN_DEVICE);
  });
});

describe('deviceInfo', () => {
  it('كل الحقول نصوص — القواعد بتشترط كده', () => {
    stubDevice({ manufacturer: 'samsung', modelName: 'SM-A546B', osVersion: '14' });
    const info = deviceInfo();
    expect(typeof info.appVersion).toBe('string');
    expect(typeof info.platform).toBe('string');
    expect(typeof info.deviceModel).toBe('string');
    expect(typeof info.osVersion).toBe('string');
  });

  it('بياخد الموديل الحقيقي من expo-device', () => {
    stubDevice({ manufacturer: 'samsung', modelName: 'SM-A546B', osVersion: '14' });
    expect(deviceInfo().deviceModel).toBe('samsung SM-A546B');
    expect(deviceInfo().osVersion).toBe('14');
  });

  it('الجهاز اللي مش راضي يقول موديله بيبقى "غير معروف" مش فاضي', () => {
    stubDevice({ manufacturer: null, modelName: null, osVersion: null });
    expect(deviceInfo().deviceModel).toBe(UNKNOWN_DEVICE);
    expect(deviceInfo().osVersion).toBe(UNKNOWN_DEVICE);
  });
});

describe('أنواع الرأي', () => {
  it('تلات أنواع، كل واحد ليه اسم عربي', () => {
    expect(FEEDBACK_TYPES).toEqual(['bug', 'idea', 'praise']);
    expect(FEEDBACK_TYPES.map(t => FEEDBACK_TYPE_LABEL[t])).toEqual(['مشكلة', 'اقتراح', 'رأي']);
  });
});
