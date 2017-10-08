# LibreJS-webex

Porting LibreJS to webExtensions 

It is lacking some license information for the assets from the original LibreJS. Not sure what license should be used for the new source files either. Also, we probably want to sort out the licenses for the dependencies (Acorn Javascript parser and jsSHA) to make sure they are cited correctly. 

TO BUILD: 

First, you need to get some stuff with npm:

npm install acorn
npm install jssha
npm install browserify

To build the extension run this:

browserify main_background.js -o bundle.js

To debug this add-on on Firefox or Icecat, go to the special URL "about:debugging", enable add-on debugging load the manifest.json. 

Chrome should work eventually but I haven't tested it lately. To debug the add-on on Chrome it's basically the same except you load it from "chrome://extensions" 

Mailing list: bug-librejs@gnu.org
