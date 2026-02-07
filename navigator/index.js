const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const PROJECT_NAME = process.argv[2];

if (!PROJECT_NAME) {
  console.error('Please provide a project name: node navigator/index.js <project-name>');
  process.exit(1);
}

const PROJECT_DIR = path.resolve(__dirname, '../projects', PROJECT_NAME);
const IMAGES_DIR = path.join(PROJECT_DIR, 'images');
const ROUTE_FILE = path.join(PROJECT_DIR, 'route.json');
const STATE_FILE = path.join(PROJECT_DIR, 'navigator_state.json');
const LOG_FILE = path.join(PROJECT_DIR, 'navigator.log');
const VIEWPORT_FILE = `file://${path.resolve(__dirname, 'viewport.html')}`;

const STEP_DELAY = parseInt(process.env.NAVIGATOR_STEP_DELAY || '5000', 10);
const WIDTH = parseInt(process.env.NAVIGATOR_WIDTH || '1920', 10);
const HEIGHT = parseInt(process.env.NAVIGATOR_HEIGHT || '1080', 10);
const MIN_IMAGE_YEAR = parseInt(process.env.NAVIGATOR_MIN_IMAGE_YEAR || '0', 10); // Filter out imagery older than this year
const PREFER_NEWEST = process.env.NAVIGATOR_PREFER_NEWEST === 'true'; // Use position-based lookup to get newest imagery
const MAX_IMAGE_AGE_MONTHS = parseInt(process.env.NAVIGATOR_MAX_IMAGE_AGE_MONTHS || '0', 10); // Check for newer imagery if current is older than N months (0 = disabled)

// Create log stream
let logStream;
function initLog() {
  logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
  const timestamp = new Date().toISOString();
  logStream.write(`\n\n=== Navigator started at ${timestamp} ===\n`);
}

// Log function that writes to both console and file
function log(message) {
  console.log(message);
  if (logStream) {
    const timestamp = new Date().toISOString();
    logStream.write(`[${timestamp}] ${message}\n`);
  }
}

function logError(message) {
  console.error(message);
  if (logStream) {
    const timestamp = new Date().toISOString();
    logStream.write(`[${timestamp}] ERROR: ${message}\n`);
  }
}

function logWarn(message) {
  console.warn(message);
  if (logStream) {
    const timestamp = new Date().toISOString();
    logStream.write(`[${timestamp}] WARN: ${message}\n`);
  }
}

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    } catch (e) {
      console.warn('Warning: Could not parse state file. Starting from scratch.');
    }
  }
  return null;
}

function saveState(index, currentPos) {
  if (!fs.existsSync(PROJECT_DIR)) {
    fs.mkdirSync(PROJECT_DIR, { recursive: true });
  }
  const logState = JSON.stringify({
    lastStep: index,
    lastPano: currentPos.pano,
    lastLat: currentPos.lat,
    lastLng: currentPos.lng
  });
  log(`Saving state ${logState}`);
  fs.writeFileSync(STATE_FILE, JSON.stringify({
    lastStep: index,
    lastPano: currentPos.pano,
    lastLat: currentPos.lat,
    lastLng: currentPos.lng
  }, null, 2));
}

