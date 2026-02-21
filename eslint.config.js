import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['planner/', 'client/', 'dist/', 'node_modules/', 'projects/'],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      ...js.configs.recommended.rules
    },
  },
  {
    files: ['navigator/index.js'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        initPanoramaV: 'readonly',
        panorama: 'readonly',
        getCurrentPositionPanoV: 'readonly',
        moveToPanoV: 'readonly',
        getPanoDataV: 'readonly'
      },
    },
  },
];
