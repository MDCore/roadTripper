import { chromium } from 'playwright';
import * as realFs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import signale from 'signale'; const { Signale } = signale;
import { calculateHeading, calculateDistance, getBestLink, loadState, saveState, decideNextAction } from './lib.js';
import { fileURLToPath } from 'url';

// Global variables (initialized in main or used by helpers)
let log = new Signale({ disabled: true }); // Default to silent for tests

let WIDTH, HEIGHT, STEP_DELAY, MIN_IMAGE_YEAR, MAX_IMAGE_AGE_MONTHS;


async function captureScreenshot(imagePath, page, position) {
  // Log image date/age if available
  let ageStr = ' [unknown]';
  if (position.imageDate) {
    const imageDate = new Date(position.imageDate);
    const imageYear = imageDate.getFullYear();
    const imageMonth = imageDate.getMonth() + 1;
    ageStr = ` [${imageYear}-${String(imageMonth).padStart(2, '0')}]`;
  }

  log.info(`Capturing pano ${position.pano} at ${position.lat}, ${position.lng}`)
  //ZZZ is this necessary? await page.mouse.move(0, 0); // Move mouse out of viewport to avoid cursor artifacts
  await page.waitForTimeout(100);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = path.join(imagePath, `${timestamp}_${position.lat}_${position.lng}.jpg`);

  await page.screenshot({ path: filename, type: 'jpeg', quality: 90 });
  log.info(`📷 Captured: ${path.basename(filename)}${ageStr}`);
}

// ------------------------------------------

async function setupViewport(fs) {
  const browser = await chromium.launch({
     headless: false,
     //args: ['--auto-open-devtools-for-tabs']
    });
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
  }, null, { timeout: 5000 });
  const result = {
    position: await page.evaluate(() => getPosition()),
    links: await page.evaluate(() => getLinks())
  };

  // Wait for network to be idle (tiles loaded)
  await page.waitForLoadState('networkidle');

  return result;
}

export async function moveToPano(page, position) {
  page.evaluate(({ heading, pano }) => moveToPano(pano, heading), { heading: position.heading, pano: position.pano });

  // Wait for network to be idle (tiles loaded)
  await page.waitForLoadState('networkidle');
  // Additional safety wait
  await page.waitForTimeout(STEP_DELAY);

}

async function checkPanoQuality(page, currentPos, lastImageDate, stepsSinceAgeCheck) {
  // x. Fixups: Check for time jumps or old imagery
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
      const heading = calculateHeading(currentPos.lat, currentPos.lng, route[step].lat, route[step].lng);
      await page.evaluate(({ lat, lng, heading }) => initPanorama(lat, lng, heading, null),
        { lat: currentPos.lat, lng: currentPos.lng, heading: heading });

      // Wait for stability again after re-init
      const stabilityResult = await waitForStablePanorama(page);
      const recoveredPos = stabilityResult.position;

      if (recoveredPos.imageDate) {
        const recoveredDate = new Date(recoveredPos.imageDate);
        const recoveredYearMonth = `${recoveredDate.getFullYear()}-${String(recoveredDate.getMonth() + 1).padStart(2, '0')}`;
        if (recoveredDate > currentDate) {
          log.info(`✓ Recovery successful! Found newer imagery: ${recoveredYearMonth}`);
          stepsSinceAgeCheck = 0; // Reset counter after successful recovery
        } else {
          log.warn(`Recovery found same or older imagery: ${recoveredYearMonth}`);
          // We stick with the recoveredPos anyway as it's the current state
        }
        currentPos = recoveredPos;
        links = stabilityResult.links;
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
      const heading = calculateHeading(currentPos.lat, currentPos.lng, route[step].lat, route[step].lng);
      await page.evaluate(({ lat, lng, heading }) => initPanorama(lat, lng, heading, null),
        { lat: currentPos.lat, lng: currentPos.lng, heading: heading });

      // Wait for stability again after re-init
      const stabilityResult = await waitForStablePanorama(page);
      const recoveredPos = stabilityResult.position;

      if (recoveredPos.imageDate) {
        const recoveredDate = new Date(recoveredPos.imageDate);
        const recoveredYearMonth = `${recoveredDate.getFullYear()}-${String(recoveredDate.getMonth() + 1).padStart(2, '0')}`;
        const recoveredMonthsDiff = (now.getFullYear() - recoveredDate.getFullYear()) * 12 + (now.getMonth() - recoveredDate.getMonth());

        if (recoveredDate > imageDate) {
          log.info(`✓ Found newer imagery: ${recoveredYearMonth} (${recoveredMonthsDiff} months old)`);
        } else {
          log.warn(`No newer imagery available at this location (still ${recoveredYearMonth})`);
        }
        currentPos = recoveredPos;
        links = stabilityResult.links;
      }
      stepsSinceAgeCheck = 0; // Reset counter after checking
    }
  }

  // Update last image date for next comparison
  if (currentPos.imageDate) {
    lastImageDate = currentPos.imageDate;
  }
  return currentPos, stepsSinceAgeCheck;
}

