import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['picker/', 'client/', 'dist/', 'node_modules/', 'projects/'],
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
        initPanorama: 'readonly',
        panorama: 'readonly',
        getPosition: 'readonly',
        getLinks: 'readonly',
        moveToPano: 'readonly',
        getPositionWithMetadata: 'readonly',
      },
    },
  },
];
