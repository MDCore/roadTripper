if (!global.getPosition) global.getPosition = () => {};
if (!global.getLinks) global.getLinks = () => [];
if (!global.initPanorama) global.initPanorama = () => {};
if (!global.moveToPano) global.moveToPano = () => {};

export const createMockPage = (overrides = {}) => ({
evaluate: async (fn, args) => {
    if (overrides.evaluate) {
      return overrides.evaluate(fn, args);
    }
    return fn(args);
  },  waitForFunction: async () => {},
  waitForLoadState: async () => {},
  waitForTimeout: async () => {},
  screenshot: async () => {},
  ...overrides
});

export const createMockFs = (overrides = {}) => ({
  existsSync: (path) => { return !!path; },
  readFileSync: () => JSON.stringify({ lastStep: 0 }),
  writeFileSync: (path, data) => { return !!path; },
  ...overrides
});

export const createMockProject = (overrides = {}) => ({
      name: 'test',
      stateFile: 'test/navigator_state.json',
      imagePath: 'test/images',
  ...overrides
});

export const mockPosition = (t, implementation) => {
  t.mock.method(global, 'getPosition', implementation);
};

export const mockLinks = (t, implementation) => {
  t.mock.method(global, 'getLinks', implementation);
};