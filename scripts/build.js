const { watch } = require('chokidar');
const debounce = require('debounce');
const { exec } = require('child_process');
const glob = require('glob');
const fs = require('fs-extra');
// To load types to IDE
const webExt = require('web-ext');
const _path = require('path');
const { join: _join, resolve: _resolve, basename: _basename } = _path;
// One-liner for current directory
// const __dirname = _resolve('./');
if (typeof module === 'object') {
  var __dirname = _resolve('./');
}
/** Disable test runs on const */
process.env.LIBREJS_TEST_MANUAL = true;
const { libreJSTest } = require('../test.js');

const SRC_DIR = _join(__dirname, './');
// const SRC_DIR = _join(__dirname, './webextension');
const BUILD_DIR = _join(__dirname, './build_temp');
const XPI_PATH = _join(__dirname, './librejs.xpi');

console.log({
  SRC_DIR,
  BUILD_DIR,
  XPI_PATH,
});

// Initialize watcher for JS/TS files
// const watcher = watch(SRC_DIR + '/**/*', {
//   ignored: /(^|[\/\\])\../, // ignore dotfiles
//   persistent: true,
//   ignoreInitial: true,
// });

/**
 * Builds webextension dist folder and installer file.
 * @param {*} event - chokidar event
 * @param {*} path - chokidar path
 * @returns
 */
async function packageXPI(event, path) {
  console.log('Packaging XPI');
  return await executeCommand('./scripts/package-xpi.sh --test', 'XPI packaged successfully', 'XPI packaging failed');
}

/**
 *
 * @param {*} event
 * @param {*} path
 * @returns
 */
async function loadJasmine(event, path) {
  console.log('Loading Jasmine lib');
  return await executeCommand('./scripts/load-jasmine.sh', 'Jasmine lib is loaded', 'Failed to load Jasmine lib');
}

/**
 * Cleanup old build
 */
async function cleanup(_event, _path) {
  try {
    await fs.removeSync(BUILD_DIR);
    await fs.removeSync(XPI_PATH);
  } catch (error) {
    console.log(error);
  }
}

/**
 * Copy sources to build folder
 */
async function copySources() {
  await fs.copy(_join(SRC_DIR, 'test'), _join(BUILD_DIR, 'test'));
  await fs.copy(_join(SRC_DIR, 'icons'), _join(BUILD_DIR, 'icons'));
  await fs.copy(_join(SRC_DIR, 'content'), _join(BUILD_DIR, 'content'));
  await fs.copy(_join(SRC_DIR, 'bg'), _join(BUILD_DIR, 'bg'));
  await fs.copy(_join(SRC_DIR, 'common'), _join(BUILD_DIR, 'common'));
  await fs.copy(_join(SRC_DIR, 'hash_script'), _join(BUILD_DIR, 'hash_script'));
  await fs.copy(_join(SRC_DIR, 'manifest.json'), _join(BUILD_DIR, 'manifest.json'));
  glob.sync(SRC_DIR + '*.@(ts|js)').forEach((path) => {
    const ignore = isInNodeModules(path);
    const file = _path.relative(__dirname, path);
    if (!ignore) {
      // fs.removeSync(path);
      fs.copy(_join(path), _join(BUILD_DIR, file));
    } else {
      // Ignored sourcefiles
    }
  });
}

/**
 * Compile TypeScript sources in build folder
 * @param {*} event
 * @param {*} path
 * @returns
 */
async function compileTs(_event, _path) {
  console.log('Compile TS sources');
  return await executeCommand('npm run compile:ts', 'TS Compiler finished', 'TS Compiler failed');
}

/**
 * Remove TS sources in build folder.
 * Files in `node_modules` folders are ignored.
 * @param {*} buildDir <optional> build dir
 */
async function removeTsSources(buildDir = BUILD_DIR) {
  glob.sync(buildDir + '/**/*.ts').forEach((file) => {
    const ignore = isInNodeModules(file);
    if (!ignore) {
      fs.removeSync(file);
    } else {
      // Ignored sourcefiles
    }
  });
}

/**
 * Build webextension, perform tests and reload web
 * @param {*} extensionRunner web-ext package extension runner instance
 * @param {*} event - chokidar event
 * @param {*} path - chokidar path
 * @returns
 */
async function main(event, path, extensionRunner) {
  // Remove previous build
  await cleanup(event, path).catch(console.error);

  // Try to load jasmine lib if not exist
  await loadJasmine().catch(console.error);

  // Move sources to build folder
  await copySources(event, path).catch(console.error);

  // Copmie TS sources in build folder
  await compileTs(event, path).catch((errorCode) => {
    // Case: No TS files in sources
    if (errorCode != 2) console.error({ errorCode });
  });

  // Remove TS sources from build folders
  await removeTsSources();

  // Remove TS sources from build folders
  await packageXPI();

  // Run headless tests on installer
  // TODO: try to use web-ext to connect to started browser instead of starting headless one
  let testResults;
  if ([true, 1, '1'].includes(process.env.RUN_TESTS_ON_BUILD)) {
    testResults = await libreJSTest();
  }

  // Reload extensions after success build, if extensionRunner is provided
  // if (!testResults.error && extensionRunner) {
  //   await extensionRunner.reloadAllExtensions();
  // }
}

/**
 * Util to run command in shell
 * @param {*} command shell command line
 * @param {*} successMessage
 * @param {*} errorMessage
 * @returns
 */
async function executeCommand(command, successMessage, errorMessage) {
  const runner = exec(command);

  runner.on('error', (error) => {
    console.error(error.message);
    throw error;
  });

  return await new Promise((res, rej) => {
    runner.on('close', (code) => {
      if (code === 0) {
        if (successMessage) console.log(successMessage);
        res(code);
      } else {
        if (errorMessage) console.error(errorMessage);
        rej(code);
      }
    });
  });
}

/**
 * Check if file in node_mopdules relative to basedir (__dirname by default)
 * @param {*} file file path
 * @returns true if file is in some node_modules folders
 */
function isInNodeModules(file, basedir = __dirname) {
  const pathArr = _path.relative(basedir, file).split(_path.sep);
  const isInNodeModules = pathArr.includes('node_modules');
  return isInNodeModules;
}

/**
 * Start watchers on all changes in source files
 */
async function start() {
  await main();

  const extensionRunner = await webExt.cmd.run({ sourceDir: BUILD_DIR, noReload: true }, { shouldExitProgram: false });

  // watcher.on('all', (event, path) => debounce(main, 500)(event, path /* extensionRunner */));

  console.log('Started ExtensionRunners: ' + extensionRunner.extensionRunners.length);
}

// export { main, compileTs, buildWebExt, start };
// export default start;

void start();
