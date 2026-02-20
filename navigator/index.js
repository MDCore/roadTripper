#!/usr/bin/env node
import { chromium } from 'playwright';
import * as realFs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createConsola } from 'consola';
import { calculateHeading, calculateDistance, getBestLink, loadState, saveState } from './lib.js';

// Global variables
let log = createConsola({ level: 0 }); // Default to silent for tests
let WIDTH, HEIGHT, STEP_DELAY, JPEG_QUALITY;

const panoDataEvaluator = (page) => (pano) => page.evaluate(({ pano }) => getPanoDataV(pano), { pano });
const getCurrentPositionEvaluator = (page) => () => page.evaluate(() => getCurrentPositionPanoV());
const moveToPanoEvaluator = (page) => (pano, heading) => page.evaluate(({ pano, heading }) => moveToPanoV(pano, heading), { pano, heading });
const initPanoramaEvaluator = (page) => (lat, lng, heading, pano) => page.evaluate(({ lat, lng, heading, pano }) => initPanoramaV(lat, lng, heading, pano), { lat, lng, heading, pano });

async function captureScreenshot(imagePath, page, position) {
  log.info(`Capturing pano ${position.pano} at ${position.lat}, ${position.lng}`)

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('Z')[0];
  const imageDate = position.date ? new Date(position.date).toISOString().slice(0, 7) : "unknown";
  const filename = path.join(imagePath, `${timestamp} ${position.lat.toFixed(6)} ${position.lng.toFixed(6)} ${imageDate} ${position.pano}.jpg`);

  await page.screenshot({ path: filename, type: 'jpeg', quality: JPEG_QUALITY });
  log.info(`📷 Captured: ${path.basename(filename)}`);
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
  page.on('console', msg => {
    if (msg.text().includes('Google Maps JavaScript API has been loaded directly')) {
      return;
    }
    log.info(`Viewport log: ${msg.text()}`);
  });

  // Log failed requests with URLs
  page.on('requestfailed', request => {
    if (request.url().includes('maps.gstatic.com')) {
      return;
    }
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

async function initPanorama(currentPosition, badPanos, initializePanorama, waitForPageReady, fetchCurrentPosition, fetchPanoData) {
  await initializePanorama(currentPosition.lat, currentPosition.lng, currentPosition.heading, currentPosition.pano);

  await waitForPageReady();

  /* we're calling getCurrentPositionData() here, because we may have come into initPanorama without
  a panoId. This will get the panorama data for wherever we are now, including a pano */
  return await getCurrentPositionData(badPanos, fetchCurrentPosition, fetchPanoData);
}

export async function moveToPano(position, moveTo, waitForPageReady) {
  await moveTo(position.pano, position.heading);

  await waitForPageReady();
}

/* Get the position data from whatever position the current panorama is in */
export async function getCurrentPositionData(badPanos, fetchCurrentPosition, fetchPanoData) {
  const pano = await fetchCurrentPosition();

  return await getPanoData(fetchPanoData, badPanos, pano.pano, pano.heading);
}

export async function chooseBestPanoAtPosition(panoData, badPanos, fetchPanoData) {
  /* have we landed on a bad pano? Let's get the next best one */
  if (badPanos.includes(panoData.pano)) {
    log.warn(`This is a bad pano: ${panoData.pano}. Getting newest clean pano.`);

    // Clean the pano history for this position
    panoData.times = panoData.times.filter(item => !badPanos.includes(item.pano));
    if (panoData.times.length === 0) {
      return {};
    }

    // walk the panos backwards to find the newest one on the same road i.e. on has same description
    let bestPanoData = {};
    for (let i = panoData.times.length - 1; i >= 0; i--) {
      log.debug(`checking pano ${i}: ${panoData.times[i].pano} on ${panoData.description} from ${panoData.times[i].GA}`);
      let checkPanoData = await fetchPanoData(panoData.times[i].pano);

      if (checkPanoData.description !== panoData.description) {
        log.debug(`Description mismatch: ${panoData.description} vs ${checkPanoData.description}`)
        continue;
      } else {
        log.debug(`Success. Pano ${i} is the best good pano.`)
        bestPanoData = checkPanoData;
        break;
      }
    }
    if (!bestPanoData) {
      return {};
    }

    return bestPanoData;
  }

  // So it wasn't a bad pano, but is it the latest pano?
  let latestPano = panoData.times[panoData.times.length - 1];
  if (panoData.times && panoData.pano !== latestPano.pano) {
    log.warn(`Not the latest pano. Considering switching from ${panoData.pano} to ${latestPano.pano}`);
     /*
      So this is not the latest pano, but is the new pano still on the same road i.e. has the same description?
      Get the latest pano so we can see its description.
    */
    let latestPanoData = await fetchPanoData(latestPano.pano);

    if (panoData.description != latestPanoData.description) {
      log.warn(`Not switching. Latest pano was a different location: ${latestPanoData.description} instead of ${panoData.description}`);
    } else {
      log.warn(`Switching from older pano ${panoData.pano} to ${latestPanoData.pano}`);
      return latestPanoData;
    }
  }

  // No changes? Just go with what we got then
  return panoData;
}

/* get position data for an arbitrary panoId */
export async function getPanoData(fetchPanoData, badPanos, pano, heading) {
  let newPanoData = await fetchPanoData(pano);
  newPanoData = await chooseBestPanoAtPosition(newPanoData, badPanos, fetchPanoData);

  if (!newPanoData) {
    log.fatal('Fatal: there are no good panos at this position.');
    process.exit(1);
  }

  let currentPosition = {};
  currentPosition.lat = newPanoData.lat;
  currentPosition.lng = newPanoData.lng;
  currentPosition.heading = heading;
  currentPosition.pano = newPanoData.pano;
  currentPosition.date = newPanoData.date;
  currentPosition.description = newPanoData.description;
  currentPosition.links = newPanoData.links;
  currentPosition.panoHistory = newPanoData.times;
  return currentPosition;
}

export async function run(project, {
  fs = realFs,
  log: customLog = log,
  page = null,
  initializePanorama = null,
  waitForPageReady = null,
  fetchCurrentPosition = null,
  fetchPanoData = null,
  moveTo = null
} = {}) {

  if (!page) { page = await setupViewport(fs); }
  if (!initializePanorama) { initializePanorama = initPanoramaEvaluator(page); }
  if (!waitForPageReady) { waitForPageReady = async () => {
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(STEP_DELAY); };
  }
  if (!fetchCurrentPosition) { fetchCurrentPosition = getCurrentPositionEvaluator(page); }
  if (!fetchPanoData) { fetchPanoData = panoDataEvaluator(page); }
  if (!moveTo) { moveTo = moveToPanoEvaluator(page); }
  let initialized = false;

  const route = project.route;
  const state = loadState(fs, project.stateFile, log);

  let currentStep = state.position.step;
  let currentPosition = {
    pano: state.position.pano,
    date: null,
    lat: state.position.lat || route[currentStep].lat,
    lng: state.position.lng || route[currentStep].lng,
    heading: state.position.heading || 1,
    links: null
  };
  let routeState = state.route || { badPanos: [] };

  let roadTripping = true;
  while (roadTripping) {
    log.log('\n')
    // get the heading
    let nextStep = null;
    if (currentStep < route.length - 1) {
      nextStep = { lat: route[currentStep + 1].lat, lng: route[currentStep + 1].lng };
      currentPosition.heading = nextStep ? calculateHeading(route[currentStep].lat, route[currentStep].lng, nextStep.lat, nextStep.lng) : 0;
    }

    if (!initialized) {
      currentPosition = await initPanorama(currentPosition, routeState.badPanos, initializePanorama, waitForPageReady, fetchCurrentPosition, fetchPanoData);
      initialized = true;
    } else {
      await moveToPano(currentPosition, moveTo, waitForPageReady);
    }
    await captureScreenshot(project.imagePath, page, currentPosition);

    if (currentStep >= route.length - 1) {
      log.info(`\nTrip complete`);
      return true;
    }

    const distToNextStep = calculateDistance(currentPosition.lat, currentPosition.lng, nextStep.lat, nextStep.lng);
    log.info(`Target ${currentStep + 1}/${route.length} - Dist: ${distToNextStep.toFixed(1)}m`);

    // Start again at next Step
    if (distToNextStep < 25) {
      currentStep++;
      log.info(`Reached target step ${currentStep} but NOT resetting to ${currentPosition.lat}, ${currentPosition.lng})`);
    } else if (!currentPosition.pano) {
      log.fatal(`not implemented yet!`);
      return false;
    }

    const bestLink = getBestLink(currentPosition.links, currentPosition.heading);
    if (bestLink) {
      log.info(`Checking linked pano: ${bestLink.pano} (Heading: ${bestLink.heading.toFixed(1)}°)`);
      currentPosition = await getPanoData(fetchPanoData, routeState.badPanos, bestLink.pano, bestLink.heading);
      log.info(`Setting new pano to ${currentPosition.pano} - ${currentPosition.description}`);
    } else {
      // doh! Let's mark this as a bad pano, and try the next one
      routeState.badPanos.push(currentPosition.pano);
      currentPosition = await getCurrentPositionData(routeState.badPanos, fetchCurrentPosition, fetchPanoData);
      continue;
    }

    saveState(fs, project.stateFile, currentStep, currentPosition, routeState, log); // save current position but starting at the next step
  }

  return true;
}

async function mainNavigate({ fs = realFs, project, projectPath } = {}) {
  if (!project) {
    if (!projectPath) {
      console.error("Please provide a project path: node navigator/index.js <path>");
      process.exit(1);
    }
    projectPath = projectPath.endsWith('/') ? projectPath : projectPath + '/';
    let projectName = path.basename(projectPath.slice(0, -1));
    project = {
      name: projectName,
      projectPath: projectPath,
      imagePath: path.join(projectPath, 'images'),
      routeFile: path.join(projectPath, 'route.json'),
      stateFile: path.join(projectPath, 'navigator_state.json')
    };
  }

  dotenv.config({ quiet: true });

  const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
  if (!API_KEY) {
    throw new Error('GOOGLE_MAPS_API_KEY not found in .env file!');
  }

  if (!fs.existsSync(project.projectPath)) {
    console.error(`Project directory does not exist: ${project.projectPath}`);
    process.exit(1);
  }

  const logFile = fs.createWriteStream(path.join(project.projectPath, 'navigator.log'), { flags: 'a' });

  log.wrapStd();

  log.level = 4; // Show debug and above

  log.addReporter({
    log(logObj) {
      const timestamp = logObj.date ? new Date(logObj.date).toISOString() : '';
      const msg = typeof logObj.args[0] === 'object'
        ? JSON.stringify(logObj.args)
        : logObj.args.join(' ');
      logFile.write(`${timestamp} ${msg}\n`);
    }
  });

  if (!fs.existsSync(project.routeFile)) {
    log.fatal(`route.json not found in project ${project.projectPath}! First plan a route and save it there.`);
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
  JPEG_QUALITY = parseInt(process.env.NAVIGATOR_JPEG_QUALITY || '60', 10);

  await run(project, { fs, page: null });
}

export { mainNavigate };

const __filename = realFs.realpathSync(fileURLToPath(import.meta.url));
const argv1RealPath = process.argv[1] ? realFs.realpathSync(process.argv[1]) : null;
if (argv1RealPath === __filename) {
  const projectPath = process.argv[2];
  mainNavigate({ projectPath });
}