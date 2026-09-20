// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

const jestGlobals = {
  jest: 'readonly',
  describe: 'readonly',
  it: 'readonly',
  test: 'readonly',
  expect: 'readonly',
  beforeAll: 'readonly',
  beforeEach: 'readonly',
  afterAll: 'readonly',
  afterEach: 'readonly',
};

module.exports = defineConfig([
  expoConfig,
  {
    // `.claude/**` كود مستورد (ECC) مش كودنا: ليه مصدره وقواعده، وفحصه
    // بإعدادات تطبيقنا مبيقولش حاجة مفيدة. وكان بيوقّع البوابة فعلاً —
    // سبع أخطاء من مهارتين ملهمش علاقة بالمشروع (شوف
    // `.claude/parked-skills/README.md`). كود التطبيق نفسه كله لسه بيتفحص.
    ignores: ['dist/*', '.claude/**'],
  },
  {
    // ملفات الاختبارات وإعداداتها بتشتغل في بيئة جيست/نود مش في التطبيق نفسه
    files: ['**/__tests__/**', '**/*.test.{ts,tsx,js}', 'jest.setup*.js', 'jest.*.config.js', 'test-utils/**'],
    languageOptions: {
      globals: { ...jestGlobals, require: 'readonly', module: 'writable', global: 'writable', process: 'readonly' },
    },
    rules: {
      // الـ mock بتاع جيست لازم يستخدم require جوه المصنع (مبيسمحش بالـ import)
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
]);
