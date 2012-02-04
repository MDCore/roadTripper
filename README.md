# roadTripper
A script which navigates across Street View links and takes date stamped screenshots for making time-lapses!

## Requirements
PhantomJS (http://code.google.com/p/phantomjs/)

## USAGE
* create `lastposition.txt` and add a Latitude,Longitude,Heading e.g.: `-34.143238,18.929973,312.9375`
* from the command line run: `phantomjs roadTripper.js`

* images will be saved to the configured images folder, default `images`  in the current folder
* the time and position of each image will be logged in the configured capturelog file, default `capturelog.txt`

# CAVEATS
It's clunky and error-prone. You will find you have to go back and re-capture images which means manually editing lastposition.
It will also get lost. This is originally designed to go along a national highway, without detours.

# PLANNED FEATURES
* Use Google Directions API to follow a route (no more geting lost).
* A tool for easily re-capturing bad images.

## LICENSE
roadTripper's source code is licensed under the
[GNU General Public License](http://www.gnu.org/licenses/gpl.html).
