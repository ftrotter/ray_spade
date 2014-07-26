ray_spade
=========

Ray's initial spade repo
The extension will initially open the options.html page and ask the user to generate a token
and optionally set the idle threshold time, and then save the settings.

At that point the extension is running and the when idle, will go through all the history and upload
and history items that meet the criteria:
nih.gov always do
wikipedi.org the page is opened and check for the clinical terms for a match

A JSON of all the pages that meet the criteria are then uploaded to http://spade.ft1.us/save_tree.php

The extension can be installed by dropping the .crx file into the Chrome browser on the extensions page: chrome://extensions.
The chrome://extensions page also allows you to package the extension files.

There is a demo video of it working here: http://youtu.be/msJLEN00yqk
