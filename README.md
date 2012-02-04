# Street View Time-lapse

A script which navigates across Street View links and takes dated screenshots. For making time-lapses!

## Requirements
PhantomJS (http://code.google.com/p/phantomjs/)

## USAGE
* create lastposition.txt and add a Latitude,Longitude,Heading e.g.: -34.143238,18.929973,312.9375
* from the command line run: phantomjs roadTripper.js
* images will be saved to the images folder

# CAVEATS
It's clunky and error-prone. You will find you have to go back and re-capture images which means manually editing lastposition.
It will also get lost. This is originally designed to go along a national highway, without detours.

# PLANNED FEATURES
* Use Google Directions API to follow a route (no more geting lost).
* A tool for easily re-capturing bad images.

## LICENSE
Street View Time-lapse's source code is licensed under the
[GNU General Public License](http://www.gnu.org/licenses/gpl.html).
