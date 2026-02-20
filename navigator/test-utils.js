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
  readFileSync: () => JSON.stringify({ step: 0 }),
  // eslint-disable-next-line no-unused-vars
  writeFileSync: (path, data) => { return !!path; },
  ...overrides
});

export const createMockProject = (overrides = {}) => ({
      name: 'test',
      stateFile: 'test/navigator_state.json',
      imagePath: 'test/images',
  ...overrides
});