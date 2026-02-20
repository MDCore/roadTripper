import assert from 'node:assert';
import { test, describe } from 'node:test';
import { chooseBestPanoAtPosition } from './index.js';

describe('chooseBestPanoAtPosition', () => {
  test('returns the same panoData when not in badPanos and is latest', async () => {
    const panoData = {
      pano: 'pano_a',
      description: 'Main Street',
      times: [{ pano: 'pano_a', GA: '2024-01' }]
    };
    const badPanos = ['bad_pano'];
    const fetchPanoData = async () => { throw new Error('Should not be called'); };

    const result = await chooseBestPanoAtPosition(panoData, badPanos, fetchPanoData);

    assert.deepStrictEqual(result, panoData);
  });

  test('finds newer good pano when current is in badPanos', async () => {
    const panoData = {
      pano: 'bad_pano',
      description: 'Main Street',
      times: [
        { pano: 'bad_pano', GA: '2023-01' },
        { pano: 'good_pano_1', GA: '2023-06' },
        { pano: 'good_pano_2', GA: '2024-01' }
      ]
    };
    const badPanos = ['bad_pano'];
    const fetchPanoData = async (pano) => {
      return { description: 'Main Street', pano, lat: 1, lng: 2, date: '2024-01', links: [] };
    };

    const result = await chooseBestPanoAtPosition(panoData, badPanos, fetchPanoData);

    assert.strictEqual(result.pano, 'good_pano_2');
  });

  test('returns empty object when all panos are bad', async () => {
    const panoData = {
      pano: 'bad_pano_1',
      description: 'Main Street',
      times: [
        { pano: 'bad_pano_1', GA: '2023-01' },
        { pano: 'bad_pano_2', GA: '2023-06' }
      ]
    };
    const badPanos = ['bad_pano_1', 'bad_pano_2'];
    const fetchPanoData = async () => { throw new Error('Should not be called'); };

    const result = await chooseBestPanoAtPosition(panoData, badPanos, fetchPanoData);

    assert.deepStrictEqual(result, {});
  });

  test('returns empty object when times is empty after filtering', async () => {
    const panoData = {
      pano: 'bad_pano',
      description: 'Main Street',
      times: [{ pano: 'bad_pano', GA: '2023-01' }]
    };
    const badPanos = ['bad_pano'];
    const fetchPanoData = async () => { throw new Error('Should not be called'); };

    const result = await chooseBestPanoAtPosition(panoData, badPanos, fetchPanoData);

    assert.deepStrictEqual(result, {});
  });

  test('switches to latest pano when same road', async () => {
    const panoData = {
      pano: 'old_pano',
      description: 'Main Street',
      times: [
        { pano: 'old_pano', GA: '2023-01' },
        { pano: 'new_pano', GA: '2024-01' }
      ]
    };
    const badPanos = [];
    const fetchPanoData = async (pano) => {
      return { description: 'Main Street', pano, lat: 1, lng: 2, date: '2024-01', links: [] };
    };

    const result = await chooseBestPanoAtPosition(panoData, badPanos, fetchPanoData);

    assert.strictEqual(result.pano, 'new_pano');
  });

  test('stays on current pano when latest is different road', async () => {
    const panoData = {
      pano: 'old_pano',
      description: 'Main Street',
      times: [
        { pano: 'old_pano', GA: '2023-01' },
        { pano: 'different_road_pano', GA: '2024-01' }
      ]
    };
    const badPanos = [];
    const fetchPanoData = async (pano) => {
      if (pano === 'different_road_pano') {
        return { description: 'Different Road', pano, lat: 1, lng: 2, date: '2024-01', links: [] };
      }
      return { description: 'Main Street', pano, lat: 1, lng: 2, date: '2023-01', links: [] };
    };

    const result = await chooseBestPanoAtPosition(panoData, badPanos, fetchPanoData);

    assert.strictEqual(result.pano, 'old_pano');
    assert.strictEqual(result.description, 'Main Street');
  });

  test('skips panos with different description when finding best good pano', async () => {
    const panoData = {
      pano: 'bad_pano',
      description: 'Main Street',
      times: [
        { pano: 'bad_pano', GA: '2023-01' },
        { pano: 'different_road', GA: '2023-06' },
        { pano: 'also_different', GA: '2023-09' },
        { pano: 'good_pano_on_main', GA: '2024-01' }
      ]
    };
    const badPanos = ['bad_pano'];
    const fetchPanoData = async (pano) => {
      if (pano === 'good_pano_on_main') {
        return { description: 'Main Street', pano, lat: 1, lng: 2, date: '2024-01', links: [] };
      }
      return { description: 'Different Road', pano, lat: 1, lng: 2, date: '2023', links: [] };
    };

    const result = await chooseBestPanoAtPosition(panoData, badPanos, fetchPanoData);

    assert.strictEqual(result.pano, 'good_pano_on_main');
  });
});
