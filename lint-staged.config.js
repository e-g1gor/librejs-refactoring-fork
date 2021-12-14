module.exports = {
  'webextension/**/*.{js,jsx,ts,tsx}': ['eslint --cache --fix', 'npx prettier --write'],
  'webextension/**/*.{ts,tsx}': [() => 'tsc -p tsconfig.json --skipLibCheck --noEmit'],
  '*.{js,jsx,ts,tsx}': ['eslint --cache --fix', 'npx prettier --write'],
  '*.{ts,tsx}': [() => 'tsc -p tsconfig.json --skipLibCheck --noEmit'],
};
