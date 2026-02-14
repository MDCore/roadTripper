import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv'; dotenv.config();
import signale from 'signale'; const { Signale } = signale;
import { calculateBearing, calculateDistance, getBestLink, loadState, saveState } from './lib.js';
import { fileURLToPath } from 'url';

// Global variables (initialized in main or used by helpers)
let log = new Signale({ disabled: true }); // Default to silent for tests
let PROJECT_DIR, IMAGES_DIR, ROUTE_FILE, STATE_FILE, WIDTH, HEIGHT, STEP_DELAY, MIN_IMAGE_YEAR, MAX_IMAGE_AGE_MONTHS;


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

// ------------------------------------------

async function setupPage() {
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
    const html = fs.readFileSync('./navigator/viewport.html', 'utf-8');
    route.fulfill({
      contentType: 'text/html',
      body: html
    });
  });

  await page.goto('http://localhost:3000/');

  const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
  // Inject Google Maps API
  await page.addScriptTag({
    url: `https://maps.googleapis.com/maps/api/js?key=${API_KEY}`
  });

  // Wait for Maps API to load
  await page.waitForFunction(() => window.google && window.google.maps);
  log.info('Google Maps API loaded');

  return page;
}

async function waitForStablePanorama(page) {
  await page.waitForFunction(() => {
    return getPosition() && getLinks() && getLinks().length > 0;
  }, null, { timeout: 15000 });

  return {
    currentPos: await page.evaluate(() => getPosition()),
    links: await page.evaluate(() => getLinks())
  };
}

