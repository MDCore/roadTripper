import { chromium } from 'playwright';
import * as realFs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import signale from 'signale'; const { Signale } = signale;
import { calculateHeading, calculateDistance, getBestLink, loadState, saveState } from './lib.js';
import { fileURLToPath } from 'url';

// Global variables (initialized in main or used by helpers)
let log = new Signale({ disabled: true }); // Default to silent for tests

let WIDTH, HEIGHT, STEP_DELAY, JPEG_QUALITY;


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

async function initPanorama(page, currentPosition) {
  await page.evaluate(({ lat, lng, heading, pano }) => initPanoramaV(lat, lng, heading, pano), { lat: currentPosition.lat, lng: currentPosition.lng, heading: currentPosition.heading, pano: currentPosition.pano });

    // Wait for network to be idle (tiles loaded)
  await page.waitForLoadState('networkidle');

  return await getCurrentPositionData(page);
}

export async function moveToPano(page, position) {
  page.evaluate(({ pano, heading }) => moveToPanoV(pano, heading), { pano: position.pano, heading: position.heading });

  // Wait for network to be idle (tiles loaded)
  await page.waitForLoadState('networkidle');
  // Additional safety wait, in case files are still loading
  await page.waitForTimeout(STEP_DELAY);
}

export async function getCurrentPositionData(page) {
  const result = await page.evaluate(() => getCurrentPositionDataV());
  return result;
}

export async function getPanoData(page, pano, heading) {
  const newPano = await page.evaluate(({ pano }) => getPanoDataV(pano), { pano: pano });
  let currentPosition = {};

  if (newPano.latestPano.pano !== newPano.pano) {
    log.warn(`Not the latest pano. Considering switching from ${newPano.pano} to ${newPano.latestPano.pano}`);
    /*
    So this is not the latest pano, but is the new pano still on the same road?
    Let's check the description of the proposed new pano. If it's different, let's not switch to it.
    */
    if (newPano.latestPano.description != newPano.description) {
      log.warn(`Not switching. Latest pano was a different location: ${newPano.latestPano.description} instead of ${newPano.description}`);
    } else {
      log.warn(`Switching from ${newPano.pano} to ${newPano.latestPano.pano}`);
      newPano.pano = newPano.latestPano.pano;
      newPano.date = newPano.latestPano.date;
    }
  }
  currentPosition.lat = newPano.lat;
  currentPosition.lng = newPano.lng;
  currentPosition.heading = heading;
  currentPosition.pano = newPano.pano;
  currentPosition.date = newPano.date;
  currentPosition.description = newPano.description;
  currentPosition.links = newPano.links;
  return currentPosition;
}

export async function run(project, { fs = realFs, page = null } = {}) {

  const route = project.route;
  const state = loadState(fs, project.stateFile);

  let currentStep = state.step;
  let currentPosition = {
    pano: state.pano,
    date: null,
    lat: state.lat || route[currentStep].lat,
    lng: state.lng || route[currentStep].lng,
    heading: state.heading || 1,
    links: null
  };

  if (!page) { page = await setupViewport(fs); }
  currentPosition = await initPanorama(page, currentPosition);

  let roadTripping = true;
  while (roadTripping) {
    log.log('\n')
    // get the heading
    let nextStep = null;
    if (currentStep < route.length - 1) {
      nextStep = { lat: route[currentStep + 1].lat, lng: route[currentStep + 1].lng };
      currentPosition.heading = nextStep ? calculateHeading(route[currentStep].lat, route[currentStep].lng, nextStep.lat, nextStep.lng) : 0;
    }
    if (currentPosition.pano) {
      await moveToPano(page, currentPosition);
      // If we're running for the first time the date isn't known yet. Let's fix that.
      if (!currentPosition.date) {
        currentPosition = await getPanoData(page, currentPosition.pano, currentPosition.heading);
      }
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
      currentPosition = { pano: null, lat: nextStep.lat, lng: nextStep.lng, heading: currentPosition.heading }; // Keep current heading
      currentStep++;
      log.info(`Reached target step ${currentStep} resetting to ${currentPosition.lat}, ${currentPosition.lng})`);
      currentPosition = await initPanorama(page, currentPosition);
      currentPosition = await getPositionOfPano(page, currentPosition.pano, currentPosition.heading);
      continue;
    } else if (!currentPosition.pano) {
      log.info(`Finding nearest pano`);
      log.fatal(`not implemented yet!`); //ZZZ better error message
      return false;
      currentPosition = await moveToPano(page, currentPosition);
      continue;
    }

    const bestLink = getBestLink(currentPosition.links, currentPosition.heading);
    if (bestLink) {
      log.info(`Checking linked pano: ${bestLink.pano} (Heading: ${bestLink.heading.toFixed(1)}°)`);
      currentPosition = await getPanoData(page, bestLink.pano, bestLink.heading);
      log.info(`Setting new pano to ${currentPosition.pano} - ${currentPosition.description}`);
    } else {
      // reset to current position
      let preResetPano = currentPosition.pano;
      log.warn(`No best link - resetting to current position ${currentPosition.lat}, ${currentPosition.lng}`)
      currentPosition = await initPanorama(page, currentPosition);
      currentPosition = await getPanoData(page, currentPosition.pano, currentPosition.heading);
      if (preResetPano === currentPosition.pano) {
        log.fatal('Reset landed on the same pano. Exiting');
        return false;
      }

      continue;
    }

    saveState(fs, project.stateFile, currentStep, currentPosition); // save current position but starting at the next step
  }
  return true;
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
  JPEG_QUALITY = parseInt(process.env.NAVIGATOR_JPEG_QUALITY || '60', 10);

  await run(project, { fs, page: null });
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}