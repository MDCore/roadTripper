const assert = require('node:assert');
const { test, describe } = require('node:test');
const { calculateBearing, calculateDistance, getBestLink } = require('./lib.js');

describe('Navigator Math', () => {
  test('calculateDistance should be accurate for known points', () => {
    // New York (40.7128, -74.0060) to London (51.5074, -0.1278)
    const dist = calculateDistance(40.7128, -74.0060, 51.5074, -0.1278);
    // Expected roughly 5570 km
    assert.ok(dist > 5500000, `Distance ${dist} too small`);
    assert.ok(dist < 5600000, `Distance ${dist} too large`);
  });

  test('calculateBearing should be correct for cardinal directions', () => {
    // North
    assert.strictEqual(Math.round(calculateBearing(0, 0, 1, 0)), 0);
    // East
    assert.strictEqual(Math.round(calculateBearing(0, 0, 0, 1)), 90);
    // South
    assert.strictEqual(Math.round(calculateBearing(0, 0, -1, 0)), 180);
    // West
    assert.strictEqual(Math.round(calculateBearing(0, 0, 0, -1)), 270);
  });

  test('getBestLink should find the closest heading', () => {
    const links = [
      { heading: 10, pano: 'a' },
      { heading: 100, pano: 'b' },
      { heading: 350, pano: 'c' }
    ];
    
    // Target 0 (North) -> Should pick 350 (diff 10) or 10 (diff 10).
    // Our logic picks the first one with minDiff. 350 -> diff 10. 10 -> diff 10.
    // 350 vs 0 is 10 deg. 10 vs 0 is 10 deg.
    
    const best = getBestLink(links, 0);
    assert.ok(best.pano === 'a' || best.pano === 'c');

    // Target 90 (East) -> Should pick 100
    const bestEast = getBestLink(links, 90);
    assert.strictEqual(bestEast.pano, 'b');
  });

  test('getBestLink should return null if no links within 90 degrees', () => {
    const links = [
      { heading: 180, pano: 'back' }
    ];
    // Target 0 (North) -> 180 is > 90 deg away
    const best = getBestLink(links, 0);
    assert.strictEqual(best, null);
  });
});
