const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const ROUTE_FILE = path.resolve(__dirname, '../route.json');
const VIEWPORT_FILE = `file://${path.resolve(__dirname, 'viewport.html')}`;
const STATE_FILE = path.resolve(__dirname, '../output/navigator_state.json');
const STEP_DELAY = parseInt(process.env.NAVIGATOR_STEP_DELAY || '5000', 10);

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
  const outputDir = path.dirname(STATE_FILE);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
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

function getBestLink(links, targetBearing) {
  if (!links || links.length === 0) return null;
  let closestLink = null;
  let minDiff = 360;

  for (const link of links) {
    let diff = Math.abs(link.heading - targetBearing);
    if (diff > 180) diff = 360 - diff;
    if (diff < minDiff) {
      minDiff = diff;
      closestLink = link;
    }
  }
  return closestLink;
}

async function run() {
  if (!fs.existsSync(ROUTE_FILE)) {
    console.error('route.json not found! Please export a route from the picker first.');
    process.exit(1);
  }

  const route = JSON.parse(fs.readFileSync(ROUTE_FILE, 'utf-8'));

  // Persistence logic
  const state = loadState();
  let startStep = 1;

  if (process.env.NAVIGATOR_START_INDEX) {
    startStep = parseInt(process.env.NAVIGATOR_START_INDEX, 10);
    console.log(`Manual override: starting at index ${startStep}`);
  } else if (process.env.NAVIGATOR_FORCE_RESHOOT === 'true') {
    console.log('Force reshoot: starting from the beginning.');
    startStep = 1;
  } else if (state && state.lastStep !== undefined) {
    startStep = state.lastStep;
    console.log(`Resuming from last saved index: starting at ${startStep}`);
  }

  if (startStep >= route.length) {
    console.log('Already completed the route. Use NAVIGATOR_FORCE_RESHOOT=true to restart.');
    process.exit(0);
  }

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  // Forward browser logs to terminal
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));

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
    console.error('GOOGLE_MAPS_API_KEY not found in .env file!');
    process.exit(1);
  }

  // Inject Google Maps API
  await page.addScriptTag({
    url: `https://maps.googleapis.com/maps/api/js?key=${API_KEY}`
  });

  // Wait for Maps API to load
  await page.waitForFunction(() => window.google && window.google.maps);

  // Initialize Panorama at start of route
  let startPoint = route[startStep - 1];
  let lastPano = null;

  if (state && state.lastStep === startStep) {
    console.log(`Using precise state from last run for point ${startStep}`);
    if (state.lastLat && state.lastLng) {
      startPoint = { lat: state.lastLat, lng: state.lastLng };
    }
    lastPano = state.lastPano;
  }

  const nextPoint = route[startStep];
  console.log(`Initializing at point ${startStep - 1}: ${startPoint.lat}, ${startPoint.lng} (Pano: ${lastPano || 'default'})`);
  console.log(`Targeting point ${startStep}: ${nextPoint.lat}, ${nextPoint.lng}`);

  const initialBearing = nextPoint ? calculateBearing(startPoint.lat, startPoint.lng, nextPoint.lat, nextPoint.lng) : 0;
  await page.evaluate(({ lat, lng, heading, panoId }) => initPanorama(lat, lng, heading, panoId), { ...startPoint, heading: initialBearing, panoId: lastPano });

  // Wait for panorama and connectivity to be ready
  await page.waitForFunction(() => 
    typeof panorama !== 'undefined' && 
    panorama.getPosition() && 
    panorama.getLinks() && 
    panorama.getLinks().length > 0
  );

  // Navigation Loop
  for (let routeStep = startStep; routeStep < route.length; routeStep++) {
    const target = route[routeStep];
    let bestLink = null;
    let targetBearing = 0;

    // Retry loop to wait for links to load
    for (let attempt = 0; attempt < 10; attempt++) {
      const current = await page.evaluate(() => getPosition());
      if (!current) {
        console.error('Error: Lost panorama position. Retrying...');
        await page.waitForTimeout(1000);
        continue;
      }

      targetBearing = calculateBearing(current.lat, current.lng, target.lat, target.lng);
      const links = await page.evaluate(() => getLinks());
      bestLink = getBestLink(links, targetBearing);

      if (bestLink) break;
      
      if (attempt < 9) {
        console.log(`Waiting for connectivity at step ${routeStep} (attempt ${attempt + 1})...`);
        await page.waitForTimeout(1000);
      }
    }

    if (bestLink) {
      await page.evaluate(({ panoId, heading }) => moveToPano(panoId, heading), { panoId: bestLink.pano, heading: targetBearing });

      // Wait for network to be idle (tiles loaded)
      await page.waitForLoadState('networkidle');
      // Additional safety wait
      await page.waitForTimeout(STEP_DELAY);

      const currentPos = await page.evaluate(() => getPosition());
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `output/${timestamp}_${currentPos.lat}_${currentPos.lng}.jpg`;

      await page.screenshot({ path: filename, type: 'jpeg', quality: 90 });
      console.log(`Captured step ${routeStep}: ${filename}`);
      saveState(routeStep, currentPos);
    }
  }

  console.log('Navigation complete.');
}

run();