function calculateBearing(lat1, lon1, lat2, lon2) {
  const y = Math.sin((lon2 - lon1) * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180);
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
    Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos((lon2 - lon1) * Math.PI / 180);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // metres
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const dPhi = (lat2 - lat1) * Math.PI / 180;
  const dLambda = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) *
    Math.sin(dLambda / 2) * Math.sin(dLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

function getBestLink(links, targetBearing, relaxBearing = false) {
  if (!links || links.length === 0) return null;
  let closestLink = null;
  let minDiff = 360;

  for (const link of links) {
    let diff = Math.abs(link.heading - targetBearing);
    if (diff > 180) diff = 360 - diff;

    // Threshold: Don't pick a link that is more than 90 degrees away from our target
    const threshold = relaxBearing ? 135 : 90;
    if (diff < minDiff && diff < threshold) {
      minDiff = diff;
      closestLink = link;
    }
  }
  return closestLink;
}

// Calculate an intermediate point between current position and target
function getIntermediatePoint(lat1, lon1, lat2, lon2, distanceMeters) {
  const totalDistance = calculateDistance(lat1, lon1, lat2, lon2);
  if (totalDistance <= distanceMeters) {
    return { lat: lat2, lng: lon2 }; // Target is closer than intermediate distance
  }

  const fraction = distanceMeters / totalDistance;
  const lat = lat1 + (lat2 - lat1) * fraction;
  const lng = lon1 + (lon2 - lon1) * fraction;
  return { lat, lng };
}

async function captureScreenshot(page, position) {
  // Log image date/age if available
  let ageStr = ' [unknown]';
  if (position.imageDate) {
    const imageDate = new Date(position.imageDate);
    const imageYear = imageDate.getFullYear();
    const imageMonth = imageDate.getMonth() + 1;
    ageStr = ` [${imageYear}-${String(imageMonth).padStart(2, '0')}]`;
  }

  log(`Capturing pano ${position.pano} at ${position.lat}, ${position.lng}`)
  // Move mouse out of viewport to avoid cursor artifacts
  await page.mouse.move(0, 0);
  await page.waitForTimeout(500);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = path.join(IMAGES_DIR, `${timestamp}_${position.lat}_${position.lng}.jpg`);

  await page.screenshot({ path: filename, type: 'jpeg', quality: 90 });
  log(`📷 Captured: ${path.basename(filename)}${ageStr}`);
}

async function run() {
  initLog();

  if (!fs.existsSync(ROUTE_FILE)) {
    logError(`route.json not found in ${PROJECT_DIR}! Please export a route and place it there.`);
    process.exit(1);
  }

  // Ensure project and images directory exists
  if (!fs.existsSync(IMAGES_DIR)) {
    log(`Creating images directory: ${IMAGES_DIR}`);
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
  }

  const route = JSON.parse(fs.readFileSync(ROUTE_FILE, 'utf-8'));
  log(`Loaded route with ${route.length} waypoints`);

  // Persistence logic
  const state = loadState();
  let startStep = 1;

  if (process.env.NAVIGATOR_START_INDEX) {
    startStep = parseInt(process.env.NAVIGATOR_START_INDEX, 10);
    log(`Manual override: starting at index ${startStep}`);
  } else if (state && state.lastStep !== undefined) {
    startStep = state.lastStep;
    log(`Resuming from last saved index: starting at ${startStep}`);
  }

  if (startStep >= route.length) {
    log('Already completed the route.');
    process.exit(0);
  }

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT }
  });

  // Forward browser logs to terminal and log file
  page.on('console', msg => log(`PAGE LOG: ${msg.text()}`));

  // Log failed requests with URLs
  page.on('requestfailed', request => {
    logError(`FAILED REQUEST: ${request.url()} - ${request.failure().errorText}`);
  });

  // Serve viewport.html over http://localhost to avoid file:// referer issues
  await page.route('http://localhost:3000/', route => {
    const html = fs.readFileSync(path.resolve(__dirname, 'viewport.html'), 'utf-8');
    route.fulfill({
      contentType: 'text/html',
      body: html
    });
  });

  await page.goto('http://localhost:3000/');

  if (!API_KEY) {
    logError('GOOGLE_MAPS_API_KEY not found in .env file!');
    process.exit(1);
  }

  // Inject Google Maps API
  await page.addScriptTag({
    url: `https://maps.googleapis.com/maps/api/js?key=${API_KEY}`
  });

  // Wait for Maps API to load
  await page.waitForFunction(() => window.google && window.google.maps);
  log('Google Maps API loaded');

  // Initialize Panorama at start of route
  let startPoint = route[startStep - 1];
  let lastPano = null;

  if (state && state.lastStep === startStep) {
    log(`Using precise state from last run for point ${startStep}`);
    if (state.lastLat && state.lastLng) {
      startPoint = { lat: state.lastLat, lng: state.lastLng };
    }
    lastPano = state.lastPano;
  }

  const nextPoint = route[startStep];
  log(`Initializing at point ${startStep - 1}: ${startPoint.lat}, ${startPoint.lng} (Pano: ${lastPano || 'default'})`);
  log(`Targeting point ${startStep}: ${nextPoint.lat}, ${nextPoint.lng}`);
  if (PREFER_NEWEST) {
    log('Preferring newest imagery (using OUTDOOR source)');
  }
  if (MIN_IMAGE_YEAR > 0) {
    log(`Filtering imagery older than ${MIN_IMAGE_YEAR}`);
  }
  if (MAX_IMAGE_AGE_MONTHS > 0) {
    log(`Will check for newer imagery if current is older than ${MAX_IMAGE_AGE_MONTHS} months`);
  }

  const initialBearing = nextPoint ? calculateBearing(startPoint.lat, startPoint.lng, nextPoint.lat, nextPoint.lng) : 0;
  await page.evaluate(({ lat, lng, heading, panoId, preferNewest }) => initPanorama(lat, lng, heading, panoId, preferNewest),
    { ...startPoint, heading: initialBearing, panoId: lastPano, preferNewest: PREFER_NEWEST });

  // Wait for panorama and connectivity to be ready
  await page.waitForFunction(() =>
    typeof panorama !== 'undefined' &&
    panorama.getPosition() &&
    panorama.getLinks() &&
    panorama.getLinks().length > 0
  );

  log(`Starting navigation - ${route.length - startStep} steps remaining`);

  // Capture screenshot of starting position
  const startPos = await page.evaluate(() => getPositionWithMetadata());
  if (startPos) {
    await captureScreenshot(page, startPos);
    //saveState(routeIndex, startPos);
  }

  // Navigation Loop
  let routeIndex = startStep;
  let panoHistory = [];
  let stuckCount = 0; // Track how many times we've skipped without moving
  let lastImageDate = null; // Track image date to detect backwards jumps
  let stepsSinceAgeCheck = 0; // Track steps since last age check to avoid checking too frequently

  while (routeIndex < route.length) {
    let bestLink = null;
    let targetBearing = 0;
    let currentPos = null;

    // Retry loop to wait for links to load
    for (let attempt = 0; attempt < 5; attempt++) {
      currentPos = await page.evaluate(() => getPosition());
      if (!currentPos) {
        logError('Error: Lost panorama position. Retrying...');
        await page.waitForTimeout(1000);
        continue;
      }

      if (panoHistory.includes(currentPos.pano)) {
        logWarn(`LOOP DETECTION: Have been to pano ${currentPos.pano} before!`);
      }
      panoHistory.push(currentPos.pano);
      if (panoHistory.length > 10) panoHistory.shift();

      const target = route[routeIndex];
      const distToTarget = calculateDistance(currentPos.lat, currentPos.lng, target.lat, target.lng);
      const dateStr = (currentPos.imageDate && currentPos.imageDate.length >= 7) ? ` [${currentPos.imageDate.substring(0, 7)}]` : '';
      log(`Target ${routeIndex}/${route.length} - Dist: ${distToTarget.toFixed(1)}m (Pano: ${currentPos.pano}${dateStr})`);

      if (distToTarget < 25) { // Threshold for reaching a route point
        log(`✓ Reached target point ${routeIndex}`);
        routeIndex++;
        stuckCount = 0; // Reset stuck count when we advance target via proximity
        if (routeIndex >= route.length) break;
        // Re-evaluate immediately with next target
        continue;
      }

      targetBearing = calculateBearing(currentPos.lat, currentPos.lng, target.lat, target.lng);
      const links = await page.evaluate(() => getLinks());
      log(`Found ${links ? links.length : 0} available links`);
      relaxBearing = false;
      bestLink = getBestLink(links, targetBearing, relaxBearing);

      if (bestLink) break;

      if (attempt < 4) {
        log(`Waiting for connectivity at target ${routeIndex} (attempt ${attempt + 1})...`);
        await page.waitForTimeout(1000);
      }
    }

    if (routeIndex >= route.length) break;

    if (bestLink) {
      stuckCount = 0; // Reset stuck count because we found a valid movement
      log(`→ Moving to pano: ${bestLink.pano} (Heading: ${bestLink.heading.toFixed(1)}°, Target: ${targetBearing.toFixed(1)}°)`);
      // Use the link's heading for the POV so we face exactly where we are moving
      // but still move towards the targetBearing
      await page.evaluate(({ panoId, heading }) => moveToPano(panoId, heading), {
        panoId: bestLink.pano,
        heading: bestLink.heading
      });

      // Wait for network to be idle (tiles loaded)
      await page.waitForLoadState('networkidle');
      // Additional safety wait
      await page.waitForTimeout(STEP_DELAY);

      const postMovePos = await page.evaluate(() => getPositionWithMetadata());
      if (postMovePos.pano === currentPos.pano) {
        logWarn(`WARNING: Panorama did not change after move! Still at ${postMovePos.pano}`);
        stuckCount++; // Increment stuck count when panorama doesn't change
      }

      // Detect backwards time jump and attempt recovery
      if (PREFER_NEWEST && postMovePos.imageDate && lastImageDate) {
        const currentDate = new Date(postMovePos.imageDate);
        const previousDate = new Date(lastImageDate);

        // If we've jumped backwards by more than 30 days, try to recover
        const daysDiff = (currentDate - previousDate) / (1000 * 60 * 60 * 24);
        if (daysDiff < -30) {
          const currentYearMonth = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
          const previousYearMonth = `${previousDate.getFullYear()}-${String(previousDate.getMonth() + 1).padStart(2, '0')}`;
          logWarn(`⏰ Backwards time jump detected: ${previousYearMonth} → ${currentYearMonth} (${Math.abs(daysDiff).toFixed(0)} days)`);
          logWarn(`🔄 Attempting to recover by searching for newer imagery at this location...`);

          // Reinitialize at current position to let Google find newest imagery
          const bearing = calculateBearing(postMovePos.lat, postMovePos.lng, route[routeIndex].lat, route[routeIndex].lng);
          await page.evaluate(({ lat, lng, heading, preferNewest }) => initPanorama(lat, lng, heading, null, preferNewest),
            { lat: postMovePos.lat, lng: postMovePos.lng, heading: bearing, preferNewest: true });
          await page.waitForTimeout(STEP_DELAY);

          // Check if we found newer imagery
          const recoveredPos = await page.evaluate(() => getPositionWithMetadata());
          if (recoveredPos.imageDate) {
            const recoveredDate = new Date(recoveredPos.imageDate);
            const recoveredYearMonth = `${recoveredDate.getFullYear()}-${String(recoveredDate.getMonth() + 1).padStart(2, '0')}`;
            if (recoveredDate > currentDate) {
              log(`✓ Recovery successful! Found newer imagery: ${recoveredYearMonth}`);
              // Update postMovePos with recovered position
              Object.assign(postMovePos, recoveredPos);
              stepsSinceAgeCheck = 0; // Reset counter after successful recovery
            } else {
              logWarn(`Recovery found same or older imagery: ${recoveredYearMonth}`);
            }
          }
        }
      }

      // Check if imagery is too old based on absolute age (not just relative jumps)
      stepsSinceAgeCheck++;
      if (PREFER_NEWEST && MAX_IMAGE_AGE_MONTHS > 0 && postMovePos.imageDate && stepsSinceAgeCheck >= 3) {
        const now = new Date();
        const imageDate = new Date(postMovePos.imageDate);
        const monthsDiff = (now.getFullYear() - imageDate.getFullYear()) * 12 + (now.getMonth() - imageDate.getMonth());

        if (monthsDiff > MAX_IMAGE_AGE_MONTHS) {
          const imageYearMonth = `${imageDate.getFullYear()}-${String(imageDate.getMonth() + 1).padStart(2, '0')}`;
          logWarn(`📅 Old imagery detected: ${imageYearMonth} (${monthsDiff} months old, threshold: ${MAX_IMAGE_AGE_MONTHS})`);
          logWarn(`🔄 Checking for newer imagery at this location...`);

          // Reinitialize at current position to let Google find newest imagery
          const bearing = calculateBearing(postMovePos.lat, postMovePos.lng, route[routeIndex].lat, route[routeIndex].lng);
          await page.evaluate(({ lat, lng, heading, preferNewest }) => initPanorama(lat, lng, heading, null, preferNewest),
            { lat: postMovePos.lat, lng: postMovePos.lng, heading: bearing, preferNewest: true });
          await page.waitForTimeout(STEP_DELAY);

          // Check if we found newer imagery
          const recoveredPos = await page.evaluate(() => getPositionWithMetadata());
          if (recoveredPos.imageDate) {
            const recoveredDate = new Date(recoveredPos.imageDate);
            const recoveredYearMonth = `${recoveredDate.getFullYear()}-${String(recoveredDate.getMonth() + 1).padStart(2, '0')}`;
            const recoveredMonthsDiff = (now.getFullYear() - recoveredDate.getFullYear()) * 12 + (now.getMonth() - recoveredDate.getMonth());

            if (recoveredDate > imageDate) {
              log(`✓ Found newer imagery: ${recoveredYearMonth} (${recoveredMonthsDiff} months old)`);
              // Update postMovePos with recovered position
              Object.assign(postMovePos, recoveredPos);
            } else {
              logWarn(`No newer imagery available at this location (still ${recoveredYearMonth})`);
            }
          }

          stepsSinceAgeCheck = 0; // Reset counter after checking
        }
      }

      // Update last image date for next comparison
      if (postMovePos.imageDate) {
        lastImageDate = postMovePos.imageDate;
      }

      await captureScreenshot(page, postMovePos);
      saveState(routeIndex, postMovePos);

      // Check if imagery is too old
      if (MIN_IMAGE_YEAR > 0 && postMovePos.imageDate) {
        const imageYear = new Date(postMovePos.imageDate).getFullYear();
        if (imageYear < MIN_IMAGE_YEAR) {
          logWarn(`Image too old: ${imageYear} < ${MIN_IMAGE_YEAR}, skipping...`);
          stuckCount++;
        }
      }

      // If stuck, try jumping ahead incrementally before skipping to next waypoint
      if (stuckCount >= 3) {
        const fullTarget = route[routeIndex];
        const distToTarget = calculateDistance(postMovePos.lat, postMovePos.lng, fullTarget.lat, fullTarget.lng);

        // Try jumping 150m ahead first (like clicking ahead on the map)
        if (distToTarget > 150) {
          const intermediatePoint = getIntermediatePoint(postMovePos.lat, postMovePos.lng, fullTarget.lat, fullTarget.lng, 150);
          log(`⚡ STUCK: Trying intermediate jump ~150m ahead: ${intermediatePoint.lat}, ${intermediatePoint.lng}`);
          const bearing = calculateBearing(postMovePos.lat, postMovePos.lng, fullTarget.lat, fullTarget.lng);
          await page.evaluate(({ lat, lng, heading, preferNewest }) => initPanorama(lat, lng, heading, null, preferNewest),
            { ...intermediatePoint, heading: bearing, preferNewest: PREFER_NEWEST });
          await page.waitForTimeout(STEP_DELAY);
          stuckCount = 0; // Reset and try to continue from here
        } else {
          // Target is close, jump directly to it
          log(`🚀 STUCK: Teleporting to next route point: ${fullTarget.lat}, ${fullTarget.lng}`);
          const bearing = calculateBearing(postMovePos.lat, postMovePos.lng, fullTarget.lat, fullTarget.lng);
          await page.evaluate(({ lat, lng, heading, preferNewest }) => initPanorama(lat, lng, heading, null, preferNewest),
            { ...fullTarget, heading: bearing, preferNewest: PREFER_NEWEST });
          await page.waitForTimeout(STEP_DELAY);
          stuckCount = 0;
          routeIndex++;
        }
      }
    } else {
      stuckCount++;
      logWarn(`No suitable links found towards target ${routeIndex}. (Stuck count: ${stuckCount})`);

      if (stuckCount >= 2) {
        const fullTarget = route[routeIndex];
        const distToTarget = calculateDistance(currentPos.lat, currentPos.lng, fullTarget.lat, fullTarget.lng);

        // Try jumping 150m ahead first (like clicking ahead on the map)
        if (distToTarget > 150) {
          const intermediatePoint = getIntermediatePoint(currentPos.lat, currentPos.lng, fullTarget.lat, fullTarget.lng, 150);
          log(`⚡ STUCK: Trying intermediate jump ~150m ahead: ${intermediatePoint.lat}, ${intermediatePoint.lng}`);
          const bearing = calculateBearing(currentPos.lat, currentPos.lng, fullTarget.lat, fullTarget.lng);
          await page.evaluate(({ lat, lng, heading, preferNewest }) => initPanorama(lat, lng, heading, null, preferNewest),
            { ...intermediatePoint, heading: bearing, preferNewest: PREFER_NEWEST });
          await page.waitForTimeout(STEP_DELAY);
          stuckCount = 0; // Reset and try to continue from here
          // Don't increment routeIndex - keep trying for same target
        } else {
          // Target is close, jump directly to it
          log(`🚀 STUCK: Teleporting to next route point: ${fullTarget.lat}, ${fullTarget.lng}`);
          const bearing = calculateBearing(currentPos.lat, currentPos.lng, fullTarget.lat, fullTarget.lng);
          await page.evaluate(({ lat, lng, heading, preferNewest }) => initPanorama(lat, lng, heading, null, preferNewest),
            { ...fullTarget, heading: bearing, preferNewest: PREFER_NEWEST });
          await page.waitForTimeout(STEP_DELAY);
          stuckCount = 0;
          routeIndex++;
        }
      } else {
        routeIndex++;
      }
    }
  }

  log('✓ Navigation complete!');
  if (logStream) {
    logStream.end();
  }
}

run().catch(err => {
  logError(`Fatal error: ${err.message}`);
  if (logStream) {
    logStream.end();
  }
  process.exit(1);
});