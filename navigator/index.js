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
const updatePageTitle = (page) => (title) => page.evaluate(({ title }) => updateTitle(title ), { title });

async function captureScreenshot(imagePath, page, position) {

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('Z')[0];
  const imageDate = position.date ? position.date : "unknown";
  const filename = path.join(imagePath, `${timestamp} ${position.lat.toFixed(6)} ${position.lng.toFixed(6)} ${imageDate} ${position.pano}${position.isAlternate ? ' alternate' : ''}.jpg`);

  await page.screenshot({ path: filename, type: 'jpeg', quality: JPEG_QUALITY });
  log.info(`📷 Captured: ${path.basename(filename)}`);
}

// ------------------------------------------

async function setupViewport(fs, debug = false) {
  let browserOptions, pageOptions;
  if (debug) {
    browserOptions = {
      headless: false,
      args: ['--auto-open-devtools-for-tabs']
    }
    pageOptions = {
      viewport: { width: 1280, height: 720 }
    }
  } else {
    browserOptions = {
      headless: true
    }
    pageOptions = {
      viewport: { width: WIDTH, height: HEIGHT }
    }
  }
  const browser = await chromium.launch(browserOptions);
  const page = await browser.newPage(pageOptions);

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
  // Clean the pano history for this position
  panoData.times = panoData.times.filter(item => !badPanos.includes(item.pano));
  if (panoData.times.length === 0) {
    log.warn(`${panoData.pano} has no good panos.`)
    return {};
  }

  // have we landed on a bad pano? Let's get the next best one
  if (badPanos.includes(panoData.pano)) {
    log.warn(`This is a bad pano: ${panoData.pano}. Getting newest clean pano.`);

    // walk the panos backwards to find the newest one on the same road i.e. on has same description
    let bestPanoData = {};
    for (let i = panoData.times.length - 1; i >= 0; i--) {
      log.debug(`checking pano ${i}: ${panoData.times[i].pano} on ${panoData.description} from ${panoData.times[i].date}`);
      let checkPanoData = await fetchPanoData(panoData.times[i].pano);

      if (checkPanoData.description !== panoData.description) {
        log.debug(`Description mismatch: ${panoData.description} vs ${checkPanoData.description}`)
        continue;
      } else {
        log.debug(`Success. Pano ${i} is the best good pano.`)
        bestPanoData = checkPanoData;
        bestPanoData.isAlternate = true;
        break;
      }
    }
    if (!bestPanoData) {
      return {};
    }

    return bestPanoData;
  }

  // So it isn't a bad pano, but is it the latest pano?
  let latestPanoData = panoData.times[panoData.times.length - 1];
  if (panoData.times && panoData.pano !== latestPanoData.pano) {
    log.warn(`Not the latest pano. Considering switching from ${panoData.pano} [${panoData.date}] to ${latestPanoData.pano} [${latestPanoData.date}]`);
    /*
    So this is not the latest pano, but is the new pano still on the same road i.e. has the same description?
    Get the latest pano so we can see its description.
    */
    latestPanoData = await fetchPanoData(latestPanoData.pano);

    if (panoData.description != latestPanoData.description) {
      log.warn(`Not switching. Latest pano was a different location: ${latestPanoData.description} instead of ${panoData.description}`);
    } else {
      log.warn(`Switching from pano ${panoData.pano} [${panoData.date}] to ${latestPanoData.pano} [${latestPanoData.date}]`);
      latestPanoData.isAlternate = true;
      return latestPanoData;
    }
  }

  // No changes? Just go with what we got then
  return panoData;
}

