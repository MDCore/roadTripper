import assert from 'node:assert';
import { test, describe } from 'node:test';
import { calculateHeading, calculateDistance, getBestLink, createForbiddenPanos, parseImageFilename } from './lib.js';

describe('Navigator Math', () => {
  test('calculateDistance should be accurate for known points', () => {
    // New York (40.7128, -74.0060) to London (51.5074, -0.1278)
    const dist = calculateDistance(40.7128, -74.0060, 51.5074, -0.1278);
    // Expected roughly 5570 km
    assert.ok(dist > 5500000, `Distance ${dist} too small`);
    assert.ok(dist < 5600000, `Distance ${dist} too large`);
  });

  test('calculateHeading should be correct for cardinal directions', () => {
    // North
    assert.strictEqual(Math.round(calculateHeading(0, 0, 1, 0)), 0);
    // East
    assert.strictEqual(Math.round(calculateHeading(0, 0, 0, 1)), 90);
    // South
    assert.strictEqual(Math.round(calculateHeading(0, 0, -1, 0)), 180);
    // West
    assert.strictEqual(Math.round(calculateHeading(0, 0, 0, -1)), 270);
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

describe('createForbiddenPanos', () => {
  test('combines badPanos and recentlyVisitedPanos into all', () => {
    const routeState = {
      badPanos: ['bad1', 'bad2'],
      recentlyVisitedPanos: ['recent1', 'recent2']
    };
    const forbidden = createForbiddenPanos(routeState);

    assert.deepStrictEqual(routeState.badPanos, ['bad1', 'bad2']);
    assert.deepStrictEqual(routeState.recentlyVisitedPanos, ['recent1', 'recent2']);
    assert.deepStrictEqual(forbidden.all, ['bad1', 'bad2', 'recent1', 'recent2']);
  });

  test('returns arrays from routeState', () => {
    const routeState = { badPanos: [], recentlyVisitedPanos: [] };
    const forbidden = createForbiddenPanos(routeState);

    assert.deepStrictEqual(routeState.badPanos, []);
    assert.deepStrictEqual(routeState.recentlyVisitedPanos, []);
    assert.deepStrictEqual(forbidden.all, []);
  });

  test('addBadPano deduplicates', () => {
    const routeState = { badPanos: ['existing'], recentlyVisitedPanos: [] };
    const forbidden = createForbiddenPanos(routeState);

    forbidden.addBadPano('existing');

    assert.deepStrictEqual(routeState.badPanos, ['existing']);
  });

  test('addBadPano adds new pano', () => {
    const routeState = { badPanos: ['existing'], recentlyVisitedPanos: [] };
    const forbidden = createForbiddenPanos(routeState);

    forbidden.addBadPano('new');

    assert.deepStrictEqual(routeState.badPanos, ['existing', 'new']);
  });

  test('addRecentlyVisited moves to front', () => {
    const routeState = { badPanos: [], recentlyVisitedPanos: ['a', 'b', 'c'] };
    const forbidden = createForbiddenPanos(routeState);

    forbidden.addRecentlyVisited('b');

    assert.deepStrictEqual(routeState.recentlyVisitedPanos, ['b', 'a', 'c']);
  });

  test('addRecentlyVisited limits to 10', () => {
    const routeState = { badPanos: [], recentlyVisitedPanos: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'] };
    const forbidden = createForbiddenPanos(routeState);

    forbidden.addRecentlyVisited('new');

    assert.strictEqual(routeState.recentlyVisitedPanos.length, 10);
    assert.strictEqual(routeState.recentlyVisitedPanos[0], 'new');
    assert.strictEqual(routeState.recentlyVisitedPanos[9], '9');
  });

  test('all getter returns fresh array each time', () => {
    const routeState = { badPanos: ['bad1'], recentlyVisitedPanos: ['recent1'] };
    const forbidden = createForbiddenPanos(routeState);

    const all1 = forbidden.all;
    const all2 = forbidden.all;

    assert.notStrictEqual(all1, all2);
    assert.deepStrictEqual(all1, all2);
  });
});

describe('parseImageFilename', () => {
  test('parses standard filename correctly', () => {
    const result = parseImageFilename('2024-01-15 40.712800 -74.006000 2024-01-15 abc123 123.4567.jpg');
    assert.strictEqual(result.pano, 'abc123');
    assert.strictEqual(result.heading, 123.4567);
  });

  test('parses filename with alternate marker', () => {
    const result = parseImageFilename('2024-01-15 40.712800 -74.006000 2024-01-15 abc123 90.0000 alternate.jpg');
    assert.strictEqual(result.pano, 'abc123');
    assert.strictEqual(result.heading, 90.0);
  });

  test('parses filename without .jpg extension', () => {
    const result = parseImageFilename('2024-01-15 40.712800 -74.006000 2024-01-15 panoId 180.5000');
    assert.strictEqual(result.pano, 'panoId');
    assert.strictEqual(result.heading, 180.5);
  });

  test('returns null for invalid filename', () => {
    assert.strictEqual(parseImageFilename('invalid'), null);
    assert.strictEqual(parseImageFilename(''), null);
    assert.strictEqual(parseImageFilename('only-one-part'), null);
  });

  test('handles JPEG extension case-insensitively', () => {
    const result = parseImageFilename('2024-01-15 40.712800 -74.006000 2024-01-15 abc123 45.0000.JPG');
    assert.strictEqual(result.pano, 'abc123');
    assert.strictEqual(result.heading, 45.0);
  });
});
