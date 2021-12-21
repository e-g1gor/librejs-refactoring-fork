# LibreJS extension refactoring

Changes in this version:

- Configure eslint for mixed codebase (ts+js)
- Add typescript support
- Add package.json with all development and production dependencies
- Refactor build script
  - Split bash script to files by functions
  - Main build script is JS script now, to allow using [local node_modules](https://docs.npmjs.com/cli/v8/using-npm/scripts#path) (NodeJS is required for development anyway)
  - Command line arguments availavble to use this script, i.e. to watch source changes or to [livereload](https://www.npmjs.com/package/web-ext) extension in browser automatically
- Scripts added to package.json for useful operations, such as lint, format, build, release
- Add [husky](https://www.npmjs.com/package/husky) + [lint-staged](https://github.com/okonet/lint-staged) precommit git hook, to ensure all commits contains lintable code and code is formated

## Quick start

After cloning this repo, run

```bash
npm install
```

It'll install npm dependencies locally and initialize husky git hooks.

Then you can build extension and run headless browser tests:

```bash
npm run build:tests
```

## Package.json scripts

Scripts in package json:

`npm run build` - build extension xpi file
`npm run build:tests` - build extension xpi file, performing headless tests after packaging and print results
`npm run watch` - watch changes in `./webextension` folder, rebuild and reload extension to browser automatically on each change
`npm run watch:tests` - same as `npm run watch`, but run headless tests before loading new xpi to browser on each change
`npm test` - run headless browser tests on built `./librejs.xpi` file
`npm run lint` - run eslint + tsc checks on sources, print errors only
`npm run lint:verbose` - run eslint + tsc checks on sources, print all issues, including warnings
`npm run format` - format sources using [prettier](https://www.npmjs.com/package/prettier)
`npm run compliance` - run `./scripts/compliance.js` script, for example `npm run compliance https://startpage.com`. Its easier to use with npm to avoid `PATH` modifying.
`npm run release:major` - bump major version in package.json, and add corresponding git tag localy.
`npm run release:minor` - bump minor version in package.json, and add corresponding git tag localy.
`npm run release:patch` - bump patch version in package.json, and add corresponding git tag localy.
`npm run webext:firefox` - deploy `./librejs.xpi` file to firefox browser with help of [web-ext tool](https://github.com/mozilla/web-ext)

`npm run compile:ts` - used in `./scripts/build.js`, compiles TS sources in `./build_temp` folder. Not supposed to be used directly
