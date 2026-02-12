// Expect a project name
const PROJECT_NAME = process.argv[2];
if (!PROJECT_NAME) {
  console.error("Please provide a project name: node navigator/index.js  <project-name>");
  process.exit(1);
}

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Expect an API key
const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!API_KEY) {
  throw new Error('GOOGLE_MAPS_API_KEY not found in .env file!');
}

const PROJECT_DIR = path.resolve(__dirname, '../projects', PROJECT_NAME);
const IMAGES_DIR = path.join(PROJECT_DIR, 'images');
const ROUTE_FILE = path.join(PROJECT_DIR, 'route.json');
const STATE_FILE = path.join(PROJECT_DIR, 'navigator_state.json');

// Set up logging to stdout and the logfile
const { Signale } = require('signale');
const logFile = fs.createWriteStream(path.join(PROJECT_DIR, 'navigator.log'), { flags: 'a' });
const log = new Signale({
  stream: [process.stdout, logFile]
});
// Catch-all for Sync errors
process.on('uncaughtException', (err) => {
  log.fatal('Uncaught Exception:', err);
  process.exit(1);
});
// Catch-all for Async errors
process.on('unhandledRejection', (reason) => {
  log.fatal('Unhandled Rejection:', reason);
  process.exit(1);
});

// Expect a route file
if (!fs.existsSync(ROUTE_FILE)) {
  log.fatal(`route.json not found in project ${PROJECT_DIR}! Please export a route and place it there.`);
  process.exit(1);
}
const route = JSON.parse(fs.readFileSync(ROUTE_FILE, 'utf-8'));
log.info(`Loaded route with ${route.length} waypoints`);

// Ensure project and images directory exists
if (!fs.existsSync(IMAGES_DIR)) {
  log.info(`Creating images directory: ${IMAGES_DIR}`);
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

// Various defaults
const STEP_DELAY = parseInt(process.env.NAVIGATOR_STEP_DELAY || '5000', 10);
const WIDTH = parseInt(process.env.NAVIGATOR_WIDTH || '1920', 10);
const HEIGHT = parseInt(process.env.NAVIGATOR_HEIGHT || '1080', 10);
const MIN_IMAGE_YEAR = parseInt(process.env.NAVIGATOR_MIN_IMAGE_YEAR || '0', 10); // Filter out imagery older than this year
const PREFER_NEWEST = process.env.NAVIGATOR_PREFER_NEWEST === 'true'; // Use position-based lookup to get newest imagery
const MAX_IMAGE_AGE_MONTHS = parseInt(process.env.NAVIGATOR_MAX_IMAGE_AGE_MONTHS || '0', 10); // Check for newer imagery if current is older than N months (0 = disabled)

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    } catch (e) {
      console.warn('Warning: Could not parse state file. Starting from scratch.');
    }
  }
  return { "lastStep": 1 }
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
  log.info(`Saving state ${logState}`);
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

function getBestLink(links, targetBearing) {
  if (!links || links.length === 0) return null;
  let closestLink = null;
  let minDiff = 360;

  for (const link of links) {
    let diff = Math.abs(link.heading - targetBearing);
    if (diff > 180) diff = 360 - diff;

    // Threshold: Don't pick a link that is more than 90 degrees away from our target
    if (diff < minDiff && diff < 90) {
      minDiff = diff;
      closestLink = link;
    }
  }
  return closestLink;
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

  log.info(`Capturing pano ${position.pano} at ${position.lat}, ${position.lng}`)
  // Move mouse out of viewport to avoid cursor artifacts
  await page.mouse.move(0, 0);
  await page.waitForTimeout(500);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = path.join(IMAGES_DIR, `${timestamp}_${position.lat}_${position.lng}.jpg`);

  await page.screenshot({ path: filename, type: 'jpeg', quality: 90 });
  log.info(`📷 Captured: ${path.basename(filename)}${ageStr}`);
}

