import { test, suite } from 'node:test';
import assert from 'node:assert/strict';
import { decideNextAction } from './lib.js';
import { run } from './index.js';
import { createMockPage, createMockFs, createMockProject, mockPosition, mockLinks } from './test-utils.js';

suite('Navigation Logic', () => {
  const dummyRoute = [
    { lat: 40.7128, lng: -74.0060 }, // Start
    { lat: 40.7130, lng: -74.0060 }  // Target (nearby)
  ];

  test('should switch to NEXT_WAYPOINT when close enough', () => {
    const currentPos = { lat: 40.7129, lng: -74.0060 }; // Very close
    const links = [];

    const decision = decideNextAction(currentPos, 0, dummyRoute, links);

    assert.equal(decision.action, 'NEXT_WAYPOINT');
  });

  test('should MOVE to best link when far away', () => {
    const currentPos = { lat: 40.0000, lng: -74.0000 }; // Far away
    const links = [
      { heading: 0, pano: 'correct-pano' },   // North
      { heading: 180, pano: 'wrong-pano' }    // South
    ];
    // Target is North relative to currentPos

    const decision = decideNextAction(currentPos, 0, dummyRoute, links);

    assert.equal(decision.action, 'MOVE');
    assert.equal(decision.link.pano, 'correct-pano');
  });

});

suite('Run Logic', () => {

  test('1 step trip without starting state', async (test) => {
    let screenshotCount = 0;
    const mockPage = createMockPage({
      screenshot: async () => { screenshotCount++; }
    });
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

    mockPosition(test, () => {
      return positions.shift();
    });

    const mockProject = createMockProject({
      route: [{lat:-33.9, lng:18.42}]
    });

    await run(mockProject, { page: mockPage, fs: mockFs });
    assert.equal(screenshotCount, 1);
  });

  test('2 step trip without starting state', async (test) => {
    let screenshotCount = 0;
    const mockPage = createMockPage({
      screenshot: async () => { screenshotCount++; }
    });
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
    mockPosition(test, () => { return positions.shift(); });

    const links = [
      [{ heading: 48, pano: 'abc002' }],
      [{ heading: 48, pano: 'abc003' }, { heading: 228, pano: 'abc001' }],
      [{ heading: 48, pano: 'abc004' }, { heading: 228, pano: 'abc002' }],
      [{ heading: 48, pano: 'abc005' }, { heading: 228, pano: 'abc003' }],
      [{ heading: 48, pano: 'abc006' }, { heading: 228, pano: 'abc004' }],
      [{ heading: 48, pano: 'abc007' }, { heading: 228, pano: 'abc005' }],
      [{ heading: 48, pano: 'abc008' }, { heading: 228, pano: 'abc006' }],
      [{ heading: 48, pano: 'abc009' }, { heading: 228, pano: 'abc007' }],
    ];
    mockLinks(test, () => { return links.shift(); });

    const mockProject = createMockProject({
      route: [{"lat":-33.91512,"lng":18.42272},{"lat":-33.914570000000005,"lng":18.423450000000003}]
    });

    await run(mockProject, { page: mockPage, fs: mockFs });
    assert.equal(screenshotCount, 8);
  });

  // test('3 step trip with starting state on step 2', async (test) => {
  //  const initialState = {
  //     lastStep: 1,
  //     lastPano: 'pano_123',
  //     lastLat: 40.7,
  //     lastLng: -74.0,
  //     lastHeading: 90
  //   };
  //   // 2. Create a spy to capture what gets "saved"
  //   let savedData = null;

  //   const mockFs = createMockFs({
  //     // Mock loading the state
  //     readFileSync: (path) => {
  //         if (path.endsWith('state.json')) {
  //             return JSON.stringify(initialState);
  //         }
  //         return '[]'; // Default for other files
  //     },
  //     // Mock saving the state
  //     writeFileSync: (path, data) => {
  //         if (path.endsWith('state.json')) {
  //             savedData = JSON.parse(data);
  //         }
  //     }
  //   });

  //   const mockPage = createMockPage();
  //   const mockProject = {
  //     name: 'test-project',
  //     stateFile: '/path/to/state.json',
  //     route: Array(10).fill({ lat: 0, lng: 0 }) // Dummy route
  //   };

  //   // 3. Run the function with the mocked fs
  //   await run(mockProject, { fs: mockFs, page: mockPage });

  //   // 4. Assert that the state was saved correctly
  //   assert.ok(savedData, 'State should have been saved');
  //   assert.ok(savedData.lastStep > 5, 'Should have advanced past step 5');

  //   test.skip();
  // });

});

