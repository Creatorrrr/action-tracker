#!/usr/bin/env node
import {
  describeVertexColorAlpha,
  sanitizeZeroAlphaVertexColors,
} from "../src/vrm-rendering-compat.js";

const failures = [];

function check(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function colorAttribute(array, itemSize = 4) {
  return {
    array,
    count: array.length / itemSize,
    itemSize,
  };
}

const zeroAlphaColor = colorAttribute(new Float32Array([
  1, 0, 0, 0,
  0.5, 0.25, 0, 0,
  0, 0.2, 0, 0,
]));

const usefulAlphaColor = colorAttribute(new Float32Array([
  1, 1, 1, 1,
  0.5, 0.5, 0.5, 0.75,
]));

const zeroAlphaDescription = describeVertexColorAlpha(zeroAlphaColor);
check(zeroAlphaDescription.hasAlpha === true, "zero-alpha VEC4 color should report alpha support");
check(zeroAlphaDescription.maxAlpha === 0, "zero-alpha VEC4 color should report maxAlpha 0");
check(zeroAlphaDescription.allAlphaZero === true, "zero-alpha VEC4 color should report allAlphaZero true");

const usefulAlphaDescription = describeVertexColorAlpha(usefulAlphaColor);
check(usefulAlphaDescription.allAlphaZero === false, "useful-alpha VEC4 color should not report allAlphaZero");

const materialA = { vertexColors: true, needsUpdate: false };
const materialB = { vertexColors: true, needsUpdate: false };
const mesh = {
  isMesh: true,
  name: "ZeroAlphaMesh",
  geometry: {
    attributes: {
      color: zeroAlphaColor,
    },
  },
  material: [materialA, materialB],
};

const sanitizeResult = sanitizeZeroAlphaVertexColors({
  traverse(callback) {
    callback(mesh);
  },
});

check(sanitizeResult.meshesChecked === 1, "zero-alpha mesh should count as checked");
check(sanitizeResult.sanitizedMeshes === 1, "zero-alpha mesh should count as sanitized");
check(sanitizeResult.sanitizedMaterials === 2, "zero-alpha mesh should sanitize both materials");
check(materialA.vertexColors === false, "first zero-alpha material should disable vertexColors");
check(materialB.vertexColors === false, "second zero-alpha material should disable vertexColors");
check(materialA.needsUpdate === true, "first zero-alpha material should be marked for update");
check(materialB.needsUpdate === true, "second zero-alpha material should be marked for update");

const safeMaterial = { vertexColors: true, needsUpdate: false };
const safeMesh = {
  isMesh: true,
  geometry: {
    attributes: {
      color: usefulAlphaColor,
    },
  },
  material: safeMaterial,
};

const safeResult = sanitizeZeroAlphaVertexColors({
  traverse(callback) {
    callback(safeMesh);
  },
});

check(safeResult.sanitizedMeshes === 0, "useful-alpha mesh should not count as sanitized");
check(safeMaterial.vertexColors === true, "useful-alpha material should keep vertexColors enabled");
check(safeMaterial.needsUpdate === false, "useful-alpha material should not be marked for update");

if (failures.length > 0) {
  console.error(`VRM rendering compatibility check failed with ${failures.length} issue(s):`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("VRM rendering compatibility check passed.");
