// إعداد منفصل لاختبارات الكتابة في قاعدة البيانات، لأنها محتاجة محاكي Firestore
// شغال. بتتشغّل بـ `npm run test:db` اللي بيقوم بالمحاكي الأول (شوف package.json).
const base = require('./package.json').jest;

module.exports = {
  ...base,
  testPathIgnorePatterns: ['/node_modules/'],
  testMatch: ['**/*.emulator.test.ts', '**/*.emulator.test.tsx'],
  testTimeout: 30000,
  // لازم ملف ورا ملف: كلهم بيشتغلوا على نفس المحاكي، ومسح البيانات في ملف كان
  // بيشيل بيانات ملف تاني شغال في نفس الوقت
  maxWorkers: 1,
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js', '<rootDir>/jest.setup.emulator.js'],
};
