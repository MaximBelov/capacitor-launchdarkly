import ionic from '@ionic/eslint-config/recommended.js';

export default [
  { ignores: ['dist/**', 'build/**', 'coverage/**', 'example-app/**', 'android/**', 'ios/**'] },
  ...ionic,
];
