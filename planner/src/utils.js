/**
 * Calculate distance between two points using Haversine formula
 * @param {number} lat1 - Latitude of first point
 * @param {number} lng1 - Longitude of first point
 * @param {number} lat2 - Latitude of second point
 * @param {number} lng2 - Longitude of second point
 * @returns {number} Distance in meters
 */
export function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371e3; // Earth radius in metres
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const dPhi = (lat2 - lat1) * Math.PI / 180;
  const dLambda = (lng2 - lng1) * Math.PI / 180;

  const a = Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) *
    Math.sin(dLambda / 2) * Math.sin(dLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Find the index of the nearest waypoint in a path to a given position
 * @param {Array} path - Array of {lat, lng} waypoints
 * @param {Object} position - {lat, lng} target position
 * @returns {number} Index of nearest waypoint, or -1 if path is empty
 */
export function findNearestWaypointIndex(path, position) {
  if (!path || path.length === 0) return -1;

  let minDistance = Infinity;
  let nearestIndex = 0;

  for (let i = 0; i < path.length; i++) {
    const distance = calculateDistance(
      position.lat,
      position.lng,
      path[i].lat,
      path[i].lng
    );

    if (distance < minDistance) {
      minDistance = distance;
      nearestIndex = i;
    }
  }

  return nearestIndex;
}
