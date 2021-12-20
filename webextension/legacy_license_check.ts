/**
 * GNU LibreJS - A browser add-on to block nonfree nontrivial JavaScript.
 * *
 * Copyright (C) 2018 Nathan Nichols
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

const data = require('./license_definitions.js');
const match_utils = require('./pattern_utils.js').patternUtils;

const licStartLicEndRe =
  /@licstartThefollowingistheentirelicensenoticefortheJavaScriptcodeinthis(?:page|file)(.*)?@licendTheaboveistheentirelicensenoticefortheJavaScriptcodeinthis(?:page|file)/im;

/**
 * stripLicenseToRegexp
 *
 * Removes all non-alphanumeric characters except for the
 * special tokens, and replace the text values that are
 * hardcoded in license_definitions.js
 *
 */
const stripLicenseToRegexp = function (license: any): any {
  const max = license.licenseFragments.length;
  let item: any;
  for (let i = 0; i < max; i++) {
    item = license.licenseFragments[i];
    item.regex = match_utils.removeNonalpha(item.text);
    item.regex = new RegExp(match_utils.replaceTokens(item.regex), '');
  }
  return license;
};

const license_regexes = [];

export const init = function () {
  console.log('initializing regexes');
  for (const item in data.licenses) {
    license_regexes.push(stripLicenseToRegexp(data.licenses[item]));
  }
  //console.log(license_regexes);
};

/**
 *
 *	Takes in the declaration that has been preprocessed and
 *	tests it against regexes in our table.
 */
const search_table = function (stripped_comment: string): false | string {
  const stripped = match_utils.removeNonalpha(stripped_comment);
  //stripped = stripped.replaceTokens(stripped_comment);

  //console.log("Looking up license");
  //console.log(stripped);

  for (const license in data.licenses) {
    const frag = data.licenses[license].licenseFragments;
    const max_i = data.licenses[license].licenseFragments.length;
    for (let i = 0; i < max_i; i++) {
      if (frag[i].regex.test(stripped)) {
        //console.log(data.licenses[license].licenseName);
        return data.licenses[license].licenseName;
      }
    }
  }
  console.log('No global license found.');
  return false;
};

/**
 *	Takes the "first comment available on the page"
 *	returns true for "free" and false for anything else
 */
export const check = function (license_text: string): any {
  //console.log("checking...");
  //console.log(license_text);

  if (license_text === undefined || license_text === null || license_text == '') {
    //console.log("Was not an inline script");
    return false;
  }
  // remove whitespace
  const stripped = match_utils.removeWhitespace(license_text);
  // Search for @licstart/@licend
  // This assumes that there isn't anything before the comment
  const matches = stripped.match(licStartLicEndRe);
  if (matches == null) {
    return false;
  }
  const declaration = matches[0];

  return search_table(declaration);
};