async function run(route, state) {
  const page = await setupPage();

  log.info(`Starting from step ${state.lastStep}`);
  let startPoint = route[state.lastStep];
  let lastPano = state.lastPano;

  if (state.lastLat && state.lastLng) {
    startPoint = { lat: state.lastLat, lng: state.lastLng };
  }

  const nextPoint = route[state.lastStep + 1];
  log.info(`Initializing at point ${state.lastStep}: ${startPoint.lat}, ${startPoint.lng} (Pano: ${lastPano || 'default'})`);
  log.info(`Targeting point ${state.lastStep + 1}: ${nextPoint.lat}, ${nextPoint.lng}`);

  // Load the starting panorama
  const startBearing = nextPoint ? calculateBearing(startPoint.lat, startPoint.lng, nextPoint.lat, nextPoint.lng) : 0;
  await page.evaluate(({ lat, lng, heading, panoId }) => initPanorama(lat, lng, heading, panoId),
    { ...startPoint, heading: startBearing, panoId: lastPano });

  log.info(`Starting navigation - ${route.length - state.lastStep} steps remaining`);

  // Navigation Loop
  let routeIndex = state.lastStep;
  let panoHistory = [];
  let stuckCount = 0; // Track how many times we've skipped without moving
  let lastImageDate = null; // Track image date to detect backwards jumps
  let stepsSinceAgeCheck = 0; // Track steps since last age check to avoid checking too frequently
  let lastCapturedPano = null; // To avoid processing the same pano twice (e.g. when just advancing waypoints)

  while (routeIndex < route.length) {
    // 1. Stabilize: Wait for position and links
    let { currentPos, links } = await waitForStablePanorama(page);

    // 2. Fixups: Check for time jumps or old imagery
    // Detect backwards time jump and attempt recovery
    if (currentPos.imageDate && lastImageDate) {
      const currentDate = new Date(currentPos.imageDate);
      const previousDate = new Date(lastImageDate);

      // If we've jumped backwards by more than 30 days, try to recover
      const daysDiff = (currentDate - previousDate) / (1000 * 60 * 60 * 24);
      if (daysDiff < -30) {
        const currentYearMonth = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
        const previousYearMonth = `${previousDate.getFullYear()}-${String(previousDate.getMonth() + 1).padStart(2, '0')}`;
        log.warn(`⏰ Backwards time jump detected: ${previousYearMonth} → ${currentYearMonth} (${Math.abs(daysDiff).toFixed(0)} days)`);
        log.warn(`🔄 Attempting to recover by searching for newer imagery at this location...`);

        // Reinitialize at current position to let Google find newest imagery
        const bearing = calculateBearing(currentPos.lat, currentPos.lng, route[routeIndex].lat, route[routeIndex].lng);
        await page.evaluate(({ lat, lng, heading }) => initPanorama(lat, lng, heading, null),
          { lat: currentPos.lat, lng: currentPos.lng, heading: bearing });

        // Wait for stability again after re-init
        const stabilityResult = await waitForStablePanorama(page);
        const recoveredPos = stabilityResult.currentPos;
        links = stabilityResult.links;

        if (recoveredPos.imageDate) {
          const recoveredDate = new Date(recoveredPos.imageDate);
          const recoveredYearMonth = `${recoveredDate.getFullYear()}-${String(recoveredDate.getMonth() + 1).padStart(2, '0')}`;
          if (recoveredDate > currentDate) {
            log.info(`✓ Recovery successful! Found newer imagery: ${recoveredYearMonth}`);
            currentPos = recoveredPos;
            stepsSinceAgeCheck = 0; // Reset counter after successful recovery
          } else {
            log.warn(`Recovery found same or older imagery: ${recoveredYearMonth}`);
            // We stick with the recoveredPos anyway as it's the current state
            currentPos = recoveredPos;
          }
        }
      }
    }

    // Check if imagery is too old based on absolute age (not just relative jumps)
    stepsSinceAgeCheck++;
    if (MAX_IMAGE_AGE_MONTHS > 0 && currentPos.imageDate && stepsSinceAgeCheck >= 3) {
      const now = new Date();
      const imageDate = new Date(currentPos.imageDate);
      const monthsDiff = (now.getFullYear() - imageDate.getFullYear()) * 12 + (now.getMonth() - imageDate.getMonth());

      if (monthsDiff > MAX_IMAGE_AGE_MONTHS) {
        const imageYearMonth = `${imageDate.getFullYear()}-${String(imageDate.getMonth() + 1).padStart(2, '0')}`;
        log.warn(`📅 Old imagery detected: ${imageYearMonth} (${monthsDiff} months old, threshold: ${MAX_IMAGE_AGE_MONTHS})`);
        log.warn(`🔄 Checking for newer imagery at this location...`);

        // Reinitialize at current position to let Google find newest imagery
        const bearing = calculateBearing(currentPos.lat, currentPos.lng, route[routeIndex].lat, route[routeIndex].lng);
        await page.evaluate(({ lat, lng, heading }) => initPanorama(lat, lng, heading, null),
          { lat: currentPos.lat, lng: currentPos.lng, heading: bearing });

        // Wait for stability again after re-init
        const stabilityResult = await waitForStablePanorama(page);
        const recoveredPos = stabilityResult.currentPos;
        links = stabilityResult.links;

        if (recoveredPos.imageDate) {
          const recoveredDate = new Date(recoveredPos.imageDate);
          const recoveredYearMonth = `${recoveredDate.getFullYear()}-${String(recoveredDate.getMonth() + 1).padStart(2, '0')}`;
          const recoveredMonthsDiff = (now.getFullYear() - recoveredDate.getFullYear()) * 12 + (now.getMonth() - recoveredDate.getMonth());

          if (recoveredDate > imageDate) {
            log.info(`✓ Found newer imagery: ${recoveredYearMonth} (${recoveredMonthsDiff} months old)`);
            currentPos = recoveredPos;
          } else {
            log.warn(`No newer imagery available at this location (still ${recoveredYearMonth})`);
            currentPos = recoveredPos;
          }
        }
        stepsSinceAgeCheck = 0; // Reset counter after checking
      }
    }

    // Update last image date for next comparison
    if (currentPos.imageDate) {
      lastImageDate = currentPos.imageDate;
    }

    // 3. Process State (Screenshot, Save, History)
    // Only if we haven't processed this pano already (e.g. if we just advanced a waypoint)
    if (currentPos.pano !== lastCapturedPano) {
       // Loop Detection
      if (panoHistory.includes(currentPos.pano)) {
        log.fatal(`LOOP DETECTED: Have been to pano ${currentPos.pano} before!`);
        process.exit(1);
      }
      panoHistory.push(currentPos.pano);
      if (panoHistory.length > 10) panoHistory.shift();

      const dateStr = (currentPos.imageDate && currentPos.imageDate.length >= 7) ? ` [${currentPos.imageDate.substring(0, 7)}]` : '';
      log.info(`Current Pano: ${currentPos.pano}${dateStr}`);

      // Check if imagery is too old (Fatal check for skipping)
      if (MIN_IMAGE_YEAR > 0 && currentPos.imageDate) {
        const imageYear = new Date(currentPos.imageDate).getFullYear();
        if (imageYear < MIN_IMAGE_YEAR) {
          log.warn(`Image too old: ${imageYear} < ${MIN_IMAGE_YEAR}, skipping...`);
          // We don't exit, but we treat this as a "stuck" case if we can't move?
          // Actually, original code just incremented stuckCount.
          // We'll let the movement logic handle it, but log it here.
          stuckCount++;
        }
      }

      await captureScreenshot(page, currentPos);
      saveState(fs, STATE_FILE, routeIndex, currentPos);
      lastCapturedPano = currentPos.pano;
    }

    // 4. Logic: Check distance to target(s)
    let processedWaypoint = false;
    while (routeIndex < route.length) {
      const target = route[routeIndex];
      const distToTarget = calculateDistance(currentPos.lat, currentPos.lng, target.lat, target.lng);
      log.info(`Target ${routeIndex}/${route.length} - Dist: ${distToTarget.toFixed(1)}m`);

      if (distToTarget < 25) { // Threshold for reaching a route point
        log.info(`✓ Reached target point ${routeIndex}`);
        routeIndex++;
        stuckCount = 0; // Reset stuck count when we advance target via proximity
        processedWaypoint = true;
      } else {
        break; // Not close enough to this target, proceed to move
      }
    }

    if (routeIndex >= route.length) break;
    if (processedWaypoint) continue; // Re-evaluate with new target without moving

    // 5. Move: Calculate and Execute
    const target = route[routeIndex];
    const targetBearing = calculateBearing(currentPos.lat, currentPos.lng, target.lat, target.lng);
    log.info(`Found ${links ? links.length : 0} available links`);
    const bestLink = getBestLink(links, targetBearing);

    if (bestLink) {
      stuckCount = 0; // Reset stuck count because we found a valid movement
      log.info(`→ Moving to pano: ${bestLink.pano} (Heading: ${bestLink.heading.toFixed(1)}°, Target: ${targetBearing.toFixed(1)}°)`);

      await page.evaluate(({ panoId, heading }) => moveToPano(panoId, heading), {
        panoId: bestLink.pano,
        heading: bestLink.heading
      });

      // Wait for network to be idle (tiles loaded)
      await page.waitForLoadState('networkidle');
      // Additional safety wait
      await page.waitForTimeout(STEP_DELAY);

      // Note: We do NOT check "postMovePos" here anymore.
      // The next iteration will handle the new position validation.

    } else {
      stuckCount++;
      log.warn(`No suitable links found towards target ${routeIndex}. (Stuck count: ${stuckCount})`);

      if (stuckCount >= 2) {
        throw new Error("Stuck! Exiting...");
      } else {
        // Try skipping the waypoint
        routeIndex++;
      }
    }
  }

  log.info('✓ Navigation complete!');
  // end logstream
}

