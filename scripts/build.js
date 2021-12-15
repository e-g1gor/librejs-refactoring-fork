const chalk = require('chalk');
const { watch } = require('chokidar');
const tsc = require('typescript');
const debounce = require('debounce');
const argv = require('minimist')(process.argv.slice(2));
const { tests: TESTS_ENABLED, watch: WATCH_ENABLED } = argv;
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
/** Disable test runs on import */
process.env.LIBREJS_TEST_MANUAL = true;
const { libreJSTest } = require('../test.js');

const SRC_DIR = _join(__dirname, './webextension');
// const SRC_DIR = _join(__dirname, './webextension');
const BUILD_DIR = _join(__dirname, './build_temp');
const XPI_PATH = _join(__dirname, './librejs.xpi');

// Print script parameters
console.log({
  SRC_DIR,
  BUILD_DIR,
  XPI_PATH,
  WATCH_ENABLED,
  TESTS_ENABLED,
});

/**
 * Builds webextension dist folder and installer file.
 * @param {*} event - chokidar event
 * @param {*} path - chokidar path
 * @returns
 */
async function packageXPI(
  msgs = { success: 'XPI packaged successfully', error: 'XPI packaging failed' },
  _event,
  _path,
) {
  // Remove previous build artifact
  fs.removeSync(XPI_PATH);
  // console.log('Packaging XPI');
  return await executeCommand('./scripts/package-xpi.sh --test', msgs.success, msgs.error);
}

/**
 *
 * @param {*} event
 * @param {*} path
 * @returns
 */
async function loadJasmine(
  msgs = { success: 'Jasmine lib is loaded', error: 'Failed to load Jasmine lib' },
  _event,
  _path,
) {
  // console.log('Loading Jasmine lib');
  return await executeCommand('./scripts/load-jasmine.sh', msgs.success, msgs.error);
}

/**
 * Cleanup old build
 */
async function cleanupOldBuild(_event, _path) {
  await fs.removeSync(BUILD_DIR);
  await fs.removeSync(XPI_PATH);
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
// TODO: use babel for all TS files instead
async function compileTs(msgs = { sucsess: 'TS Compiler finished', error: 'TS Compiler failed' }, _event, _path) {
  // console.log('Compile TS sources');
  return await executeCommand('npm run compile:ts', msgs.sucsess, msgs.error);
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
  try {
    // Remove previous build
    await cleanupOldBuild(event, path);
    console.log(chalk.green('1: Old build artifacts removed'));

    // Try to load jasmine lib if not exist
    await loadJasmine({
      success: '2: Jasmine lib loaded',
      error: '2: Error loading jasmine lib',
    });

    // Move sources to build folder
    await copySources(event, path);
    console.log(chalk.green('3: Sources copied to build folder'));

    // Copmie TS sources in build folder
    await compileTs(
      {
        sucsess: '4: TS sources compilled successfully',
        error: '4: Failed to compile TS sources',
      },
      event,
      path,
    );

    // Remove TS sources from build folders
    await removeTsSources();
    console.log(chalk.green('5: TS sources removed from build folder'));

    // Remove TS sources from build folders
    await packageXPI({
      success: '6: XPI packaged successfully',
      error: '6: XPI packaging failed s',
    });

    // const otherSourcesPattern
    // TODO: cleanup unnececary files

    // Run headless tests on installer
    // TODO: try to use web-ext to connect to started browser instead of starting headless one
    let testResults;
    if (TESTS_ENABLED) {
      testResults = await libreJSTest();
      const { SUMMARY, DETAILS } = testResults;
      if (DETAILS && DETAILS.length > 0) {
        console.error(chalk.red('7: Automatic tests: ' + SUMMARY));
        if (DETAILS) DETAILS.forEach((str) => console.error(chalk.red('  - ' + str)));
      } else {
        console.log(chalk.green('7: Automatic tests: ' + SUMMARY));
        if (DETAILS) DETAILS.forEach((str) => console.log(chalk.green('  - ' + str)));
      }
    }

    // Reload extensions after success build, if extensionRunner is provided
    if (WATCH_ENABLED && extensionRunner) {
      await extensionRunner.reloadAllExtensions();
    }
  } catch (error) {
    console.error(chalk.red(error?.error ?? error));
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
  return await new Promise((res, rej) => {
    exec(command, function (error, stdout, stderr) {
      // console.log({ error, stdout, stderr });
      if (error) {
        if (errorMessage) console.error(chalk.red(errorMessage));
        rej({ error, stdout, stderr });
      } else {
        if (successMessage) console.log(chalk.green(successMessage));
        res({ error, stdout, stderr });
      }
    });

    // runner.on('error', (error) => {
    //   console.error(error.message);
    //   throw error;
    // });

    //   runner.on('close', (code) => {
    //     if (code === 0) {
    //       if (successMessage) console.log(successMessage);
    //       res(code);
    //     } else {
    //       if (errorMessage) console.error(errorMessage);
    //       rej(code);
    //     }
    //   });
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
  await main().catch(console.error);

  if (WATCH_ENABLED) {
    // Initialize watcher for JS/TS files
    const watcher = watch(SRC_DIR + '/**/*', {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
      ignoreInitial: true,
    });
    // Initialize extension runner
    const extensionRunner = await webExt.cmd.run(
      { sourceDir: BUILD_DIR, noReload: true },
      { shouldExitProgram: false },
    );
    watcher.on('all', (event, path) => debounce(main, 500)(event, path, extensionRunner).catch(console.error));
    console.log('Started ExtensionRunners: ' + extensionRunner.extensionRunners.length);
  }
}

// export { main, compileTs, buildWebExt, start };
// export default start;

void start();
