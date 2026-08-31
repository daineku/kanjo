import { FlatCompat } from '@eslint/eslintrc'

/**
 * ESLint flat config.
 *
 * `eslint-config-next@15.5` still ships eslintrc-style configs (its
 * `core-web-vitals` entry exports an object with `extends`, not a flat array),
 * so FlatCompat is the supported bridge rather than a workaround — it is what
 * create-next-app generates for this version too.
 *
 * The `lint` script calls the `eslint` CLI directly. `next lint` is deprecated
 * and is removed in Next 16, so wiring the gate to it now would mean the gate
 * silently disappears at the next major.
 */
const compat = new FlatCompat({ baseDirectory: import.meta.dirname })

const config = [
  {
    ignores: ['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'node_modules/**'],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // Unused variables are an error, not a warning — with one escape hatch:
      // a leading underscore, which is how the destructuring that strips fields
      // off an object marks the parts it is deliberately discarding.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },
]

export default config
