const { watch } = require('chokidar');
const debounce = require('debounce');
const argv = require('minimist')(process.argv.slice(2));
const { tests: TESTS_ENABLED, watch: WATCH_ENABLED } = argv;
console.log({ argv });
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

const SRC_DIR = _join(__dirname, './webextension');
// const SRC_DIR = _join(__dirname, './webextension');
const BUILD_DIR = _join(__dirname, './build_temp');
const XPI_PATH = _join(__dirname, './librejs.xpi');

console.log({
  SRC_DIR,
  BUILD_DIR,
  XPI_PATH,
});

// Initialize watcher for JS/TS files
const watcher = watch(SRC_DIR + '/**/*', {
  ignored: /(^|[\/\\])\../, // ignore dotfiles
  persistent: true,
  ignoreInitial: true,
});

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
async function cleanupOldBuild(_event, _path) {
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
  await fs.copy(SRC_DIR, BUILD_DIR);
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
  await cleanupOldBuild(event, path).catch(console.error);

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

  // const otherSourcesPattern
  // TODO: cleanup unnececary files

  // Run headless tests on installer
  // TODO: try to use web-ext to connect to started browser instead of starting headless one
  let testResults;
  if (TESTS_ENABLED) {
    testResults = await libreJSTest();
  }

  // Reload extensions after success build, if extensionRunner is provided
  if (!testResults.error && extensionRunner) {
    await extensionRunner.reloadAllExtensions();
  }
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

  if (WATCH_ENABLED) {
    const extensionRunner = await webExt.cmd.run(
      { sourceDir: BUILD_DIR, noReload: true },
      { shouldExitProgram: false },
    );
    watcher.on('all', (event, path) => debounce(main, 500)(event, path, extensionRunner));
    console.log('Started ExtensionRunners: ' + extensionRunner.extensionRunners.length);
  }
}

// export { main, compileTs, buildWebExt, start };
// export default start;

void start();
