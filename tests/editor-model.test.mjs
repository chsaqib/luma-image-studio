import test from 'node:test';
import assert from 'node:assert/strict';
import { cropPatch, isProjectFile, moveLayerById, PROJECT_FILE_FORMAT } from '../lib/editor-model.js';

test('moves a layer without mutating the input', () => {
  const layers = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(moveLayerById(layers, 'a', 1).map((item) => item.id), ['b', 'a']);
  assert.deepEqual(layers.map((item) => item.id), ['a', 'b']);
});

test('converts a dragged crop rectangle to source crop fractions', () => {
  const item = { x: 0, y: 0, width: 200, height: 100, cropX: 0, cropY: 0 };
  const patch = cropPatch(item, { x: 20, y: 10, width: 160, height: 80 });
  assert.equal(patch.cropLeft, .1);
  assert.equal(patch.cropRight, .1);
  assert.equal(patch.cropTop, .1);
  assert.equal(patch.cropBottom, .1);
});

test('accepts only versioned Luma project files', () => {
  const project = { id: 'p', name: 'Test', layers: [], selectedId: null, updatedAt: 1 };
  assert.equal(isProjectFile({ format: PROJECT_FILE_FORMAT, version: 1, project }), true);
  assert.equal(isProjectFile({ format: 'other', version: 1, project }), false);
});
