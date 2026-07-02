#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  applyVrmExpressionScores,
  mapMediaPipeBlendShapesToVrmPresets,
  parseVrmExpressionMetadata,
  resolveVrmExpressionTargets,
  summarizeVrmExpressionMapping,
} from "../src/vrm-expression-mapping.js";

function vrm1Json() {
  return {
    extensions: {
      VRMC_vrm: {
        expressions: {
          preset: {
            blinkLeft: {
              morphTargetBinds: [{ node: 1, index: 0, weight: 1 }],
            },
            aa: {
              morphTargetBinds: [{ node: 1, index: 1, weight: 0.6 }],
            },
            happy: {
              morphTargetBinds: [{ node: 2, index: 0, weight: 0.75 }],
            },
            lookUp: {
              morphTargetBinds: [{ node: 2, index: 1, weight: 1 }],
            },
          },
        },
      },
    },
  };
}

function vrm0Json() {
  return {
    nodes: [
      { name: "Face", mesh: 0 },
      { name: "Eyes", mesh: 1 },
    ],
    extensions: {
      VRM: {
        blendShapeMaster: {
          blendShapeGroups: [
            { name: "A", presetName: "a", binds: [{ mesh: 0, index: 3, weight: 100 }] },
            { name: "Blink_L", presetName: "blink_l", binds: [{ mesh: 1, index: 2, weight: 50 }] },
            { name: "Joy", presetName: "joy", binds: [{ mesh: 0, index: 4, weight: 80 }] },
            { name: "Unknown", presetName: "custom_fun", binds: [{ mesh: 0, index: 5, weight: 100 }] },
          ],
        },
      },
    },
  };
}

const vrm1Metadata = parseVrmExpressionMetadata(vrm1Json());
assert.equal(vrm1Metadata.version, "vrm1");
assert.equal(vrm1Metadata.presets.blinkLeft.binds[0].nodeIndex, 1);
assert.equal(vrm1Metadata.presets.aa.binds[0].weight, 0.6);

const vrm0Metadata = parseVrmExpressionMetadata(vrm0Json());
assert.equal(vrm0Metadata.version, "vrm0");
assert.equal(vrm0Metadata.presets.aa.binds[0].nodeIndex, 0);
assert.equal(vrm0Metadata.presets.blinkLeft.binds[0].nodeIndex, 1);
assert.equal(vrm0Metadata.presets.happy.binds[0].weight, 0.8);
assert.equal(vrm0Metadata.ignoredPresets.includes("custom_fun"), true);

const meshA = { uuid: "mesh-a", morphTargetInfluences: [0, 0, 0] };
const meshB = { uuid: "mesh-b", morphTargetInfluences: [0, 0] };
const mapping = await resolveVrmExpressionTargets(vrm1Metadata, {
  getNodeObject: async (nodeIndex) => {
    if (nodeIndex === 1) {
      return meshA;
    }

    if (nodeIndex === 2) {
      return meshB;
    }

    return null;
  },
});

assert.equal(mapping.version, "vrm1");
assert.equal(mapping.resolvedMorphTargetCount, 4);
assert.equal(summarizeVrmExpressionMapping(mapping).expressionPresetCount, 4);

let scores = mapMediaPipeBlendShapesToVrmPresets([
  { name: "eyeBlinkLeft", score: 0.5 },
  { name: "jawOpen", score: 0.8 },
  { name: "mouthSmileLeft", score: 0.3 },
  { name: "mouthSmileRight", score: 0.7 },
  { name: "eyeLookUpLeft", score: 0.4 },
  { name: "eyeLookUpRight", score: 0.6 },
  { name: "unknownShape", score: 1 },
]);
assert.equal(scores.blinkLeft, 0.5);
assert.equal(scores.aa, 0.8);
assert.equal(scores.happy, 0.7);
assert.equal(scores.lookUp, 0.6);
assert.equal(scores.unknownShape, undefined);

let state = {};
state = applyVrmExpressionScores(mapping, scores, state, 1);
assert.equal(meshA.morphTargetInfluences[0], 0.5);
assert.equal(meshA.morphTargetInfluences[1], 0.48);
assert.equal(meshB.morphTargetInfluences[0], 0.5249999999999999);
assert.equal(meshB.morphTargetInfluences[1], 0.6);

state = applyVrmExpressionScores(mapping, {}, state, 1);
assert.equal(meshA.morphTargetInfluences[0], 0);
assert.equal(meshA.morphTargetInfluences[1], 0);
assert.equal(meshB.morphTargetInfluences[0], 0);
assert.equal(meshB.morphTargetInfluences[1], 0);

console.log("Avatar VRM expression check passed.");
