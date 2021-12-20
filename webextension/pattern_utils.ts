/**
 * GNU LibreJS - A browser add-on to block nonfree nontrivial JavaScript.
 * *
 * Copyright (C) 2011, 2012, 2013, 2014 Loic J. Duros
 * Copyright (C) 2014, 2015 Nik Nyby
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

export const patternUtils = {
  /**
   * removeNonalpha
   *
   * Remove all nonalphanumeric values, except for
   * < and >, since they are what we use for tokens.
   *
   */
  removeNonalpha: function (str: string): string {
    const regex = /[^a-z0-9<>@]+/gi;
    return str.replace(regex, '');
  },
  removeWhitespace: function (str: string): string {
    return str.replace(/\/\//gim, '').replace(/\*/gim, '').replace(/\s+/gim, '');
  },
  replaceTokens: function (str: string): string {
    const regex = /<.*?>/gi;
    return str.replace(regex, '.*?');
  },
};
