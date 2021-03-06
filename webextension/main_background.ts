/**
 * GNU LibreJS - A browser add-on to block nonfree nontrivial JavaScript.
 * *
 * Copyright (C) 2017, 2018 Nathan Nichols
 * Copyright (C) 2018 Ruben Rodriguez <ruben@gnu.org>
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

const acorn = require('acorn');
const acornLoose = require('acorn-loose');
const legacy_license_lib = require('./legacy_license_check.js');
const { ResponseProcessor } = require('./bg/ResponseProcessor');
const { Storage: StorageWrapper, ListStore, hash } = require('./common/Storage');
const { ListManager } = require('./bg/ListManager');
const { ExternalLicenses } = require('./bg/ExternalLicenses');

const whitelist = new ListStore('pref_whitelist', StorageWrapper.CSV);
const blacklist = new ListStore('pref_blacklist', StorageWrapper.CSV);
const listManager = new ListManager(
  whitelist,
  blacklist,
  // built-in whitelist of script hashes, e.g. jQuery
  Object.values<any>(require('./hash_script/whitelist').whitelist)
    .reduce((a, b) => a.concat(b)) // as a flat array
    .map((script: { hash: any }) => script.hash),
);

console.log('main_background.js');
/**
 *	If this is true, it evaluates entire scripts instead of returning as soon as it encounters a violation.
 *
 *	Also, it controls whether or not this part of the code logs to the console.
 *
 */
const DEBUG = false; // debug the JS evaluation
const PRINT_DEBUG = false; // Everything else
const time = Date.now();

function dbg_print(a: any, b?: any) {
  if (PRINT_DEBUG) {
    console.log('Time spent so far: ' + (Date.now() - time) / 1000 + ' seconds');
    if (b === undefined) {
      console.log(a);
    } else {
      console.log(a, b);
    }
  }
}

/*
	NONTRIVIAL THINGS:
	- Fetch
	- XMLhttpRequest
	- eval()
	- ?
	JAVASCRIPT CAN BE FOUND IN:
	- Event handlers (onclick, onload, onsubmit, etc.)
	- <script>JS</script>
	- <script src="/JS.js"></script>
	WAYS TO DETERMINE PASS/FAIL:
	- "// @license [magnet link] [identifier]" then "// @license-end" (may also use /* comments)
	- Automatic whitelist: (http://bzr.savannah.gnu.org/lh/librejs/dev/annotate/head:/data/script_libraries/script-libraries.json_
*/
const licenses = require('./licenses.json').licenses;

// These are objects that it will search for in an initial regex pass over non-free scripts.
const reserved_objects = [
  //"document",
  //"window",
  'fetch',
  'XMLHttpRequest',
  'chrome', // only on chrome
  'browser', // only on firefox
  'eval',
];

// Generates JSON key for local storage
function get_storage_key(script_name: any, src_hash: any) {
  return script_name;
}

/*
 *
 *	Called when something changes the persistent data of the add-on.
 *
 *	The only things that should need to change this data are:
 *	a) The "Whitelist this page" button
 *	b) The options screen
 *
 *	When the actual blocking is implemented, this will need to comminicate
 *	with its code to update accordingly
 *
 */
function options_listener(changes: any, area: string) {
  // The cache must be flushed when settings are changed
  // TODO: See if this can be minimized
  function flushed() {
    dbg_print('cache flushed');
  }
  //var flushingCache = browser.webRequest.handlerBehaviorChanged(flushed);

  dbg_print('Items updated in area' + area + ': ');

  const changedItems = Object.keys(changes);
  let changed_items = '';
  for (let i = 0; i < changedItems.length; i++) {
    const item = changedItems[i];
    changed_items += item + ',';
  }
  dbg_print(changed_items);
}

const activeMessagePorts = {};
const activityReports = {};
async function createReport(initializer: any) {
  if (!(initializer && (initializer.url || initializer.tabId))) {
    throw new Error('createReport() needs an URL or a tabId at least');
  }
  let template: any = {
    accepted: [],
    blocked: [],
    blacklisted: [],
    whitelisted: [],
    unknown: [],
  };
  template = Object.assign(template, initializer);
  const [url] = (template.url || (await browser.tabs.get(initializer.tabId)).url).split('#');
  template.url = url;
  template.site = ListStore.siteItem(url);
  template.siteStatus = listManager.getStatus(template.site);
  const list = { whitelisted: whitelist, blacklisted: blacklist }[template.siteStatus];
  if (list) {
    template.listedSite = ListManager.siteMatch(template.site, list);
  }
  return template;
}

/**
 *	Executes the "Display this report in new tab" function
 *	by opening a new tab with whatever HTML is in the popup
 *	at the moment.
 */
async function openReportInTab(data: { tabId: number }) {
  const popupURL = await browser.browserAction.getPopup({});
  const tab = await browser.tabs.create({ url: `${popupURL}#fromTab=${data.tabId}` });
  activityReports[tab.id] = await createReport(data);
}

/**
 *
 *	Clears local storage (the persistent data)
 *
 */
function debug_delete_local() {
  void browser.storage.local.clear();
  dbg_print('Local storage cleared');
}

/**
 *
 *	Prints local storage (the persistent data) as well as the temporary popup object
 *
 */
