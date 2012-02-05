/* --- Config ----------------------- */
var imagesDirectory = 'images';
var captureLog = 'capturelog.txt';
var lastPositionLog = 'lastposition.txt';
var logToDebug = false;
/* --- Config ----------------------- */

var fs = require('fs');
/* check that the log file exists */
if (!fs.exists(lastPositionLog)) {
  console.log('No last position saved. Please initialize the starting LatLongHeading in '+lastPositionLog);
  fs.touch(lastPositionLog);
  phantom.exit();
}
/* load the current position from the last position log */
var lastPositionLog_file = fs.open(lastPositionLog, 'r');
var startLatLongHeading = lastPositionLog_file.readLine(lastPositionLog); /* we only want the first line. This takes care of the case of the spurious newline */
if (startLatLongHeading == '' | startLatLongHeading == null) {
  console.log('No last position saved. Please initialize the starting LatLong');
  phantom.exit();
  startLatLongHeading.trim();
}

/* load the debug file */
if (logToDebug) { var debug_file = fs.open('debug.txt', 'a'); }

/*load the capture log file */
var captureLog_file = fs.open(captureLog, 'a');

/* Set up the page and viewport */
var page = require('webpage').create();
page.viewportSize = { width: 1920, height: 1080 };
console.log('Loading viewport source');
var viewport = fs.read('viewport.html');
console.log('Attaching source');
page.content = viewport;
console.log('Source attached');

atLeastOneRequestReceived = false;
var outstandingRequests = 0;

var tileRequestSnippet = "googleapis.com/cbk?output=tile";
page.onResourceRequested = function (request) {
//console.log(request.url.indexOf(tileRequestSnippet) +' ' + request.url);
	if (request.url.indexOf(tileRequestSnippet) > 0) {
	  atLeastOneRequestReceived = true;
	  outstandingRequests++;
	  //debug('Request: ' + JSON.stringify(request, undefined, 4));
	  debug('Request: ('+outstandingRequests+'): '+request.status+' '+request.url);
	}
};
page.onResourceReceived = function (response) {
//console.log(response.url.indexOf(tileRequestSnippet) +' ' + response.url);
	if (response.url.indexOf(tileRequestSnippet) > 0 && response.stage == 'end') {
	  outstandingRequests--;
	  //debug('Response: ' + JSON.stringify(response, undefined, 4));
      debug('Response: ('+outstandingRequests+'): '+response.status+' '+response.url);
	}
};

page.onLoadStarted = function () {
    console.log('Viewport is loading');
};

page.onLoadFinished = function (status) {
  console.log('Viewport finished loading');
//debug
  //initialize('-34.143238,18.929973,312.9375'); }));phantom.exit();
  console.log('Setting starting coordinates to '+startLatLongHeading);
  var initFunction = "function() { var initResult = initialize('"+startLatLongHeading+"'); return initResult; }";
  var result = page.evaluate(initFunction);
  console.log('Viewport responded to initialize() with: '+result);
  if (result == null) {
    console.log("Null isn't a good response. Something went wrong. Sorry.");
    console.log("This was our init function, test it in the console of a webkit browser");
    console.log(initFunction);
    phantom.exit();
  }
  startWaitLoop();
};

var waitingForPanoLoadIntervalId = -1;
function startWaitLoop() {
  waitingForPanoLoadIntervalId = window.setInterval(function() {
    if (atLeastOneRequestReceived && outstandingRequests == 0) {
      window.clearInterval(waitingForPanoLoadIntervalId);
      console.log('finished loading tiles. Waiting a moment.'); /* Even though the tiles are downloaded, they are sometimes not rendered yet. This time can probably do with tweaking */

      window.setTimeout(function() {
        // log the current time and coordinates
        var currentPosition = page.evaluate(function() { return getCurrentPosition(); });
        if (currentPosition == null) {
          console.log("Hmm. The viewport returned null for currentPosition(). That's not good. We can't go on from here unfortunately.");
          phantom.exit();
        }

        var timestamp = friendlyTimestamp();

        // save the newly loaded image
        console.log('Saving image at '+currentPosition);
        page.render(imagesDirectory+fs.separator +timestamp+' '+currentPosition+'.jpg');

	/* log the time and position of this capture */
        captureLog_file.writeLine(timestamp+' '+currentPosition);
        captureLog_file.flush();
	/* log the current position */
        fs.write(lastPositionLog, currentPosition, 'w');

        /* reset state on our side */
        atLeastOneRequestReceived = false;

        console.log('moving on');
        page.evaluate(function() {
          moveToNextLink();
        });

        // let's do it again
        startWaitLoop();
      }, 1000);

    }
  }, 100);
}

/* --- helper functions ------------------------ */
function debug(string) {
  if (logToDebug) {
    debug_file.writeLine(friendlyTimestamp()+' '+string);
    debug_file.flush();
  }
}
function friendlyTimestamp() {
  var d = new Date();

  var year = d.getFullYear();
  var month = pad(d.getMonth() + 1); //months are zero based
  var day = pad(d.getDate());
  var hour = pad(d.getHours());
  var minute = pad(d.getMinutes());
  var second = pad(d.getSeconds());

  return (year+'-'+month+'-'+day+' '+hour+'-'+minute+'-'+second);
}
function pad(n) {
    return (n < 10 && n >=0) ? ("0" + n) : n;
}