async function run() {

  // Persistence logic
  const state = loadState();
  startStep = state.lastStep;
  log.info(`Starting from step ${startStep}`);
  log.info(state);
  if (startStep >= route.length) {
    log.info('Already completed the route.');
    process.exit(0);
  }

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT }
  });

  // Forward browser logs to terminal and log file
  page.on('console', msg => log.info(`PAGE LOG: ${msg.text()}`));

  // Log failed requests with URLs
  page.on('requestfailed', request => {
    log.error(`FAILED REQUEST: ${request.url()} - ${request.failure().errorText}`);
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

  // Inject Google Maps API
  await page.addScriptTag({
    url: `https://maps.googleapis.com/maps/api/js?key=${API_KEY}`
  });

  // Wait for Maps API to load
  await page.waitForFunction(() => window.google && window.google.maps);
  log.info('Google Maps API loaded');

  // Initialize Panorama at start of route
  let startPoint = route[startStep - 1];
  let lastPano = null;

  if (state && state.lastStep === startStep) {
    log.info(`Using precise state from last run for point ${startStep}`);
    if (state.lastLat && state.lastLng) {
      startPoint = { lat: state.lastLat, lng: state.lastLng };
    }
    lastPano = state.lastPano;
  }

  const nextPoint = route[startStep];
  log.info(`Initializing at point ${startStep - 1}: ${startPoint.lat}, ${startPoint.lng} (Pano: ${lastPano || 'default'})`);
  log.info(`Targeting point ${startStep}: ${nextPoint.lat}, ${nextPoint.lng}`);
  if (PREFER_NEWEST) {
    log.info('Preferring newest imagery (using OUTDOOR source)');
  }
  if (MIN_IMAGE_YEAR > 0) {
    log.info(`Filtering imagery older than ${MIN_IMAGE_YEAR}`);
  }
  if (MAX_IMAGE_AGE_MONTHS > 0) {
    log.info(`Will check for newer imagery if current is older than ${MAX_IMAGE_AGE_MONTHS} months`);
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

  log.info(`Starting navigation - ${route.length - startStep} steps remaining`);

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
        log.error('Error: Lost panorama position. Retrying...');
        await page.waitForTimeout(1000);
        continue;
      }

      if (panoHistory.includes(currentPos.pano)) {
        log.warn(`LOOP DETECTION: Have been to pano ${currentPos.pano} before!`);
      }
      panoHistory.push(currentPos.pano);
      if (panoHistory.length > 10) panoHistory.shift();

      const target = route[routeIndex];
      const distToTarget = calculateDistance(currentPos.lat, currentPos.lng, target.lat, target.lng);
      const dateStr = (currentPos.imageDate && currentPos.imageDate.length >= 7) ? ` [${currentPos.imageDate.substring(0, 7)}]` : '';
      log.info(`Target ${routeIndex}/${route.length} - Dist: ${distToTarget.toFixed(1)}m (Pano: ${currentPos.pano}${dateStr})`);

      if (distToTarget < 25) { // Threshold for reaching a route point
        log.info(`✓ Reached target point ${routeIndex}`);
        routeIndex++;
        stuckCount = 0; // Reset stuck count when we advance target via proximity
        if (routeIndex >= route.length) break;
        // Re-evaluate immediately with next target
        continue;
      }

      targetBearing = calculateBearing(currentPos.lat, currentPos.lng, target.lat, target.lng);
      const links = await page.evaluate(() => getLinks());
      log.info(`Found ${links ? links.length : 0} available links`);
      bestLink = getBestLink(links, targetBearing);

      if (bestLink) break;

      if (attempt < 4) {
        log.info(`Waiting for connectivity at target ${routeIndex} (attempt ${attempt + 1})...`);
        await page.waitForTimeout(1000);
      }
    }

    if (routeIndex >= route.length) break;

    if (bestLink) {
      stuckCount = 0; // Reset stuck count because we found a valid movement
      log.info(`→ Moving to pano: ${bestLink.pano} (Heading: ${bestLink.heading.toFixed(1)}°, Target: ${targetBearing.toFixed(1)}°)`);
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
        log.warn(`WARNING: Panorama did not change after move! Still at ${postMovePos.pano}`);
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
          log.warn(`⏰ Backwards time jump detected: ${previousYearMonth} → ${currentYearMonth} (${Math.abs(daysDiff).toFixed(0)} days)`);
          log.warn(`🔄 Attempting to recover by searching for newer imagery at this location...`);

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
              log.info(`✓ Recovery successful! Found newer imagery: ${recoveredYearMonth}`);
              // Update postMovePos with recovered position
              Object.assign(postMovePos, recoveredPos);
              stepsSinceAgeCheck = 0; // Reset counter after successful recovery
            } else {
              log.warn(`Recovery found same or older imagery: ${recoveredYearMonth}`);
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
          log.warn(`📅 Old imagery detected: ${imageYearMonth} (${monthsDiff} months old, threshold: ${MAX_IMAGE_AGE_MONTHS})`);
          log.warn(`🔄 Checking for newer imagery at this location...`);

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
              log.info(`✓ Found newer imagery: ${recoveredYearMonth} (${recoveredMonthsDiff} months old)`);
              // Update postMovePos with recovered position
              Object.assign(postMovePos, recoveredPos);
            } else {
              log.warn(`No newer imagery available at this location (still ${recoveredYearMonth})`);
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
          log.warn(`Image too old: ${imageYear} < ${MIN_IMAGE_YEAR}, skipping...`);
          stuckCount++;
        }
      }

      // If stuck, stop
      if (stuckCount >= 3) {
        throw new Error("Stuck! Exiting...");
      }
    } else {
      stuckCount++;
      log.warn(`No suitable links found towards target ${routeIndex}. (Stuck count: ${stuckCount})`);

      if (stuckCount >= 2) {
        throw new Error("Stuck! Exiting...");
      } else {
        routeIndex++;
      }
    }
  }

  log.info.log('✓ Navigation complete!');
  // end logstream
}

run();