function debug_print_local() {
  function storage_got(items: any) {
    console.log('%c Local storage: ', 'color: red;');
    for (const i in items) {
      console.log('%c ' + i + ' = ' + items[i], 'color: blue;');
    }
  }
  console.log("%c Variable 'activityReports': ", 'color: red;');
  console.log(activityReports);
  void browser.storage.local.get(storage_got as any);
}

/**
 *
 *
 *	Sends a message to the content script that sets the popup entries for a tab.
 *
 *	var example_blocked_info = {
 *		"accepted": [["REASON 1","SOURCE 1"],["REASON 2","SOURCE 2"]],
 *		"blocked": [["REASON 1","SOURCE 1"],["REASON 2","SOURCE 2"]],
 *		"url": "example.com"
 *	}
 *
 *	NOTE: This WILL break if you provide inconsistent URLs to it.
 *	Make sure it will use the right URL when refering to a certain script.
 *
 */
async function updateReport(tabId: number, oldReport: any, updateUI = false) {
  const { url } = oldReport;
  const newReport = await createReport({ url, tabId });
  for (const property of Object.keys(oldReport)) {
    const entries = oldReport[property];
    if (!Array.isArray(entries)) continue;
    const defValue = property === 'accepted' || property === 'blocked' ? property : 'unknown';
    for (const script of entries) {
      const status = listManager.getStatus(script[0], defValue);
      if (Array.isArray(newReport[status])) newReport[status].push(script);
    }
  }
  activityReports[tabId] = newReport;
  if (browser.sessions) await browser.sessions.setTabValue(tabId, url, newReport);
  dbg_print(newReport);
  if (updateUI && activeMessagePorts[tabId]) {
    dbg_print(`[TABID: ${tabId}] Sending script blocking report directly to browser action.`);
    activeMessagePorts[tabId].postMessage({ show_info: newReport });
  }
}

/**
 *
 *	This is what you call when a page gets changed to update the info box.
 *
 *	Sends a message to the content script that adds a popup entry for a tab.
 *
 *	The action argument is an object with two properties: one named either
 * "accepted","blocked", "whitelisted", "blacklisted" or "unknown", whose value
 * is the array [scriptName, reason], and another named "url". Example:
 * action = {
 *		"accepted": ["jquery.js (someHash)","Whitelisted by user"],
 *		"url": "https://example.com/js/jquery.js"
 *	}
 *
 *	Returns either "whitelisted, "blacklisted", "blocked", "accepted" or "unknown"
 *
 *	NOTE: This WILL break if you provide inconsistent URLs to it.
 *	Make sure it will use the right URL when refering to a certain script.
 *
 */
async function addReportEntry(tabId: number, scriptHashOrUrl: any, action: any) {
  let report = activityReports[tabId];
  if (!report) report = activityReports[tabId] = await createReport({ tabId });
  let type: any, actionValue: any;
  for (type of ['accepted', 'blocked', 'whitelisted', 'blacklisted']) {
    if (type in action) {
      actionValue = action[type];
      break;
    }
  }
  if (!actionValue) {
    console.debug('Something wrong with action', action);
    return '';
  }

  // Search unused data for the given entry
  function isNew(entries: any, item: any) {
    for (const e of entries) {
      if (e[0] === item) return false;
    }
    return true;
  }

  let entryType: string;
  const scriptName = actionValue[0];
  try {
    entryType = listManager.getStatus(scriptName, type);
    const entries = report[entryType];
    if (isNew(entries, scriptName)) {
      dbg_print(activityReports);
      dbg_print(activityReports[tabId]);
      dbg_print(entryType);
      entries.push(actionValue);
    }
  } catch (e) {
    console.error('action %o, type %s, entryType %s', action, type, entryType, e);
    entryType = 'unknown';
  }

  if (activeMessagePorts[tabId]) {
    try {
      activeMessagePorts[tabId].postMessage({ show_info: report });
    } catch (e) {}
  }

  if (browser.sessions) await browser.sessions.setTabValue(tabId, report.url, report);
  updateBadge(tabId, report);
  return entryType;
}

