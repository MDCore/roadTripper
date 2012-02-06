/* --- Config ----------------------- */
var imagesDirectory = 'images';
var captureLog = 'capturelog.txt';
var lastPositionLog = 'lastposition.txt';
var logToDebug = false;
var secondsToWaitForPageToRenderBeforeRestarting = 30;
/* --- Config ----------------------- */

var fs = require('fs');
/* load the Debug and Capture Log files */
if (logToDebug) { var debug_file = fs.open('debug.txt', 'a'); }
var captureLog_file = fs.open(captureLog, 'a');

/* check that the log file exists */
if (!fs.exists(lastPositionLog)) {
  consoleAndFileLog('No last position saved. Please initialize the starting LatLongHeading in '+lastPositionLog);
  fs.touch(lastPositionLog);
  phantom.exit();
}

var page = setupPage(null);

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
  consoleAndFileLog('Viewport is loading');
};

page.onLoadFinished = function (status) {
  consoleAndFileLog('Viewport finished loading');
//debug
  //initialize('-34.143238,18.929973,312.9375'); }));phantom.exit();
  consoleAndFileLog('Setting starting coordinates to '+page.startLatLongHeading);
  var initFunction = "function() { var initResult = initialize('"+page.startLatLongHeading+"'); return initResult; }";
  var result = page.evaluate(initFunction);
  consoleAndFileLog('Viewport responded to initialize() with: '+result);
  if (result == null) {
    consoleAndFileLog("Null isn't a good response. Something went wrong. Sorry.");
    consoleAndFileLog("This was our init function, test it in the console of a webkit browser");
    consoleAndFileLog(initFunction);
    phantom.exit();
  }
  startWaitLoop();
};

var waitingForPanoLoadIntervalId = -1;
var restartTheProcessTimeoutId = -1;
function startWaitLoop() {
  if (outstandingRequests < 0 && !atLeastOneRequestReceived) { outstandingRequests = 0; }
  waitingForPanoLoadIntervalId = window.setInterval(function() {
  //console.log(atLeastOneRequestReceived);  console.log(outstandingRequests);
    if (atLeastOneRequestReceived && outstandingRequests == 0) {
      window.clearTimeout(restartTheProcessTimeoutId);
      window.clearInterval(waitingForPanoLoadIntervalId);
      consoleAndFileLog('finished loading tiles. Waiting a moment.'); /* Even though the tiles are downloaded, they are sometimes not rendered yet. This time can probably do with tweaking */

      window.setTimeout(function() {
        // log the current time and coordinates
        var currentPosition = page.evaluate(function() { return getCurrentPosition(); });
        if (currentPosition == null) {
          consoleAndFileLog("Hmm. The viewport returned null for currentPosition(). That's not good. We can't go on from here unfortunately.");
          phantom.exit();
        }

        /* save the newly loaded image */
        consoleAndFileLog('Saving image at '+currentPosition);
        page.render(imagesDirectory+fs.separator +friendlyTimestamp()+' '+currentPosition+'.jpg');

        /* log the current position */
        fs.write(lastPositionLog, currentPosition, 'w');

        /* reset state on our side */
        atLeastOneRequestReceived = false;

        consoleAndFileLog('moving on');
        page.evaluate(function() {
          moveToNextLink();
        });

        restartTheProcessTimeoutId = window.setTimeout(function() {
        consoleAndFileLog("Ooops. Looks like things got stuck. Let's restart.");
          window.clearTimeout(waitingForPanoLoadIntervalId);
          atLeastOneRequestReceived = false;
          outstandingRequests = 0;
          page = setupPage(page);
        }, secondsToWaitForPageToRenderBeforeRestarting*1000);
        // let's do it again
        startWaitLoop();
      }, 1000);

    }
  }, 100);
}


function setupPage(current_page) {

  /* Set up the page and viewport */
  if (current_page == null) {
    var page = require('webpage').create();
    page.viewportSize = { width: 1920, height: 1080 };
  } else {
    var page = current_page;
  }
  consoleAndFileLog('Loading viewport source');
  var viewport = fs.read('viewport.html');
  consoleAndFileLog('Attaching source');
  page.content = viewport;
  consoleAndFileLog('Source attached');

  /* load the current position from the last position log */
  var lastPositionLog_file = fs.open(lastPositionLog, 'r');
  page.startLatLongHeading = lastPositionLog_file.readLine(lastPositionLog); /* we only want the first line. This takes care of the case of the spurious newline */
  if (page.startLatLongHeading == '' | page.startLatLongHeading == null) {
    consoleAndFileLog('No last position saved. Please initialize the starting LatLong');
    phantom.exit();
    page.startLatLongHeading.trim();
  }

  return page;
}

/* --- helper functions ------------------------ */
function consoleAndFileLog(message) {
  message = friendlyTimestamp()+' '+message;
  console.log(message);
  captureLog_file.writeLine(message);
  captureLog_file.flush();
}
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