/* get position data for an arbitrary panoId */
export async function getPanoData(fetchPanoData, badPanos, pano, heading) {
  let newPanoData = await fetchPanoData(pano);
  if (!newPanoData) {
    log.warn(`pano ${pano} not found`);
    return false;
  }

  newPanoData = await chooseBestPanoAtPosition(newPanoData, badPanos, fetchPanoData);

  if (!newPanoData) {
    log.warn(`There are no good panos at this pano ${pano}.`);
    return false;
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
  currentPosition.isAlternate = newPanoData.isAlternate || false;
  return currentPosition;
}

export async function run(project, {
  fs = realFs,
  page = null,
  initializePanorama = null,
  waitForPageReady = null,
  fetchCurrentPosition = null,
  fetchPanoData = null,
  moveTo = null,
  debug = false
} = {}) {

  if (!page) { page = await setupViewport(fs, debug); }
  if (!initializePanorama) { initializePanorama = initPanoramaEvaluator(page); }
  if (!waitForPageReady) { waitForPageReady = async () => {

    await page.waitForLoadState('networkidle');

    await page.waitForFunction(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return false;

      if (!window._canvasCheck) {
        window._canvasCheck = { lastData: null, stableSince: null, startTime: Date.now() };
      }

      const data = canvas.toDataURL('image/jpeg', 0.05);
      const check = window._canvasCheck;

      if (data === check.lastData) {
        if (!check.stableSince) {
          check.stableSince = Date.now();
        }

        const stableMs = Date.now() - check.stableSince;
        if (stableMs > 500) {
          window._canvasCheck = null;
          return true;
        }
      } else {
        check.lastData = data;
        check.stableSince = null;
      }

      if (Date.now() - check.startTime > 10000) {
        window._canvasCheck = null;
        return true;
      }

      return false;
    }, { timeout: 10000 }).catch(() => {});

    await page.waitForTimeout(STEP_DELAY);
  }; }
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
    updatePageTitle(page)(`${currentStep} ${currentPosition.date ? currentPosition.date : ''} ${currentPosition.description ? currentPosition.description: '' }`);

    // get the heading
    let nextStep = null;
    if (currentStep < route.length - 1) {
      nextStep = { lat: route[currentStep + 1].lat, lng: route[currentStep + 1].lng };
      currentPosition.heading = nextStep ? calculateHeading(route[currentStep].lat, route[currentStep].lng, nextStep.lat, nextStep.lng) : 0;
    }

    // load pano for the first time, or move towards it
    if (!initialized) {
      currentPosition = await initPanorama(currentPosition, routeState.badPanos, initializePanorama, waitForPageReady, fetchCurrentPosition, fetchPanoData);
      initialized = true;
    } else {
      await moveToPano(currentPosition, moveTo, waitForPageReady);
    }

    // capture the screenshot
    await captureScreenshot(project.imagePath, page, currentPosition);

    // if the trip is over, end it
    if (currentStep >= route.length - 1) {
      log.info(`Trip complete`);
      return true;
    }

    // work out the distance to the next step
    const distToNextStep = calculateDistance(currentPosition.lat, currentPosition.lng, nextStep.lat, nextStep.lng);
    log.info(`Target ${currentStep + 1}/${route.length} - Dist: ${distToNextStep.toFixed(1)}m`);
    // if we're close to the next step, increment the step counter
    if (distToNextStep < 25) {
      currentStep++;

      log.info(`Reached target step ${currentStep} of ${currentPosition.lat}, ${currentPosition.lng})`);
    }

    // work out the best link - which direction to go from here
    /* If you want to debug why something is going in the wrong direction, a breakpoint around here is a good start */
    currentPosition.links = currentPosition.links.filter(item => !routeState.badPanos.includes(item.pano)); // strip bad panos

    const bestLink = getBestLink(currentPosition.links, currentPosition.heading);
    if (bestLink) {
      log.info(`Checking linked pano: ${bestLink.pano} (Heading: ${bestLink.heading.toFixed(1)}°)`);
      currentPosition = await getPanoData(fetchPanoData, routeState.badPanos, bestLink.pano, bestLink.heading);
      if (currentPosition) {
        log.info(`Setting new pano to ${currentPosition.pano} - ${currentPosition.description}`);
      } else {
        // uh oh, the best link pano doesn't exist!
        routeState.badPanos.push(bestLink.pano);
        currentPosition = await getCurrentPositionData(routeState.badPanos, fetchCurrentPosition, fetchPanoData);
      }
    } else {
      // doh! Let's mark this as a bad pano, and try the next one
      routeState.badPanos.push(currentPosition.pano);
      currentPosition = await getCurrentPositionData(routeState.badPanos, fetchCurrentPosition, fetchPanoData);
      continue;
    }

    // Save the state to navigator_state.json
    saveState(fs, project.stateFile, currentStep, currentPosition, routeState, log);
    log.log('------------------------------------------------------------------------------')
  }

  return true;
}

async function mainNavigate({ fs = realFs, project, projectPath, debug = false } = {}) {
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

  const configPath = path.join(project.projectPath, 'project.conf');
  if (!fs.existsSync(configPath)) {
    console.error(`Error: project.conf not found in ${project.projectPath}`);
    console.error('Please create a project.conf file with your GOOGLE_MAPS_API_KEY');
    process.exit(1);
  }
  dotenv.config({ path: configPath, quiet: true });

  const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
  if (!API_KEY) {
    throw new Error('GOOGLE_MAPS_API_KEY not found in project.conf!');
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

  STEP_DELAY = parseInt(process.env.NAVIGATOR_STEP_DELAY || '1000', 10);
  WIDTH = parseInt(process.env.NAVIGATOR_WIDTH || '1920', 10);
  HEIGHT = parseInt(process.env.NAVIGATOR_HEIGHT || '1080', 10);
  JPEG_QUALITY = parseInt(process.env.NAVIGATOR_JPEG_QUALITY || '60', 10);

  await run(project, { fs, page: null, debug });
}

export { mainNavigate };

const __filename = realFs.realpathSync(fileURLToPath(import.meta.url));
const argv1RealPath = process.argv[1] ? realFs.realpathSync(process.argv[1]) : null;
if (argv1RealPath === __filename) {
  const projectPath = process.argv[2];
  mainNavigate({ projectPath });
}