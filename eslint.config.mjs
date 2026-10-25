import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'

const tsFiles = ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts']
const cjsFiles = ['**/*.cjs', 'electron/**/*.js']
const nodeFiles = ['scripts/**/*.mjs', 'vite.config.ts', 'vitest.config.ts', 'tests/**/*.ts']

// Phase 6-lite rule: linting must only report, never fail a build. Every inherited
// rule severity is downgraded to "warn"; "off" entries (the TS overrides that disable
// core rules typescript-eslint replaces) are kept as-is.
function toWarnings(configs) {
  return configs.map(config => {
    if (!config.rules) return config
    const rules = {}
    for (const [name, value] of Object.entries(config.rules)) {
      const severity = Array.isArray(value) ? value[0] : value
      if (severity === 'off') {
        rules[name] = value
        continue
      }
      const options = Array.isArray(value) ? value.slice(1) : []
      rules[name] = options.length > 0 ? ['warn', ...options] : 'warn'
    }
    return { ...config, rules }
  })
}

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      'dist/**',
      'release/**',
      'public/**',
      'Archive/**',
      'archives/**',
      '*.cmd',
    ],
  },
  ...toWarnings([js.configs.recommended]),
  // Restrict the typescript-eslint blocks to TS files so electron/*.cjs keeps the
  // default JavaScript parser and CommonJS semantics.
  ...toWarnings(tseslint.configs.recommended).map(config => ({
    ...config,
    files: config.files ?? tsFiles,
  })),
  {
    files: tsFiles,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.browser,
    },
  },
  {
    files: cjsFiles,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: globals.node,
    },
  },
  {
    files: nodeFiles,
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': 'warn',
    },
  }
)
