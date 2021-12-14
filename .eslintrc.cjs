module.exports = {
  root: true,
  parserOptions: {
    ecmaVersion: 2017,
    sourceType: 'module',
  },
  extends: ['plugin:prettier/recommended'],
  env: {
    es6: true,
    node: true,
    jest: true,
    browser: false,
  },
  ignorePatterns: ['.eslintrc.*', '/build', '/build_temp', './compile_temp'],
  rules: {
    'id-match': ['error', '^[a-zA-Z_$]*[a-zA-Z_$0-9]*$'],
    'require-await': 'warn',
    'max-len': [0, { code: 120, ignoreUrls: true }],
    'prefer-const': 'warn',
    'no-var': 'warn',
    // 'newline-before-return': 'warn',
  },
  settings: {
    react: {
      version: 'detect',
    },
    'import/resolver': {
      typescript: {},
      'babel-module': {
        root: ['.'],
        alias: {
          '~/static': './public/static/',
          '~': './',
        },
      },
    },
  },

  // parser: '@babel/eslint-parser',

  // TS config override
  overrides: [
    {
      files: ['**/*.{ts,tsx}'],
      parser: '@typescript-eslint/parser',
      parserOptions: {
        project: 'tsconfig.json',
        sourceType: 'module',
        tsconfigRootDir: __dirname,
      },
      plugins: ['@typescript-eslint/eslint-plugin'],
      extends: ['plugin:@typescript-eslint/recommended', 'plugin:prettier/recommended'],
      env: {
        node: true,
        jest: true,
        browser: false,
      },
      rules: {
        'id-match': ['error', '^[a-zA-Z_$]*[a-zA-Z_$0-9]*$'],
        'require-await': 'warn',
        'max-len': [0, { code: 120, ignoreUrls: true }],
        'prefer-const': 'warn',
        'no-var': 'warn',
        // 'newline-before-return': 'warn',
        '@typescript-eslint/no-floating-promises': 'error',
        '@typescript-eslint/interface-name-prefix': 'off',
        // '@typescript-eslint/explicit-function-return-type': 'warn',
        '@typescript-eslint/explicit-module-boundary-types': 'warn',
        '@typescript-eslint/no-explicit-any': 'warn',
        '@typescript-eslint/no-var-requires': 'warn',
        '@typescript-eslint/no-this-alias': 'warn',
        '@typescript-eslint/no-empty-function': 'warn',
        '@typescript-eslint/no-var-requires': 'warn',
      },
    },
  ],
};
