/**
 * GNU LibreJS - A browser add-on to block nonfree nontrivial JavaScript.
 *
 * Copyright (C) 2018 Giorgio Maone <giorgio@maone.net>
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

/*
  A class to manage whitelist/blacklist operations
*/

const { ListStore } = require('../common/Storage');

class ListManager {
  lists: { whitelist: any; blacklist: any };
  builtInHashes: Set<unknown>;

  constructor(whitelist: any, blacklist: any, builtInHashes: Set<unknown>) {
    this.lists = { whitelist, blacklist };
    this.builtInHashes = new Set(builtInHashes);
  }

  static async move(fromList: any, toList: any, ...keys: any): Promise<any> {
    await Promise.all([fromList.remove(...keys), toList.store(...keys)]);
  }

  async whitelist(...keys: any): Promise<any> {
    await ListManager.move(this.lists.blacklist, this.lists.whitelist, ...keys);
  }
  async blacklist(...keys: any): Promise<any> {
    await ListManager.move(this.lists.whitelist, this.lists.blacklist, ...keys);
  }
  async forget(...keys: any): Promise<any> {
    await Promise.all(Object.values(this.lists).map(async (l) => await l.remove(...keys)));
  }
  /* key is a string representing either a URL or an optional path
    with a trailing (hash).
    Returns "blacklisted", "whitelisted" or defValue
  */
  getStatus(key: string, defValue = 'unknown'): string {
    const { blacklist, whitelist } = this.lists;
    const inline = ListStore.inlineItem(key);
    if (inline) {
      return blacklist.contains(inline) ? 'blacklisted' : whitelist.contains(inline) ? 'whitelisted' : defValue;
    }

    const match = key.match(/\(([^)]+)\)(?=[^()]*$)/);
    if (!match) {
      const url = ListStore.urlItem(key);
      const site = ListStore.siteItem(key);
      return blacklist.contains(url) || ListManager.siteMatch(site, blacklist)
        ? 'blacklisted'
        : whitelist.contains(url) || ListManager.siteMatch(site, whitelist)
        ? 'whitelisted'
        : defValue;
    }

    const [hashItem, srcHash] = match; // (hash), hash
    return blacklist.contains(hashItem)
      ? 'blacklisted'
      : this.builtInHashes.has(srcHash) || whitelist.contains(hashItem)
      ? 'whitelisted'
      : defValue;
  }

  /*
      Matches by whole site ("http://some.domain.com/*") supporting also
      wildcarded subdomains ("https://*.domain.com/*").
    */
  static siteMatch(url: string, list: any): string {
    let site = ListStore.siteItem(url);
    if (list.contains(site)) {
      return site;
    }
    site = site.replace(/^([\w-]+:\/\/)?(\w)/, '$1*.$2');
    for (;;) {
      if (list.contains(site)) {
        return site;
      }
      const oldKey = site;
      site = site.replace(/(?:\*\.)*\w+(?=\.)/, '*');
      if (site === oldKey) {
        return null;
      }
    }
  }
}

export = { ListManager };
