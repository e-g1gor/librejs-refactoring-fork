/**
 * GNU LibreJS - A browser add-on to block nonfree nontrivial JavaScript.
 * *
 * Copyright (C) 2021 Yuchen Pei
 *
 * This file is part of GNU LibreJS.
 *
 * GNU LibreJS is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * GNU LibreJS is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with GNU LibreJS.  If not, see <http://www.gnu.org/licenses/>.
 */

/**
 * A node script that runs tests in a headless browser.
 * Usage:
 * node ./test.js [seed-number]
 */

const { Builder, By } = require('selenium-webdriver');
const { Options } = require('selenium-webdriver/firefox.js');

/**
 * This function perform headless browser tests on built `librejs.xpi` extension
 * @returns Test results or error info in case of exception
 */
async function libreJSTest() {
  try {
    // TODO: think about persistent driver for watching script?
    const driver = new Builder()
      .forBrowser('firefox')
      .setFirefoxOptions(
        new Options()
          // Uncomment this line to test using icecat
          //		       .setBinary("/usr/bin/icecat")
          .headless(),
      )
      .build();

    try {
      const TEST_RESULTS_PAGE = await driver
        .installAddon('./librejs.xpi', /*isTemporary=*/ true)
        .then(driver.get('about:debugging#/runtime/this-firefox'))
        .then((_) => driver.findElements(By.css('.fieldpair dd')))
        .then((es) => es[2].getText())
        .then((uuid) =>
          driver.get(
            'moz-extension://' + uuid + '/test/SpecRunner.html' + (process.argv[2] ? '?seed=' + process.argv[2] : ''),
          ),
        );

      const SUMMARY = await driver.wait(
        (_) => driver.findElement(By.css('.jasmine-alert')).then((e) => e.getText()),
        10000,
      );
      const DETAILS = await Promise.all(
        (await driver.findElements(By.css('.jasmine-description'))).map((el) => el.getText()),
      );

      // Print summary
      console.log(SUMMARY);
      // Print failed tests
      DETAILS.forEach((str) => console.error(str));

      // That'll not prevent executing `finally` block, it always executes.
      return { SUMMARY, DETAILS };
    } catch (error) {
      console.error(error);
      // That'll not prevent executing `finally` block, it always executes.
      throw { error };
    } finally {
      driver.quit();
    }
  } catch (error) {
    console.error(error);
    throw error;
  }
}

module.exports = { libreJSTest };

// Perform tests, if it was not disabled by `LIBREJS_TEST_MANUAL` env variable
if ([1, '1', true, null, undefined, ''].includes(process.env.LIBREJS_TEST_MANUAL)) {
  void libreJSTest();
}
