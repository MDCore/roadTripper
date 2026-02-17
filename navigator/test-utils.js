
export const createMockPage = (overrides = {}) => ({
  evaluate: async (fn, args) => {
    return { lat: 40, lng: -74, pano: 'abc', ...overrides.evaluateResult };
  },
  waitForFunction: async () => {},
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