export async function run(project, { fs = realFs, page = null } = {}) {

  const route = project.route;
  const state = loadState(fs, project.stateFile);

  let currentStep = state.step;
  let currentPosition = {
    pano: state.pano,
    lat: state.lat || route[currentStep].lat,
    lng: state.lng || route[currentStep].lng,
    heading: state.heading || 1
  };

  if (!page) { page = await setupViewport(fs); }
  await page.evaluate(({ lat, lng, heading, pano }) => initPanorama(lat, lng, heading, pano), { lat: currentPosition.lat, lng: currentPosition.lng, heading: currentPosition.heading, pano: currentPosition.pano });
  let links = null;
({ position: currentPosition, links } = await waitForStablePanorama(page));

  let roadTripping = true;
  while (roadTripping) {

    // get the heading
    let nextStep = null;
    let heading = null;
    if (currentStep < route.length - 1) {
      nextStep = { lat: route[currentStep + 1].lat, lng: route[currentStep + 1].lng };
      currentPosition.heading = nextStep ? calculateHeading(route[currentStep].lat, route[currentStep].lng, nextStep.lat, nextStep.lng) : 0;
    }
    if (currentPosition.pano) {
      await moveToPano(page, currentPosition);
      await captureScreenshot(project.imagePath, page, currentPosition);
    }

    if (currentStep >= route.length - 1) {
      log.info(`Trip complete`);
      return true;
    }

    const distToNextStep = calculateDistance(currentPosition.lat, currentPosition.lng, nextStep.lat, nextStep.lng);
    log.info(`Target ${currentStep + 1}/${route.length} - Dist: ${distToNextStep.toFixed(1)}m`);

    // Start again at next Step
    if (distToNextStep < 25) {
      log.info(`Reached target step ${currentStep + 1}`);
      //ZZZ Update Current + Next Step + find nearest pano default will not
      currentPosition = { pano: "default", lat: nextStep.lat, lng: nextStep.lng, heading: currentPosition.heading }; // Keep current heading
      currentStep++;
      moveToPano(page, currentPosition);
      continue;
    } else if (!currentPosition.pano) {
      log.info(`Finding nearest pano`);
    }

    log.info(`Found ${links ? links.length : 0} available links`);
    const bestLink = getBestLink(links, heading);

    if (bestLink) {
      log.info(`→ Moving to pano: ${bestLink.pano} (Heading: ${bestLink.heading.toFixed(1)}°)`);
      await moveToPano(page, bestLink);
    } else {
      log.fatal(`TEMP EXIT: No Best Link`); //ZZZ better error message
      process.exit(1);
    }
    // ... //

    saveState(fs, project.stateFile, currentStep, currentPosition); // save current position but starting at the next step

    //roadTripping = false;
  }
  return true;
}

