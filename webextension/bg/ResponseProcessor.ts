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

/**
  An abstraction layer over the StreamFilter API, allowing its clients to process
  only the "interesting" HTML and script requests and leaving the other alone
*/

const { ResponseMetaData } = require('./ResponseMetaData');

const listeners = new WeakMap();
const webRequestEvent = browser.webRequest.onHeadersReceived;

class ResponseProcessor {
  static ACCEPT: any;

  static install(
    handler: any,
    types: browser.webRequest.ResourceType[] = ['main_frame', 'sub_frame', 'script'],
  ): boolean {
    if (listeners.has(handler)) return false;
    const listener = async (request: any) => await new ResponseTextFilter(request).process(handler);
    listeners.set(handler, listener);
    void webRequestEvent.addListener(listener, { urls: ['<all_urls>'], types }, ['blocking', 'responseHeaders']);
    return true;
  }

  static uninstall(handler: any): void {
    const listener = listeners.get(handler);
    if (listener) {
      webRequestEvent.removeListener(listener);
    }
  }
}

Object.assign(ResponseProcessor, {
  // control flow values to be returned by handler.pre() callbacks
  ACCEPT: {},
  REJECT: { cancel: true },
  CONTINUE: null,
});

class ResponseTextFilter {
  request: any;
  metaData: any;
  canProcess: boolean;

  constructor(request: { type: any; statusCode: any }) {
    this.request = request;
    const { type, statusCode } = request;
    const md = (this.metaData = new ResponseMetaData(request));
    this.canProcess = // we want to process html documents and scripts only
      (statusCode < 300 || statusCode >= 400) && // skip redirections
      !md.disposition && // skip forced downloads
      (type === 'script' || /\bhtml\b/i.test(md.contentType));
  }

  async process(handler: any) {
    if (!this.canProcess) return ResponseProcessor.ACCEPT;
    const { metaData, request } = this;
    const response: any = { request, metaData }; // we keep it around allowing callbacks to store state
    if (typeof handler.pre === 'function') {
      const res = await handler.pre(response);
      if (res) return res;
      if (handler.post) handler = handler.post;
      if (typeof handler !== 'function') return ResponseProcessor.ACCEPT;
    }

    const { requestId, responseHeaders } = request;
    const filter = browser.webRequest.filterResponseData(requestId);
    let buffer = [];

    filter.ondata = (event) => {
      buffer.push(event.data);
    };

    filter.onstop = async () => {
      // concatenate chunks
      const size = buffer.reduce((sum, chunk) => sum + chunk.byteLength, 0);
      let allBytes = new Uint8Array(size);
      let pos = 0;
      for (const chunk of buffer) {
        allBytes.set(new Uint8Array(chunk), pos);
        pos += chunk.byteLength;
      }
      buffer = null; // allow garbage collection
      if (allBytes.indexOf(0) !== -1) {
        console.debug('Warning: zeroes in bytestream, probable cached encoding mismatch.', request);
        if (request.type === 'script') {
          console.debug("It's a script, trying to refetch it.");
          response.text = await (await fetch(request.url, { cache: 'reload', credentials: 'include' })).text();
        } else {
          console.debug("It's a %s, trying to decode it as UTF-16.", request.type);
          response.text = new TextDecoder('utf-16be').decode(allBytes, { stream: true });
        }
      } else {
        response.text = metaData.decode(allBytes);
      }
      let editedText = null;
      try {
        editedText = await handler(response);
      } catch (e) {
        console.error(e);
      }
      if (editedText !== null) {
        // we changed the content, let's re-encode
        const encoded = new TextEncoder().encode(editedText);
        // pre-pending the UTF-8 BOM will force the charset per HTML 5 specs
        allBytes = new Uint8Array(encoded.byteLength + 3);
        allBytes.set(ResponseMetaData.UTF8BOM, 0); // UTF-8 BOM
        allBytes.set(encoded, 3);
      }
      filter.write(allBytes);
      filter.close();
    };

    return ResponseProcessor.ACCEPT;
  }
}

export = { ResponseProcessor };
