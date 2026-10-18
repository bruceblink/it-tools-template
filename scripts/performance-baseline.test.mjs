import assert from 'node:assert/strict';
import test from 'node:test';
import { routeCases, summarizePlatform } from './performance-baseline/runtime.mjs';

function makeSample({ inputFillMs, outputUpdateMs, durationMs }) {
  const routeTimings = Object.fromEntries(routeCases.map(route => [route.id, 100]));
  return {
    startupMs: 100,
    processGroup: {
      normalizedIdleCpuPercent: 0.25,
      afterIdle: { workingSetBytes: 500, privateBytes: 400 },
    },
    rendererHeap: { usedBytes: 300 },
    routeOpenMs: {
      firstOpen: routeTimings,
      warmOpen: routeTimings,
      interactions: {
        jsonTransform: [{ name: 'stress', inputFillMs, outputUpdateMs, durationMs }],
        regexMatch: { durationMs: 50 },
        mathEvaluation: { durationMs: 60 },
      },
    },
  };
}

test('summarizes JSON input fill and output update timing separately', () => {
  const summary = summarizePlatform([
    makeSample({ inputFillMs: 40, outputUpdateMs: 60, durationMs: 100 }),
    makeSample({ inputFillMs: 20, outputUpdateMs: 80, durationMs: 100 }),
    makeSample({ inputFillMs: 100, outputUpdateMs: 50, durationMs: 150 }),
  ], [{ name: 'stress' }]);

  assert.deepEqual(summary.interactions['json.stress'], {
    samples: 3,
    median: 100,
    p95: 150,
  });
  assert.deepEqual(summary.interactions.jsonInputFill.stress, {
    samples: 3,
    median: 40,
    p95: 100,
  });
  assert.deepEqual(summary.interactions.jsonOutputUpdate.stress, {
    samples: 3,
    median: 60,
    p95: 80,
  });
});
