
export const createMockPage = (overrides = {}) => ({
  evaluate: async (fn, args) => {
    if (fn.toString().includes(' => initPanorama')) {
      return true;
    }
    if (fn.toString().includes (' => moveToPano')) {
      return true;
    }
    if (fn.toString().includes (' => getPosition()')) {

    }
    if (fn.toString().includes (' => getLinks')) {
      return [{ lat: 40, lng: -74, pano: 'abc'}];
    }
  },
  waitForFunction: async () => {},
  waitForLoadState: async () => {},
  waitForTimeout: async () => {},
  screenshot: async () => {},
  ...overrides
});

export const createMockFs = (overrides = {}) => ({
  existsSync: (path) => true,
  readFileSync: () => JSON.stringify({ lastStep: 0 }),
  writeFileSync: (path, data) => {},
  ...overrides
});

export const createMockProject = (overrides = {}) => ({
      name: 'test',
      stateFile: 'test/navigator_state.json',
      imagePath: 'test/images',
  ...overrides
});