async function oldrun(project, { fs = realFs, page = null } = {}) {
  // Navigation Loop
  let panoHistory = [];
  let lastImageDate = null; // Track image date to detect backwards jumps
  let stepsSinceAgeCheck = 0; // Track steps since last age check to avoid checking too frequently
  let lastCapturedPano = null; // To avoid processing the same pano twice (e.g. when just advancing waypoints)

  /* Steps:
  Loop:

  */
  if (!page) { page = await setupViewport(fs); }
  const route = project.route;

  let run = true;
  while (run) { //step < route.length

// 0. load the state ----------------------------------------------------------
    const state = loadState(fs, project.stateFile);
    let step = state.step;
    let currentPos = state.pano ? {
      pano: state.pano,
      lat: state.lat,
      lng: state.lng,
      heading: state.heading
    } : {
      pano: "default",
      lat: route[step].lat,
      lng: route[step].lng,
      heading: 0
    };

    log.info(`Navigating from point ${step}: ${route[step].lat}, ${route[step].lng} - ${route.length - step} steps remaining`);
    log.info(`Current Position: pano: ${currentPos.pano}) lat: ${currentPos.lat}, lng: ${currentPos.lng}`);

// 1. Get heading from current to next point ----------------------------------
    const nextPoint = route[step + 1];
    log.info(`Targeting point ${step + 1}: ${nextPoint.lat}, ${nextPoint.lng}`);
    // ZZZ heading will be 0 on last point - maybe keep previous heading? state.heading?
    const heading = nextPoint ? calculateHeading(route[step].lat, route[step].lng, nextPoint.lat, nextPoint.lng) : 0;

// 2. Init the panorama with the current point + heading ----------------------
    await page.evaluate(({ lat, lng, heading, pano }) => initPanorama(lat, lng, heading, pano),
      { lat: currentPos.lat, lng: currentPos.lng, heading: currentPos,heading, pano: currentPos.pano });

// 3. Make sure the pano is stable (stable position, pano and links are loaded)
    let links = null;
   ({ position: currentPos, links } = await waitForStablePanorama(page));

// 4. Take a screenshot -------------------------------------------------------
    if (state.pano) {
      // Capture  a screenshot if the state has a panoId
      await captureScreenshot(project.imagePath, page, currentPos);
    }

// 5. Move towards the next point --------------------------------------------
    // 5.1 Reach the next point
    let processedWaypoint = false;
    while (step < route.length) { //ZZZ why is this while? what does this code block _do_?
      const distToNextStep = calculateDistance(currentPos.lat, currentPos.lng, nextPoint.lat, nextPoint.lng);
      log.info(`Target ${step}/${route.length} - Dist: ${distToNextStep.toFixed(1)}m`);

      if (distToNextStep < 25) { // Threshold for reaching a route point
        log.info(`✓ Reached target point ${step}`);
        step++;
        saveState(fs, project.stateFile, step, currentPos); // save current position but starting at the next step

        processedWaypoint = true;
      } else {
        break; // Not close enough to this target, proceed to move
      }
    }
    if (step >= route.length) {
      log.info('Route complete.');
      process.exit(0);
    }
    //ZZZ this line is now at the wrong point...
    if (processedWaypoint) continue; // Re-evaluate with new target without moving

    // x. Move: Calculate and Execute
    log.info(`Found ${links ? links.length : 0} available links`);
    const bestLink = getBestLink(links, heading);

    if (bestLink) {
      log.info(`→ Moving to pano: ${bestLink.pano} (Heading: ${bestLink.heading.toFixed(1)}°, Target: ${heading.toFixed(1)}°)`);

      await page.evaluate(({ panoId, heading }) => moveToPano(panoId, heading), {
        panoId: bestLink.pano,
        heading: bestLink.heading
      });

      // Wait for network to be idle (tiles loaded)
      await page.waitForLoadState('networkidle');
      // Additional safety wait
      await page.waitForTimeout(STEP_DELAY);
    } else {
      log.fatal(`TEMP EXIT: No Best Link`); //ZZZ better error message
      process.exit(1);
    }

// 6. Check that the newly moved to point is good (e.g. check age, repetition etc) --
    currentPos, stepsSinceAgeCheck = checkPanoQuality(page, currentPos, lastImageDate, stepsSinceAgeCheck);
    lastImageDate = currentPos.lastImageDate;

// 7. Save the state ------------------------------------------------------
    saveState(fs, project.stateFile, step, currentPos); // save current position but starting at the next step

//------------
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
          log.error(`TEMP EXIT: Image too old: ${imageYear} < ${MIN_IMAGE_YEAR}`);
          process.exit(1);
        }
      }

      saveState(fs, project.stateFile, step, currentPos);
      lastCapturedPano = currentPos.pano;
    }
  }
}

async function main({ fs = realFs, project } = {}) {
  const PROJECT_NAME = process.argv[2];
  if (!PROJECT_NAME) {
    console.error("Please provide a project name: node navigator/index.js  <project-name>");
    process.exit(1);
  }
  dotenv.config();

  const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
  if (!API_KEY) {
    throw new Error('GOOGLE_MAPS_API_KEY not found in .env file!');
  }

  if (!project) {
    const rootPath = fileURLToPath(new URL(`../projects/${PROJECT_NAME}/`, import.meta.url))
    project = {
      name: PROJECT_NAME,
      rootPath: rootPath,
      imagePath: path.join(rootPath, 'images'),
      routeFile: path.join(rootPath, 'route.json'),
      stateFile: path.join(rootPath, 'navigator_state.json')
    };
  }
  // project.imagePath = path.join(rootPath, 'images');
  // project.routeFile = path.join(rootPath, 'route.json');
  // project.stateFile = path.join(rootPath, 'navigator_state.json');

  if (!fs.existsSync(project.rootPath)) {
    fs.mkdirSync(project.rootPath, { recursive: true });
  }

  const logFile = fs.createWriteStream(path.join(project.rootPath, 'navigator.log'), { flags: 'a' });
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

  if (!fs.existsSync(project.routeFile)) {
    log.fatal(`route.json not found in project ${project.rootPath}! Please export a route and place it there.`);
    process.exit(1);
  }
  project.route = JSON.parse(fs.readFileSync(project.routeFile, 'utf-8'));

  log.info(`Loaded route with ${project.route.length} waypoints`);

  if (!fs.existsSync(project.imagePath)) {
    log.info(`Creating images directory: ${project.imagePath}`);
    fs.mkdirSync(project.imagePath, { recursive: true });
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

  await run(project, { fs, page: null });
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}