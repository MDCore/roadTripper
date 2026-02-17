export function calculateHeading(lat1, lon1, lat2, lon2) {
  const y = Math.sin((lon2 - lon1) * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180);
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
    Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos((lon2 - lon1) * Math.PI / 180);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export function calculateDistance(lat1, lon1, lat2, lon2) {
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

export function getBestLink(links, targetHeading) {
  if (!links || links.length === 0) return null;
  let closestLink = null;
  let minDiff = 360;

  for (const link of links) {
    let diff = Math.abs(link.heading - targetHeading);
    if (diff > 180) diff = 360 - diff;

    // Threshold: Don't pick a link that is more than 90 degrees away from our target
    if (diff < minDiff && diff < 90) {
      minDiff = diff;
      closestLink = link;
    }
  }
  return closestLink;
}

export function loadState(fs, STATE_FILE) {
  if (fs.existsSync(STATE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    } catch {
      console.warn('Warning: Could not parse state file. Starting from scratch.');
    }
  }
  return { "step": 0 }
}

export function saveState(fs, STATE_FILE, index, position) {
  const logState = JSON.stringify({
    step: index,
    pano: position.pano,
    lat: position.lat,
    lng: position.lng,
    heading: position.heading || 0,
    imageDate: position.imageDate || null
  });
  console.log(`Saving state ${logState}`);
  fs.writeFileSync(STATE_FILE, JSON.stringify({
    step: index,
    pano: position.pano,
    lat: position.lat,
    lng: position.lng,
    heading: position.heading || 0,
    imageDate: position.imageDate || null
  }, null, 2));
}

export function decideNextAction(positionition, targetStep, route, links) {
  const nextPoint = route[targetStep + 1];
  if (!nextPoint) return { action: 'FINISH' };

  const dist = calculateDistance(positionition.lat, positionition.lng, nextPoint.lat, nextPoint.lng);

  // Logic: Reached waypoint?
  if (dist < 25) {
    return { action: 'NEXT_WAYPOINT', distance: dist };
  }

  // Logic: Move to next pano
  const heading = calculateHeading(positionition.lat, positionition.lng, nextPoint.lat, nextPoint.lng);
  const bestLink = getBestLink(links, heading);

  if (bestLink) {
    return { action: 'MOVE', link: bestLink, heading: heading, distance: dist };
  }

  return { action: 'NO_LINK', heading: heading, distance: dist };
}