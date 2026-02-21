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

export function createForbiddenPanos(routeState) {
  return {
    addBadPano(pano) {
      if (!routeState.badPanos.includes(pano)) {
        routeState.badPanos.push(pano);
      }
    },
    addRecentlyVisited(pano) {
      const arr = routeState.recentlyVisitedPanos;
      const idx = arr.indexOf(pano);
      if (idx !== -1) arr.splice(idx, 1);
      arr.unshift(pano);
      if (arr.length > 10) arr.pop();
    },
    get all() {
      return [...routeState.badPanos, ...routeState.recentlyVisitedPanos];
    }
  };
}

export function loadState(fs, STATE_FILE, log) {
  if (fs.existsSync(STATE_FILE)) {
    try {
      let state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      if (state) {
        if (!state.route.badPanos) { state.route.badPanos = []; }
        if (!state.route.recentlyVisitedPanos) { state.route.recentlyVisitedPanos = [];
        }
        return state;
      }
    } catch {
      log?.warn('Warning: Could not parse state file. Starting from scratch.');
    }
  }
  return {"position": {"step": 0}, "route": {"recentlyVisitedPanos": [], "badPanos": []} };
}

export function saveState(fs, STATE_FILE, index, position, route, log) {
  const logData = {
    position: {
      step: index,
      pano: position.pano,
      lat: position.lat,
      lng: position.lng,
      heading: position.heading || 0,
      date: position.date || null
    },
    route: {
      recentlyVisitedPanos: route.recentlyVisitedPanos || [],
      badPanos: route.badPanos || [],
    },
  };
  const logState = JSON.stringify(logData);
  log?.info(`Saving state ${logState}`);
  fs.writeFileSync(STATE_FILE, JSON.stringify(logData, null, 2));
}