function get_domain(url: string) {
  let domain = url.replace('http://', '').replace('https://', '').split(/[/?#]/)[0];
  if (url.indexOf('http://') == 0) {
    domain = 'http://' + domain;
  } else if (url.indexOf('https://') == 0) {
    domain = 'https://' + domain;
  }
  domain = domain + '/';
  domain = domain.replace(/ /g, '');
  return domain;
}

/**
 *
 *	This is the callback where the content scripts of the browser action will contact the background script.
 *
 */
let portFromCS: any;
async function connected(p: any) {
  if (p.name === 'contact_finder') {
    // style the contact finder panel
    await browser.tabs.insertCSS(p.sender.tab.id, {
      file: '/content/dialog.css',
      cssOrigin: 'user',
      matchAboutBlank: true,
      allFrames: true,
    });

    // Send a message back with the relevant settings
    p.postMessage(await browser.storage.local.get(['prefs_subject', 'prefs_body']));
    return;
  }
  p.onMessage.addListener(async function (m: any) {
    let update = false;
    let contact_finder = false;

    for (const action of ['whitelist', 'blacklist', 'forget']) {
      if (m[action]) {
        let [key] = m[action];
        if (m.site) {
          key = ListStore.siteItem(m.site);
        } else {
          key = ListStore.inlineItem(key) || key;
        }
        await listManager[action](key);
        update = true;
      }
    }

    if (m.report_tab) {
      await openReportInTab(m.report_tab);
    }
    // a debug feature
    if (m['printlocalstorage'] !== undefined) {
      console.log('Print local storage');
      debug_print_local();
    }
    // invoke_contact_finder
    if (m['invoke_contact_finder'] !== undefined) {
      contact_finder = true;
      await injectContactFinder();
    }
    // a debug feature (maybe give the user an option to do this?)
    if (m['deletelocalstorage'] !== undefined) {
      console.log('Delete local storage');
      debug_delete_local();
    }

    const tabs = await browser.tabs.query({ active: true, currentWindow: true });

    if (contact_finder) {
      const tab = tabs.pop();
      dbg_print(`[TABID:${tab.id}] Injecting contact finder`);
      //inject_contact_finder(tabs[0]["id"]);
    }
    if (update || (m.update && activityReports[m.tabId])) {
      const tabId = 'tabId' in m ? m.tabId : tabs.pop().id;
      dbg_print(`%c updating tab ${tabId}`, 'color: red;');
      activeMessagePorts[tabId] = p;
      await updateReport(tabId, activityReports[tabId], true);
    } else {
      for (const tab of tabs) {
        if (activityReports[tab.id]) {
          // If we have some data stored here for this tabID, send it
          dbg_print(`[TABID: ${tab.id}] Sending stored data associated with browser action'`);
          p.postMessage({ show_info: activityReports[tab.id] });
        } else {
          // create a new entry
          const report = (activityReports[tab.id] = await createReport({ url: tab.url, tabId: tab.id }));
          p.postMessage({ show_info: report });
          dbg_print(`[TABID: ${tab.id}] No data found, creating a new entry for this window.`);
        }
      }
    }
  });
}

/**
 *	The callback for tab closings.
 *
 *	Delete the info we are storing about this tab if there is any.
 *
 */
function delete_removed_tab_info(tab_id: string, remove_info: any) {
  dbg_print('[TABID:' + tab_id + ']' + 'Deleting stored info about closed tab');
  if (activityReports[tab_id] !== undefined) {
    delete activityReports[tab_id];
  }
  if (activeMessagePorts[tab_id] !== undefined) {
    delete activeMessagePorts[tab_id];
  }
  ExternalLicenses.purgeCache(tab_id);
}

/**
 *	Called when the tab gets updated / activated
 *
 *	Here we check if  new tab's url matches activityReports[tabId].url, and if
 * it doesn't we use the session cached value (if any).
 *
 */

async function onTabUpdated(tabId: number, changedInfo: any, tab: browser.tabs.Tab) {
  const [url] = tab.url.split('#');
  const report = activityReports[tabId];
  if (!(report && report.url === url)) {
    const cache = (browser.sessions && (await browser.sessions.getTabValue(tabId, url))) || null;
    // on session restore tabIds may change
    if (cache && (cache as any).tabId !== tabId) (cache as any).tabId = tabId;
    updateBadge(tabId, (activityReports[tabId] = cache));
  }
}

async function onTabActivated({ tabId }) {
  await onTabUpdated(tabId, {}, await browser.tabs.get(tabId));
}

/* *********************************************************************************************** */

const fname_data = require('./fname_data.json').fname_data;

//************************this part can be tested in the HTML file index.html's script test.js****************************

function full_evaluate(script: string) {
  const res = true;
  if (script === undefined || script == '') {
    return [true, 'Harmless null script'];
  }

  const ast = acornLoose.parse(script).body[0];

  const flag = false;
  let amtloops = 0;

  const loopkeys = { for: true, if: true, while: true, switch: true };
  const operators = {
    '||': true,
    '&&': true,
    '=': true,
    '==': true,
    '++': true,
    '--': true,
    '+=': true,
    '-=': true,
    '*': true,
  };
  let tokens;
  let toke;
  try {
    tokens = acorn.tokenizer(script);
  } catch (e) {
    console.warn('Tokenizer could not be initiated (probably invalid code)');
    return [false, 'Tokenizer could not be initiated (probably invalid code)'];
  }
  try {
    toke = tokens.getToken();
  } catch (e) {
    console.log(script);
    console.log(e);
    console.warn("couldn't get first token (probably invalid code)");
    console.warn('Continuing evaluation');
  }

  /**
   * Given the end of an identifer token, it tests for bracket suffix notation
   */
  function being_called(end: number) {
    let i = 0;
    while (script.charAt(end + i).match(/\s/g) !== null) {
      i++;
      if (i >= script.length - 1) {
        return false;
      }
    }

    return script.charAt(end + i) == '(';
  }
  /**
   * Given the end of an identifer token, it tests for parentheses
   */
  function is_bsn(end: number) {
    let i = 0;
    while (script.charAt(end + i).match(/\s/g) !== null) {
      i++;
      if (i >= script.length - 1) {
        return false;
      }
    }
    return script.charAt(end + i) == '[';
  }
  const error_count = 0;
  let defines_functions = false;
  while (toke !== undefined && toke.type != acorn.tokTypes.eof) {
    if (toke.type.keyword !== undefined) {
      //dbg_print("Keyword:");
      //dbg_print(toke);

      // This type of loop detection ignores functional loop alternatives and ternary operators

      if (toke.type.keyword == 'function') {
        dbg_print('%c NOTICE: Function declaration.', 'color:green');
        defines_functions = true;
      }

      if (loopkeys[toke.type.keyword] !== undefined) {
        amtloops++;
        if (amtloops > 3) {
          dbg_print('%c NONTRIVIAL: Too many loops/conditionals.', 'color:red');
          if (DEBUG == false) {
            return [false, 'NONTRIVIAL: Too many loops/conditionals.'];
          }
        }
      }
    } else if (toke.value !== undefined && operators[toke.value] !== undefined) {
      // It's just an operator. Javascript doesn't have operator overloading so it must be some
      // kind of primitive (I.e. a number)
    } else if (toke.value !== undefined) {
      const status = fname_data[toke.value];
      if (status === true) {
        // is the identifier banned?
        dbg_print("%c NONTRIVIAL: nontrivial token: '" + toke.value + "'", 'color:red');
        if (DEBUG == false) {
          return [false, "NONTRIVIAL: nontrivial token: '" + toke.value + "'"];
        }
      } else if (status === false) {
        // is the identifier not banned?
        // Is there bracket suffix notation?
        if (is_bsn(toke.end)) {
          dbg_print("%c NONTRIVIAL: Bracket suffix notation on variable '" + toke.value + "'", 'color:red');
          if (DEBUG == false) {
            return [false, "%c NONTRIVIAL: Bracket suffix notation on variable '" + toke.value + "'"];
          }
        }
      } else if (status === undefined) {
        // is the identifier user defined?
        // Is there bracket suffix notation?
        if (is_bsn(toke.end)) {
          dbg_print("%c NONTRIVIAL: Bracket suffix notation on variable '" + toke.value + "'", 'color:red');
          if (DEBUG == false) {
            return [false, "NONTRIVIAL: Bracket suffix notation on variable '" + toke.value + "'"];
          }
        }
      } else {
        dbg_print('trivial token:' + toke.value);
      }
    }
    // If not a keyword or an identifier it's some kind of operator, field parenthesis, brackets
    try {
      toke = tokens.getToken();
    } catch (e) {
      dbg_print('Denied script because it cannot be parsed.');
      return [false, 'NONTRIVIAL: Cannot be parsed. This could mean it is a 404 error.'];
    }
  }

  dbg_print('%cAppears to be trivial.', 'color:green;');
  if (defines_functions === true) return [true, 'Script appears to be trivial but defines functions.'];
  else return [true, 'Script appears to be trivial.'];
}

//****************************************************************************************************
/**
*	This is the entry point for full code evaluation.
*
*	Performs the initial pass on code to see if it needs to be completely parsed
*
*	This can only determine if a script is bad, not if it's good
*
*	If it passes the intitial pass, it runs the full pass and returns the result

*	It returns an array of [flag (boolean, false if "bad"), reason (string, human readable report)]
*
*/
function evaluate(script: string, name: string) {
  function reserved_object_regex(object: string) {
    const arith_operators = '\\+\\-\\*\\/\\%\\=';
    const scope_chars = '{}][(),';
    const trailing_chars = 's*' + '(.[';
    return new RegExp(
      '(?:[^\\w\\d]|^|(?:' + arith_operators + '))' + object + '(?:\\s*?(?:[\\;\\,\\.\\(\\[])\\s*?)',
      'g',
    );
  }
  reserved_object_regex('window');
  const all_strings = new RegExp('".*?"' + "|'.*?'", 'gm');
  const ml_comment = /\/\*([\s\S]+?)\*\//g;
  const il_comment = /\/\/.+/gm;
  const bracket_pairs = /\[.+?\]/g;
  let temp = script.replace(/'.+?'+/gm, "'string'");
  temp = temp.replace(/".+?"+/gm, '"string"');
  temp = temp.replace(ml_comment, '');
  temp = temp.replace(il_comment, '');
  dbg_print('%c ------evaluation results for ' + name + '------', 'color:white');
  dbg_print('Script accesses reserved objects?');
  let flag = true;
  let reason = '';
  // 	This is where individual "passes" are made over the code
  for (let i = 0; i < reserved_objects.length; i++) {
    const res = reserved_object_regex(reserved_objects[i]).exec(temp);
    if (res != null) {
      dbg_print('%c fail', 'color:red;');
      flag = false;
      reason = 'Script uses a reserved object (' + reserved_objects[i] + ')';
    }
  }
  if (flag) {
    dbg_print('%c pass', 'color:green;');
  } else {
    return [flag, reason];
  }

  return full_evaluate(script);
}

function validateLicense(matches: string | any[]) {
  if (!(Array.isArray(matches) && matches.length >= 4)) {
    return [false, 'Malformed or unrecognized license tag.'];
  }

  const [all, tag, first, second] = matches;

  for (const key in licenses) {
    // Match by id on first or second parameter, ignoring case
    if (key.toLowerCase() === first.toLowerCase() || key.toLowerCase() === second.toLowerCase()) {
      return [true, `Recognized license: "${licenses[key]['Name']}" `];
    }
    // Match by link on first parameter (legacy)
    if (
      licenses[key]['Magnet link'] === first.replace('&amp;', '&') ||
      licenses[key]['URL'] === first.replace('&amp;', '&') ||
      licenses[key]['URL'].replace('http://', 'https://') === first.replace('&amp;', '&')
    ) {
      return [true, `Recognized license: "${licenses[key]['Name']}".`];
    }
  }
  return [false, `Unrecognized license tag: "${all}"`];
}

/**
 *
 *	Evaluates the content of a script (license, if it is non-trivial)
 *
 *	Returns
 *	[
 *		true (accepted) or false (denied),
 *		edited content,
 *		reason text
 *	]
 */
function license_read(scriptSrc: string, name: any, external = false) {
  const license = legacy_license_lib.check(scriptSrc);
  if (license) {
    return [true, scriptSrc, `Licensed under: ${license}`];
  }
  if (listManager.builtInHashes.has(hash(scriptSrc))) {
    return [true, scriptSrc, 'Common script known to be free software.'];
  }

  let editedSrc = '';
  let uneditedSrc = scriptSrc.trim();
  let reason = uneditedSrc ? '' : 'Empty source.';
  let partsDenied = false;
  let partsAccepted = false;

  function checkTriviality(s: string) {
    if (!s.trim()) {
      return true; // empty, ignore it
    }
    const [trivial, message] = external ? [false, 'External script with no known license'] : evaluate(s, name);
    if (trivial) {
      partsAccepted = true;
      editedSrc += s;
    } else {
      partsDenied = true;
      if (s.startsWith('javascript:')) editedSrc += `# LIBREJS BLOCKED: ${message}`;
      else editedSrc += `/*\nLIBREJS BLOCKED: ${message}\n*/`;
    }
    reason += `\n${message}`;
    return trivial;
  }

  while (uneditedSrc) {
    const openingMatch = /\/[\/\*]\s*?(@license)\s+(\S+)\s+(\S+)\s*$/im.exec(uneditedSrc);
    if (!openingMatch) {
      // no license found, check for triviality
      checkTriviality(uneditedSrc);
      break;
    }

    const openingIndex = openingMatch.index;
    if (openingIndex) {
      // let's check the triviality of the code before the license tag, if any
      checkTriviality(uneditedSrc.substring(0, openingIndex));
    }
    // let's check the actual license
    uneditedSrc = uneditedSrc.substring(openingIndex);

    const closureMatch = /\/([*/])\s*@license-end\b[^*/\n]*/i.exec(uneditedSrc);
    if (!closureMatch) {
      const msg = 'ERROR: @license with no @license-end';
      return [false, `\n/*\n ${msg} \n*/\n`, msg];
    }

    let closureEndIndex = closureMatch.index + closureMatch[0].length;
    const commentEndOffset = uneditedSrc.substring(closureEndIndex).indexOf(closureMatch[1] === '*' ? '*/' : '\n');
    if (commentEndOffset !== -1) {
      closureEndIndex += commentEndOffset;
    }

    const [licenseOK, message] = validateLicense(openingMatch);
    if (licenseOK) {
      editedSrc += uneditedSrc.substr(0, closureEndIndex);
      partsAccepted = true;
    } else {
      editedSrc += `\n/*\n${message}\n*/\n`;
      partsDenied = true;
    }
    reason += `\n${message}`;

    // trim off everything we just evaluated
    uneditedSrc = uneditedSrc.substring(closureEndIndex).trim();
  }

  if (partsDenied) {
    if (partsAccepted) {
      reason = `Some parts of the script have been disabled (check the source for details).\n^--- ${reason}`;
    }
    return [false, editedSrc, reason];
  }

  return [true, scriptSrc, reason];
}

/* *********************************************************************************************** */
// TODO: Test if this script is being loaded from another domain compared to activityReports[tabid]["url"]

/**
 *	Asynchronous function, returns the final edited script as a string,
 * or an array containing it and the index, if the latter !== -1
 */
async function get_script(response: string, url: string, tabId = -1, whitelisted = false, index = -1): Promise<any> {
  function result(scriptSource: string | any): any {
    return index === -1 ? scriptSource : [scriptSource, index];
  }

  const scriptName = url.split('/').pop();
  if (whitelisted) {
    if (tabId !== -1) {
      const site = ListManager.siteMatch(url, whitelist);
      // Accept without reading script, it was explicitly whitelisted
      const reason = site ? `All ${site} whitelisted by user` : 'Address whitelisted by user';
      await addReportEntry(tabId, url, { whitelisted: [site || url, reason], url });
    }
    if (response.startsWith('javascript:')) return result(response);
    else return result(`/* LibreJS: script whitelisted by user preference. */\n${response}`);
  }

  let [verdict, editedSource, reason] = license_read(response, scriptName, index === -2);

  if (tabId < 0) {
    return result(verdict ? response : editedSource);
  }

  const sourceHash = hash(response);
  const domain = get_domain(url);
  const report = activityReports[tabId] || (activityReports[tabId] = await createReport({ tabId }));
  updateBadge(tabId, report, !verdict);
  const category = await addReportEntry(tabId, sourceHash, {
    url: domain,
    [verdict ? 'accepted' : 'blocked']: [url, reason],
  });
  switch (category) {
    case 'blacklisted':
      editedSource = `/* LibreJS: script ${category} by user. */`;
      return result(
        response.startsWith('javascript:') ? `javascript:void(${encodeURIComponent(editedSource)})` : editedSource,
      );
    case 'whitelisted':
      return result(
        response.startsWith('javascript:') ? response : `/* LibreJS: script ${category} by user. */\n${response}`,
      );
    default:
      const scriptSource = verdict ? response : editedSource;
      return result(
        response.startsWith('javascript:')
          ? verdict
            ? scriptSource
            : `javascript:void(/* ${scriptSource} */)`
          : `/* LibreJS: script ${category}. */\n${scriptSource}`,
      );
  }
}

function updateBadge(tabId: number, report = null, forceRed = false) {
  const blockedCount = report ? report.blocked.length + report.blacklisted.length : 0;
  const [text, color] =
    blockedCount > 0 || forceRed ? [(blockedCount && blockedCount.toString()) || '!', 'red'] : ['???', 'green'];
  const { browserAction } = browser;
  if ('setBadgeText' in browserAction) {
    browserAction.setBadgeText({ text, tabId });
    browserAction.setBadgeBackgroundColor({ color, tabId });
  } else {
    // Mobile
    browserAction.setTitle({ title: `LibreJS (${text})`, tabId });
  }
}

function blockGoogleAnalytics(request: { url: any }) {
  const { url } = request;
  const res: any = {};
  if (
    url === 'https://www.google-analytics.com/analytics.js' ||
    /^https:\/\/www\.google\.com\/analytics\/[^#]/.test(url)
  ) {
    res.cancel = true;
  }
  return res;
}

async function blockBlacklistedScripts(request: any) {
  let { url, tabId, documentUrl } = request;
  url = ListStore.urlItem(url);
  const status = listManager.getStatus(url);
  if (status !== 'blacklisted') return {};
  const blacklistedSite = ListManager.siteMatch(url, blacklist);
  await addReportEntry(tabId, url, {
    url: documentUrl,
    blacklisted: [url, /\*/.test(blacklistedSite) ? `User blacklisted ${blacklistedSite}` : 'Blacklisted by user'],
  });
  return { cancel: true };
}

/**
 *	This listener gets called as soon as we've got all the HTTP headers, can guess
 * content type and encoding, and therefore correctly parse HTML documents
 * and external script inclusions in search of non-free JavaScript
 */

// eslint-disable-next-line no-var
var ResponseHandler = {
  /**
   *	Enforce white/black lists for url/site early (hashes will be handled later)
   */
  async pre(response: any) {
    const { request } = response;
    let { url, type, tabId, frameId, documentUrl } = request;

    const fullUrl = url;
    url = ListStore.urlItem(url);
    const site = ListStore.siteItem(url);

    const blacklistedSite = ListManager.siteMatch(site, blacklist);
    const blacklisted = blacklistedSite || blacklist.contains(url);
    const topUrl = (type === 'sub_frame' && request.frameAncestors && request.frameAncestors.pop()) || documentUrl;

    if (blacklisted) {
      if (type === 'script') {
        // this shouldn't happen, because we intercept earlier in blockBlacklistedScripts()
        return ResponseProcessor.REJECT;
      }
      if (type === 'main_frame') {
        // we handle the page change here too, since we won't call edit_html()
        activityReports[tabId] = await createReport({ url: fullUrl, tabId });
        // Go on without parsing the page: it was explicitly blacklisted
        const reason = blacklistedSite ? `All ${blacklistedSite} blacklisted by user` : 'Address blacklisted by user';
        await addReportEntry(tabId, url, { blacklisted: [blacklistedSite || url, reason], url: fullUrl });
      }
      // use CSP to restrict JavaScript execution in the page
      request.responseHeaders.unshift({
        name: `Content-security-policy`,
        value: `script-src 'none';`,
      });
      return { responseHeaders: request.responseHeaders }; // let's skip the inline script parsing, since we block by CSP
    } else {
      const whitelistedSite = ListManager.siteMatch(site, whitelist);
      const whitelisted = (response.whitelisted = whitelistedSite || whitelist.contains(url));
      if (type === 'script') {
        if (whitelisted) {
          // accept the script and stop processing
          await addReportEntry(tabId, url, {
            url: topUrl,
            whitelisted: [url, whitelistedSite ? `User whitelisted ${whitelistedSite}` : 'Whitelisted by user'],
          });
          return ResponseProcessor.ACCEPT;
        } else {
          const scriptInfo = await ExternalLicenses.check({ url: fullUrl, tabId, frameId, documentUrl });
          if (scriptInfo) {
            let verdict: string, ret: any;
            const msg = scriptInfo.toString();
            if (scriptInfo.free) {
              verdict = 'accepted';
              ret = ResponseProcessor.ACCEPT;
            } else {
              verdict = 'blocked';
              ret = ResponseProcessor.REJECT;
            }
            await addReportEntry(tabId, url, { url, [verdict]: [url, msg] });
            return ret;
          }
        }
      }
    }
    // it's a page (it's too early to report) or an unknown script:
    //  let's keep processing
    return ResponseProcessor.CONTINUE;
  },

  /**
   *	Here we do the heavylifting, analyzing unknown scripts
   */
  async post(response: any) {
    const { type } = response.request;
    const handle_it = type === 'script' ? handle_script : handle_html;
    return await handle_it(response, response.whitelisted);
  },
};

/**
 * Here we handle external script requests
 */
async function handle_script(response: any, whitelisted: boolean) {
  const { text, request } = response;
  let { url, tabId, frameId } = request;
  url = ListStore.urlItem(url);
  const edited = await get_script(text, url, tabId, whitelisted, -2);
  return Array.isArray(edited) ? edited[0] : edited;
}

/**
 * Serializes HTMLDocument objects including the root element and
 *	the DOCTYPE declaration
 */
function doc2HTML(doc: Document) {
  let s = doc.documentElement.outerHTML;
  if (doc.doctype) {
    const dt = doc.doctype;
    let sDoctype = `<!DOCTYPE ${dt.name || 'html'}`;
    if (dt.publicId) sDoctype += ` PUBLIC "${dt.publicId}"`;
    if (dt.systemId) sDoctype += ` "${dt.systemId}"`;
    s = `${sDoctype}>\n${s}`;
  }
  return s;
}

/**
 * Shortcut to create a correctly namespaced DOM HTML elements
 */
function createHTMLElement(doc: any, name: string) {
  return doc.createElementNS('http://www.w3.org/1999/xhtml', name);
}

/**
 * Replace any element with a span having the same content (useful to force
 * NOSCRIPT elements to visible the same way as NoScript and uBlock do)
 */
function forceElement(doc: any, element: Element) {
  const replacement = createHTMLElement(doc, 'span');
  replacement.innerHTML = element.innerHTML;
  element.replaceWith(replacement);
  return replacement;
}

/**
 *	Forces displaying any element having the "data-librejs-display" attribute and
 * <noscript> elements on pages where LibreJS disabled inline scripts (unless
 * they have the "data-librejs-nodisplay" attribute).
 */
function forceNoscriptElements(doc: Document) {
  let shown = 0;
  // inspired by NoScript's onScriptDisabled.js
  for (const noscript of doc.querySelectorAll('noscript:not([data-librejs-nodisplay])')) {
    const replacement = forceElement(doc, noscript);
    // emulate meta-refresh
    const meta = replacement.querySelector('meta[http-equiv="refresh"]');
    if (meta) {
      refresh = true;
      doc.head.appendChild(meta);
    }
    shown++;
  }
  return shown;
}
/**
 *	Forces displaying any element having the "data-librejs-display" attribute and
 * <noscript> elements on pages where LibreJS disabled inline scripts (unless
 * they have the "data-librejs-nodisplay" attribute).
 */
function showConditionalElements(doc: Document) {
  let shown = 0;
  for (const element of document.querySelectorAll('[data-librejs-display]')) {
    forceElement(doc, element);
    shown++;
  }
  return shown;
}

/**
 *	Tests to see if the intrinsic events on the page are free or not.
 *	returns true if they are, false if they're not
 */
function read_metadata(meta_element: HTMLElement) {
  if (meta_element === undefined || meta_element === null) {
    return;
  }

  console.log('metadata found');

  let metadata: Record<any, any> = {};

  try {
    metadata = JSON.parse(meta_element.innerHTML);
  } catch (error) {
    console.log('Could not parse metadata on page.');
    return false;
  }

  const license_str = metadata['intrinsic-events'];
  if (license_str === undefined) {
    console.log('No intrinsic events license');
    return false;
  }
  console.log(license_str);

  const parts = license_str.split(' ');
  if (parts.length != 2) {
    console.log('invalid (>2 tokens)');
    return false;
  }

  // this should be adequete to escape the HTML escaping
  parts[0] = parts[0].replace(/&amp;/g, '&');

  try {
    if (licenses[parts[1]]['Magnet link'] == parts[0]) {
      return true;
    } else {
      console.log("invalid (doesn't match licenses)");
      return false;
    }
  } catch (error) {
    console.log("invalid (threw error, key didn't exist)");
    return false;
  }
}
/**

* 	Reads/changes the HTML of a page and the scripts within it.
*/
async function editHtml(html: string, documentUrl: any, tabId: number, frameId: any, whitelisted: boolean) {
  const parser = new DOMParser();
  const html_doc = parser.parseFromString(html, 'text/html');

  // moves external licenses reference, if any, before any <SCRIPT> element
  ExternalLicenses.optimizeDocument(html_doc, { tabId, frameId, documentUrl });

  const url = ListStore.urlItem(documentUrl);

  if (whitelisted) {
    // don't bother rewriting
    await get_script(html, url, tabId, whitelisted); // generates whitelisted report
    return null;
  }

  let scripts = html_doc.scripts;

  const meta_element = html_doc.getElementById('LibreJS-info');
  let first_script_src = '';

  // get the potential inline source that can contain a license
  for (const script of scripts) {
    // The script must be in-line and exist
    if (script && !script.src) {
      first_script_src = script.textContent;
      break;
    }
  }

  let license = false;
  if (first_script_src != '') {
    license = legacy_license_lib.check(first_script_src);
  }

  const findLine = (finder: RegExp) =>
    (finder.test(html) && html.substring(0, finder.lastIndex).split(/\n/).length) || 0;
  if (read_metadata(meta_element) || license) {
    console.log('Valid license for intrinsic events found');
    let line: any, extras: string;
    if (meta_element) {
      line = findLine(/id\s*=\s*['"]?LibreJS-info\b/gi);
      extras = '(0)';
    } else if (license) {
      line = html.substring(0, html.indexOf(first_script_src)).split(/\n/).length;
      extras = '\n' + first_script_src;
    }
    const viewUrl = line
      ? `view-source:${documentUrl}#line${line}(<${meta_element ? meta_element.tagName : 'SCRIPT'}>)${extras}`
      : url;
    await addReportEntry(tabId, url, { url, accepted: [viewUrl, `Global license for the page: ${license}`] });
    // Do not process inline scripts
    scripts = [] as any;
  } else {
    const dejaVu = new Map(); // deduplication map & edited script cache
    let modified = false;
    // Deal with intrinsic events
    let intrinsecindex = 0;
    const intrinsicFinder = /<[a-z][^>]*\b(on\w+|href\s*=\s*['"]?javascript:)/gi;
    for (const element of html_doc.all) {
      let line = -1;
      for (const attr of element.attributes) {
        const { name } = attr;
        let { value } = attr;
        value = value.trim();
        if (name.startsWith('on') || (name === 'href' && value.toLowerCase().startsWith('javascript:'))) {
          intrinsecindex++;
          if (line === -1) {
            line = findLine(intrinsicFinder);
          }
          try {
            const key = `<${element.tagName} ${name}="${value}">`;
            let edited: string;
            if (dejaVu.has(key)) {
              edited = dejaVu.get(key);
            } else {
              const url = `view-source:${documentUrl}#line${line}(<${element.tagName} ${name}>)\n${value.trim()}`;
              if (name === 'href') value = decodeURIComponent(value);
              edited = await get_script(value, url, tabId, whitelist.contains(url));
              dejaVu.set(key, edited);
            }
            if (edited && edited !== value) {
              modified = true;
              attr.value = edited;
            }
          } catch (e) {
            console.error(e);
          }
        }
      }
    }

    let modifiedInline = false;
    const scriptFinder = /<script\b/gi;
    for (let i = 0, len = scripts.length; i < len; i++) {
      const script = scripts[i];
      const line = findLine(scriptFinder);
      if (!script.src && !(script.type && script.type !== 'text/javascript')) {
        const source = script.textContent.trim();
        let editedSource: string;
        if (dejaVu.has(source)) {
          editedSource = dejaVu.get(source);
        } else {
          const url = `view-source:${documentUrl}#line${line}(<SCRIPT>)\n${source}`;
          const edited = await get_script(source, url, tabId, whitelisted, i);
          editedSource = edited && edited[0].trim();
          dejaVu.set(url, editedSource);
        }
        if (editedSource) {
          if (source !== editedSource) {
            script.textContent = editedSource;
            modified = modifiedInline = true;
          }
        }
      }
    }

    modified = showConditionalElements(html_doc) > 0 || modified;
    if (modified) {
      if (modifiedInline) {
        forceNoscriptElements(html_doc);
      }
      return doc2HTML(html_doc);
    }
  }
  return null;
}

/**
 * Here we handle html document responses
 */
async function handle_html(response: any, whitelisted: any) {
  const { text, request } = response;
  const { url, tabId, frameId, type } = request;
  if (type === 'main_frame') {
    activityReports[tabId] = await createReport({ url, tabId });
    updateBadge(tabId);
  }
  return await editHtml(text, url, tabId, frameId, whitelisted);
}

async function initDefaults() {
  const defaults = {
    pref_subject: 'Issues with Javascript on your website',
    pref_body: `Please consider using a free license for the Javascript on your website.

[Message generated by LibreJS. See https://www.gnu.org/software/librejs/ for more information]
`,
  };
  const keys = Object.keys(defaults);
  const prefs = await browser.storage.local.get(keys);
  let changed = false;
  for (const k of keys) {
    if (!(k in prefs)) {
      prefs[k] = defaults[k];
      changed = true;
    }
  }
  if (changed) {
    await browser.storage.local.set(prefs);
  }
}

/**
 *	Initializes various add-on functions
 *	only meant to be called once when the script starts
 */
async function init_addon() {
  await initDefaults();
  await whitelist.load();
  browser.runtime.onConnect.addListener(connected);
  browser.storage.onChanged.addListener(options_listener);
  browser.tabs.onRemoved.addListener(delete_removed_tab_info as any);
  browser.tabs.onUpdated.addListener(onTabUpdated);
  browser.tabs.onActivated.addListener(onTabActivated);
  // Prevents Google Analytics from being loaded from Google servers
  const all_types = [
    'beacon',
    'csp_report',
    'font',
    'image',
    'imageset',
    'main_frame',
    'media',
    'object',
    'object_subrequest',
    'ping',
    'script',
    'stylesheet',
    'sub_frame',
    'web_manifest',
    'websocket',
    'xbl',
    'xml_dtd',
    'xmlhttprequest',
    'xslt',
    'other',
  ];
  await browser.webRequest.onBeforeRequest.addListener(
    blockGoogleAnalytics,
    { urls: ['<all_urls>'], types: all_types as any },
    ['blocking'],
  );
  await browser.webRequest.onBeforeRequest.addListener(
    blockBlacklistedScripts,
    { urls: ['<all_urls>'], types: ['script'] },
    ['blocking'],
  );
  await browser.webRequest.onResponseStarted.addListener(
    (request) => {
      const { tabId } = request;
      const report = activityReports[tabId];
      if (report) {
        updateBadge(tabId, activityReports[tabId]);
      }
    },
    { urls: ['<all_urls>'], types: ['main_frame'] },
  );

  // Analyzes all the html documents and external scripts as they're loaded
  ResponseProcessor.install(ResponseHandler);

  legacy_license_lib.init();

  const Test = require('./common/Test');
  if (Test.getURL()) {
    // export testable functions to the global scope
    this.LibreJS = {
      editHtml,
      handle_script,
      ExternalLicenses,
      ListManager,
      ListStore,
      Storage: StorageWrapper,
    };
    // create or focus the autotest tab if it's a debugging session
    if ((await browser.management.getSelf()).installType === 'development') {
      Test.getTab(true);
    }
  }
}

/**
 *	Loads the contact finder on the given tab ID.
 */
async function injectContactFinder(tabId?: number) {
  await Promise.all([
    browser.tabs.insertCSS(tabId, { file: '/content/overlay.css', cssOrigin: 'user' }),
    browser.tabs.executeScript(tabId, { file: '/content/contactFinder.js' }),
  ]);
}

void init_addon();
