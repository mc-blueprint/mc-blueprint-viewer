import js from '@eslint/js'
import ts from 'typescript-eslint'

export default ts.config(
  { ignores: ['dist/**', 'node_modules/**', '.dev-scenes/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  { files: ['**/*.mjs'], languageOptions: { globals: { process: 'readonly', Buffer: 'readonly', URL: 'readonly', fetch: 'readonly', console: 'readonly' } } },
)
