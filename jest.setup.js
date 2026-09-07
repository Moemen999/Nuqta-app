// إعدادات مشتركة لكل الاختبارات

// AsyncStorage موديول أصلي، فمن غير المحاكي بتاعه الرسمي أي كود بيلمسه بيرمي
// خطأ في الاختبارات (الثيم وقفل التطبيق وfirebaseConfig كلهم بيعدوا عليه)
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
