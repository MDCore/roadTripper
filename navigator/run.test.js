import { test, suite } from 'node:test';
import assert from 'node:assert/strict';
import { run } from './index.js';
import { createMockFs, createMockProject } from './test-utils.js';

suite('Run Logic', () => {

  test('1 step trip without starting state', async () => {
    let screenshotCount = 0;

    const mockFs = createMockFs({
      existsSync: (path) => {
        if (!path) { path = "" }
        if (path.endsWith('navigator_state.json')) {
            return false;
        }
        return true;
      }
    });

    const positions = [
      { lat: -33.9, lng: 18.42, pano: 'abc123', heading: 25 }
    ];

    const fetchCurrentPosition = () => positions.shift();
    const fetchPanoData = async () => ({
      lat: -33.9, lng: 18.42, pano: 'abc123', heading: 25,
      description: 'Main Street',
      date: '2024-01',
      links: [],
      times: [{ pano: 'abc123', GA: '2024-01' }]
    });
    const waitForPageReady = async () => {};
    const initializePanorama = async () => {};
    const moveTo = async () => {};

    const mockProject = createMockProject({
      route: [{lat:-33.9, lng:18.42}]
    });

    await run(mockProject, {
      page: { screenshot: async () => { screenshotCount++; } },
      fs: mockFs,
      fetchCurrentPosition,
      fetchPanoData,
      waitForPageReady,
      initializePanorama,
      moveTo
    });
    assert.equal(screenshotCount, 1);
  });

  test('2 step trip without starting state', async () => {
    let screenshotCount = 0;

    const mockFs = createMockFs({
      existsSync: (path) => {
        if (!path) { path = "" }
        if (path.endsWith('navigator_state.json')) {
            return false;
        }
        return true;
      }
    });

    const positions = [
      { lat: -33.91513298854008, lng: 18.42271727547654, pano: 'abc001', heading: 48 },
      { lat: -33.91508539732771, lng: 18.42281534454334, pano: 'abc002', heading: 48 },
      { lat: -33.91502698685937, lng: 18.42290788989344, pano: 'abc003', heading: 48 },
      { lat: -33.91496528216284, lng: 18.42298875390379, pano: 'abc004', heading: 48 },
      { lat: -33.91491436972964, lng: 18.42307957878923, pano: 'abc005', heading: 48 },
      { lat: -33.91486351469865, lng: 18.42316949816615, pano: 'abc006', heading: 48 },
      { lat: -33.91480848394482, lng: 18.42325398436959, pano: 'abc007', heading: 48 },
      { lat: -33.91474879185342, lng: 18.42333512012157, pano: 'abc008', heading: 48 }
    ];

    const fetchCurrentPosition = () => positions.shift();

    const panoDataMap = {
      'abc001': { lat: -33.91513298854008, lng: 18.42271727547654, pano: 'abc001', heading: 48, description: 'Main Street', date: '2024-01', links: [{ heading: 48, pano: 'abc002' }], times: [{ pano: 'abc001', GA: '2024-01' }] },
      'abc002': { lat: -33.91508539732771, lng: 18.42281534454334, pano: 'abc002', heading: 48, description: 'Main Street', date: '2024-01', links: [{ heading: 48, pano: 'abc003' }, { heading: 228, pano: 'abc001' }], times: [{ pano: 'abc002', GA: '2024-01' }] },
      'abc003': { lat: -33.91502698685937, lng: 18.42290788989344, pano: 'abc003', heading: 48, description: 'Main Street', date: '2024-01', links: [{ heading: 48, pano: 'abc004' }, { heading: 228, pano: 'abc002' }], times: [{ pano: 'abc003', GA: '2024-01' }] },
      'abc004': { lat: -33.91496528216284, lng: 18.42298875390379, pano: 'abc004', heading: 48, description: 'Main Street', date: '2024-01', links: [{ heading: 48, pano: 'abc005' }, { heading: 228, pano: 'abc003' }], times: [{ pano: 'abc004', GA: '2024-01' }] },
      'abc005': { lat: -33.91491436972964, lng: 18.42307957878923, pano: 'abc005', heading: 48, description: 'Main Street', date: '2024-01', links: [{ heading: 48, pano: 'abc006' }, { heading: 228, pano: 'abc004' }], times: [{ pano: 'abc005', GA: '2024-01' }] },
      'abc006': { lat: -33.91486351469865, lng: 18.42316949816615, pano: 'abc006', heading: 48, description: 'Main Street', date: '2024-01', links: [{ heading: 48, pano: 'abc007' }, { heading: 228, pano: 'abc005' }], times: [{ pano: 'abc006', GA: '2024-01' }] },
      'abc007': { lat: -33.91480848394482, lng: 18.42325398436959, pano: 'abc007', heading: 48, description: 'Main Street', date: '2024-01', links: [{ heading: 48, pano: 'abc008' }, { heading: 228, pano: 'abc006' }], times: [{ pano: 'abc007', GA: '2024-01' }] },
      'abc008': { lat: -33.91474879185342, lng: 18.42333512012157, pano: 'abc008', heading: 48, description: 'Main Street', date: '2024-01', links: [{ heading: 48, pano: 'abc009' }, { heading: 228, pano: 'abc007' }], times: [{ pano: 'abc008', GA: '2024-01' }] },
      'abc009': { lat: -33.914570000000005, lng: 18.423450000000003, pano: 'abc009', heading: 48, description: 'Main Street', date: '2024-01', links: [], times: [{ pano: 'abc009', GA: '2024-01' }] },
    };

    const fetchPanoData = async (pano) => panoDataMap[pano];
    const waitForPageReady = async () => {};
    const initializePanorama = async () => {};
    const moveTo = async () => {};

    const mockProject = createMockProject({
      route: [{"lat":-33.91512,"lng":18.42272},{"lat":-33.914570000000005,"lng":18.423450000000003}]
    });

    await run(mockProject, {
      page: { screenshot: async () => { screenshotCount++; } },
      fs: mockFs,
      fetchCurrentPosition,
      fetchPanoData,
      waitForPageReady,
      initializePanorama,
      moveTo
    });
    assert.equal(screenshotCount, 8);
  });

  test('screenshot includes "alternate" in filename when an alternative pano is picked', async () => {
    let capturedFilename = null;

    const mockFs = createMockFs({
      existsSync: (path) => {
        if (!path) { path = "" }
        if (path.endsWith('navigator_state.json')) {
            return false;
        }
        return true;
      }
    });

    const positions = [
      { lat: -33.9, lng: 18.42, pano: 'abc123', heading: 25 }
    ];

    const fetchCurrentPosition = () => positions.shift();

    const fetchPanoData = async () => ({
      lat: -33.9, lng: 18.42, pano: 'abc123', heading: 25,
      description: 'Main Street',
      date: '2024-01',
      links: [],
      times: [{ pano: 'abc123', GA: '2024-01' }],
      isAlternate: true
    });
    const waitForPageReady = async () => {};
    const initializePanorama = async () => {};
    const moveTo = async () => {};

    const mockProject = createMockProject({
      route: [{lat:-33.9, lng:18.42}]
    });

    await run(mockProject, {
      page: {
        screenshot: async (opts) => {
          capturedFilename = opts.path;
        }
      },
      fs: mockFs,
      fetchCurrentPosition,
      fetchPanoData,
      waitForPageReady,
      initializePanorama,
      moveTo
    });

    assert.ok(capturedFilename.includes('alternate'), `Expected filename to contain "alternate", got: ${capturedFilename}`);
  });

  test('navigator avoids looping back to recently visited panos', async () => {
    let savedState = null;

    const mockFs = createMockFs({
      existsSync: (path) => {
        if (!path) { path = "" }
        if (path.endsWith('navigator_state.json')) {
            return false;
        }
        return true;
      }
    });

    const positions = [
      { lat: -33.915, lng: 18.422, pano: 'posA', heading: 45 },
      { lat: -33.914, lng: 18.423, pano: 'posB', heading: 45 },
      { lat: -33.913, lng: 18.424, pano: 'posC', heading: 45 },
      { lat: -33.912, lng: 18.425, pano: 'posD', heading: 45 },
      { lat: -33.911, lng: 18.426, pano: 'posE', heading: 45 },
      { lat: -33.911, lng: 18.426, pano: 'posE', heading: 45 },
      { lat: -33.911, lng: 18.426, pano: 'posE', heading: 45 },
      { lat: -33.911, lng: 18.426, pano: 'posE', heading: 45 },
    ];

    const fetchCurrentPosition = () => positions.shift();

    const panoDataMap = {
      'posA': { lat: -33.915, lng: 18.422, pano: 'posA', heading: 45, description: 'Main Street', date: '2024-01', links: [{ heading: 50, pano: 'posB' }], times: [{ pano: 'posA', GA: '2024-01' }] },
      'posB': { lat: -33.914, lng: 18.423, pano: 'posB', heading: 45, description: 'Main Street', date: '2024-01', links: [{ heading: 50, pano: 'posC' }], times: [{ pano: 'posB', GA: '2024-01' }] },
      'posC': { lat: -33.913, lng: 18.424, pano: 'posC', heading: 45, description: 'Main Street', date: '2024-01', links: [{ heading: 40, pano: 'posB' }, { heading: 80, pano: 'posD' }], times: [{ pano: 'posC', GA: '2024-01' }] },
      'posD': { lat: -33.912, lng: 18.425, pano: 'posD', heading: 45, description: 'Main Street', date: '2024-01', links: [{ heading: 50, pano: 'posE' }], times: [{ pano: 'posD', GA: '2024-01' }] },
      'posE': { lat: -33.911, lng: 18.426, pano: 'posE', heading: 45, description: 'Main Street', date: '2024-01', links: [{ heading: 180, pano: 'posF' }], times: [{ pano: 'posE', GA: '2024-01' }] },
      'posF': { lat: -33.912, lng: 18.427, pano: 'posF', heading: 45, description: 'Main Street', date: '2024-01', links: [{ heading: 180, pano: 'posG' }], times: [{ pano: 'posF', GA: '2024-01' }] },
    };

    const fetchPanoData = async (pano) => panoDataMap[pano];
    const waitForPageReady = async () => {};
    const initializePanorama = async () => {};
    const moveTo = async () => {};

    const mockProject = createMockProject({
      route: [
        { lat: -33.915, lng: 18.422 },
        { lat: -33.911, lng: 18.426 }
      ]
    });
    await run(mockProject, {
      page: { screenshot: async () => {} },
      fs: {
        ...mockFs,
        writeFileSync: (path, data) => {
          savedState = JSON.parse(data);
        }
      },
      fetchCurrentPosition,
      fetchPanoData,
      waitForPageReady,
      initializePanorama,
      moveTo
    });

    assert.ok(savedState, 'State should have been saved');
    assert.deepStrictEqual(savedState.route.recentlyVisitedPanos, ['posD', 'posC', 'posB', 'posA'], 'Should have visited A, B, C, D in order');
    assert.strictEqual(savedState.position.pano, 'posE', 'Should have navigated to posE');
  });

});
