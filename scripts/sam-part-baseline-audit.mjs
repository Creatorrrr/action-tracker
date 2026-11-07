#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { quaternionSignInvariantAngleDeg } from '../src/avatar-applied-state.js';

const [beforePath, afterPath, outputPath] = process.argv.slice(2);
if (!outputPath) throw new Error('Usage: node scripts/sam-part-baseline-audit.mjs BEFORE_MANIFEST AFTER_MANIFEST OUTPUT');
const inputs = [];
async function read(path) {
  const bytes = await readFile(path);
  inputs.push({ path, sha256: createHash('sha256').update(bytes).digest('hex') });
  return JSON.parse(bytes);
}
const before = await read(beforePath), after = await read(afterPath), checks = [];
const maxVectorDelta = (a, b) => {
  assert.equal(a.length, b.length);
  return Math.max(0, ...a.map((value, i) => Math.abs(value - b[i])));
};
for (const clip of after.clips) {
  const previousClip = before.clips.find(c => c.clipId === clip.clipId);
  assert.ok(previousClip, 'Baseline clip must already exist');
  assert.equal(clip.corpus, previousClip.corpus, 'Instrumentation audit requires identical detector input');
  for (const entry of clip.replays) {
    const previousEntry = previousClip.replays.find(r => r.rig === entry.rig);
    assert.ok(previousEntry);
    const old = await read(previousEntry.path), current = await read(entry.path);
    assert.equal(old.modelUrl, current.modelUrl);
    assert.deepEqual(old.alignment, current.alignment);
    const a = old.results.find(r => r.mode === 'legacy-hybrid').frameRows;
    const b = current.results.find(r => r.mode === 'legacy-hybrid').frameRows;
    assert.equal(a.length, b.length);
    let rotationDeg = 0, positionDelta = 0, rootDelta = 0;
    for (let index = 0; index < a.length; index++) {
      assert.equal(a[index].ptsUs, b[index].ptsUs);
      const x = a[index].appliedAvatarState, y = b[index].appliedAvatarState;
      assert.deepEqual(Object.keys(x.bones), Object.keys(y.bones));
      assert.equal(x.modelHeight, y.modelHeight);
      for (const bone of Object.keys(x.bones)) rotationDeg = Math.max(rotationDeg,
        quaternionSignInvariantAngleDeg(x.bones[bone].localQuaternion, y.bones[bone].localQuaternion));
      for (const key of Object.keys(x.fkEndpoints)) for (const space of ['worldPosition', 'modelLocalPosition']) {
        positionDelta = Math.max(positionDelta, maxVectorDelta(x.fkEndpoints[key][space], y.fkEndpoints[key][space]));
      }
      for (const field of ['position', 'quaternion', 'scale']) rootDelta = Math.max(rootDelta,
        maxVectorDelta(x.root.model[field], y.root.model[field]));
    }
    assert.ok(rotationDeg < 1e-5 && positionDelta < 1e-10 && rootDelta < 1e-10,
      `Instrumentation changed motion: ${clip.label}/${entry.rig}`);
    checks.push({ clip: clip.label, rig: entry.rig, frames: a.length, maximumRotationDeltaDeg: rotationDeg,
      maximumEndpointComponentDelta: positionDelta, maximumRootComponentDelta: rootDelta });
  }
}
await writeFile(outputPath, JSON.stringify({ generatedAt: new Date().toISOString(),
  scope: 'Original baseline versus additive regional readback; this does not test candidate accuracy or runtime', inputs, checks }, null, 2) + '\n');
console.log(`Baseline motion unchanged across ${checks.length} clip/rig pairs and ${checks.reduce((sum, c) => sum + c.frames, 0)} applied states.`);
