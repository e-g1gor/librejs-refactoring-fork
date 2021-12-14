module.exports = {
  '**/*.{js,jsx,ts,tsx}': ['eslint --cache --fix', 'npx prettier --write'],
  '**/*.{ts,tsx}': [() => 'tsc -p tsconfig.json --skipLibCheck --noEmit'],
  '*.{js,jsx,ts,tsx}': ['eslint --cache --fix', 'npx prettier --write'],
  '*.{ts,tsx}': [() => 'tsc -p tsconfig.json --skipLibCheck --noEmit'],
};
