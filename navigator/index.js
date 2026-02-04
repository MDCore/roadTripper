const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const ROUTE_FILE = path.resolve(__dirname, '../route.json');
const VIEWPORT_FILE = `file://${path.resolve(__dirname, 'viewport.html')}`;

function calculateBearing(lat1, lon1, lat2, lon2) {
  const y = Math.sin((lon2 - lon1) * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180);
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
    Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos((lon2 - lon1) * Math.PI / 180);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function getBestLink(links, targetBearing) {
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
  
  await page.goto(VIEWPORT_FILE);
  
  // Wait for Maps API to load
  await page.waitForFunction(() => window.google && window.google.maps);

  // Initialize Panorama at start of route
  const start = route[0];
  await page.evaluate(({ lat, lng }) => initPanorama(lat, lng), start);
  
  // Navigation Loop
  for (let i = 1; i < route.length; i++) {
    const target = route[i];
    const current = await page.evaluate(() => getPosition());
    const targetBearing = calculateBearing(current.lat, current.lng, target.lat, target.lng);
    
    const links = await page.evaluate(() => getLinks());
    const bestLink = getBestLink(links, targetBearing);
    
    if (bestLink) {
      await page.evaluate((panoId) => moveToPano(panoId), bestLink.pano);
      
      // Wait for network to be idle (tiles loaded)
      await page.waitForLoadState('networkidle');
      // Additional safety wait
      await page.waitForTimeout(1000);
      
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
