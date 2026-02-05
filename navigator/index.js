const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const ROUTE_FILE = path.resolve(__dirname, '../route.json');
const VIEWPORT_FILE = `file://${path.resolve(__dirname, 'viewport.html')}`;
const STEP_DELAY = parseInt(process.env.NAVIGATOR_STEP_DELAY || '5000', 10);

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
  const start = route[0];
  const next = route[1];
  const initialBearing = next ? calculateBearing(start.lat, start.lng, next.lat, next.lng) : 0;
  await page.evaluate(({ lat, lng, heading }) => initPanorama(lat, lng, heading), { ...start, heading: initialBearing });

  // Wait for panorama to be ready
  await page.waitForFunction(() => typeof panorama !== 'undefined' && panorama.getPosition());

  // Navigation Loop
  for (let i = 1; i < route.length; i++) {
    const target = route[i];
    const current = await page.evaluate(() => getPosition());

    if (!current) {
      console.error('Error: Lost panorama position. Skipping to next step or exiting.');
      continue;
    }

    const targetBearing = calculateBearing(current.lat, current.lng, target.lat, target.lng);

    const links = await page.evaluate(() => getLinks());
    const bestLink = getBestLink(links, targetBearing);

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
      console.log(`Captured: ${filename}`);
    }
  }

  console.log('Navigation complete.');
}

run();