async function main() {
  const PROJECT_NAME = process.argv[2];
  if (!PROJECT_NAME) {
    console.error("Please provide a project name: node navigator/index.js  <project-name>");
    process.exit(1);
  }

  const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
  if (!API_KEY) {
    throw new Error('GOOGLE_MAPS_API_KEY not found in .env file!');
  }

  PROJECT_DIR = fileURLToPath(new URL(`../projects/${PROJECT_NAME}/`, import.meta.url));

  if (!fs.existsSync(PROJECT_DIR)) {
    fs.mkdirSync(PROJECT_DIR, { recursive: true });
  }

  IMAGES_DIR = path.join(PROJECT_DIR, 'images');
  ROUTE_FILE = path.join(PROJECT_DIR, 'route.json');
  STATE_FILE = path.join(PROJECT_DIR, 'navigator_state.json');

  const logFile = fs.createWriteStream(path.join(PROJECT_DIR, 'navigator.log'), { flags: 'a' });
  log = new Signale({
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

  if (!fs.existsSync(ROUTE_FILE)) {
    log.fatal(`route.json not found in project ${PROJECT_DIR}! Please export a route and place it there.`);
    process.exit(1);
  }
  const route = JSON.parse(fs.readFileSync(ROUTE_FILE, 'utf-8'));
  log.info(`Loaded route with ${route.length} waypoints`);

  if (!fs.existsSync(IMAGES_DIR)) {
    log.info(`Creating images directory: ${IMAGES_DIR}`);
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
  }

  STEP_DELAY = parseInt(process.env.NAVIGATOR_STEP_DELAY || '5000', 10);
  WIDTH = parseInt(process.env.NAVIGATOR_WIDTH || '1920', 10);
  HEIGHT = parseInt(process.env.NAVIGATOR_HEIGHT || '1080', 10);
  MIN_IMAGE_YEAR = parseInt(process.env.NAVIGATOR_MIN_IMAGE_YEAR || '0', 10);
  MAX_IMAGE_AGE_MONTHS = parseInt(process.env.NAVIGATOR_MAX_IMAGE_AGE_MONTHS || '0', 10);

  if (MIN_IMAGE_YEAR > 0) {
    log.info(`env setting: Filtering imagery older than ${MIN_IMAGE_YEAR}`);
  }
  if (MAX_IMAGE_AGE_MONTHS > 0) {
    log.info(`env setting: Will check for newer imagery if, after moving, the current is older than ${MAX_IMAGE_AGE_MONTHS} months`);
  }



  const state = loadState(fs, STATE_FILE);
  if (state.lastStep >= route.length) {
    log.info('Already completed the route.');
    process.exit(0);
  }

  await run(route, state);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}