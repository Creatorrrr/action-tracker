#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  VRM_FINGER_NAMES,
  createVrmHumanoidMapping,
  parseVrmHumanoid,
  serializeVrmHumanoidMapping,
} from "../src/vrm-humanoid-mapping.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelPath = process.argv.slice(2).find((argument) => !argument.startsWith("--"))
  ?? "assets/models/anime-candidates/polydancer.vrm";
const enforceBudget = process.argv.includes("--enforce-budget");
const limits = {
  modelBytes: 12_000_000,
  vertices: 60_000,
  bones: 110,
};
const failures = [];
const warnings = [];

function check(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function parseGlbJson(buffer, label) {
  check(buffer.length >= 20, `${label}: expected a non-empty GLB/VRM file`);

  const magic = buffer.toString("utf8", 0, 4);
  const version = buffer.readUInt32LE(4);
  const declaredLength = buffer.readUInt32LE(8);

  check(magic === "glTF", `${label}: expected glTF binary magic`);
  check(version === 2, `${label}: expected glTF 2.0 binary`);
  check(declaredLength === buffer.length, `${label}: declared length must match file size`);

  let offset = 12;

  while (offset + 8 <= buffer.length) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.toString("utf8", offset + 4, offset + 8);
    offset += 8;

    if (chunkType === "JSON") {
      return JSON.parse(
        buffer
          .toString("utf8", offset, offset + chunkLength)
          .replace(/\u0000+$/g, "")
          .trim(),
      );
    }

    offset += chunkLength;
  }

  throw new Error(`${label}: missing JSON chunk`);
}

function countVertices(json) {
  return (json.meshes ?? [])
    .flatMap((mesh) => mesh.primitives ?? [])
    .reduce((total, primitive) => {
      const accessor = json.accessors?.[primitive.attributes?.POSITION];
      return total + (accessor?.count ?? 0);
    }, 0);
}

function extensionSet(json) {
  return new Set([
    ...(json.extensionsUsed ?? []),
    ...(json.extensionsRequired ?? []),
    ...Object.keys(json.extensions ?? {}),
  ]);
}

const absoluteModelPath = path.resolve(projectRoot, modelPath);
const modelBytes = await readFile(absoluteModelPath);
const json = parseGlbJson(modelBytes, modelPath);
const extensions = extensionSet(json);
const vertices = countVertices(json);
const bones = (json.nodes ?? []).filter((node) => node?.name && !node.mesh).length;
const hasVrmExtension = extensions.has("VRM") || extensions.has("VRMC_vrm");
const humanoid = parseVrmHumanoid(json);
const mapping = createVrmHumanoidMapping(humanoid);

check(hasVrmExtension, `${modelPath}: expected VRM or VRMC_vrm extension marker`);
check(humanoid !== null, `${modelPath}: expected VRM humanoid humanBones metadata`);
check(
  mapping.missingRequiredBones.length === 0,
  `${modelPath}: missing required humanoid mappings: ${mapping.missingRequiredBones.join(", ")}`,
);

for (const side of ["Left", "Right"]) {
  for (const fingerName of VRM_FINGER_NAMES) {
    const chain = mapping.fingerChains[side]?.[fingerName];

    check(
      (chain?.length ?? 0) >= 3,
      `${modelPath}: expected ${side} ${fingerName} finger chain to map at least 3 segments`,
    );
  }
}

if (modelBytes.length > limits.modelBytes) {
  warnings.push(`${modelPath}: file size exceeds legacy budget ${limits.modelBytes} bytes`);
}

if (vertices > limits.vertices) {
  warnings.push(`${modelPath}: vertex count exceeds legacy budget ${limits.vertices}`);
}

if (bones > limits.bones) {
  warnings.push(`${modelPath}: bone/node count exceeds legacy budget ${limits.bones}`);
}

if (enforceBudget) {
  check(modelBytes.length <= limits.modelBytes, `${modelPath}: VRM must stay <= ${limits.modelBytes} bytes`);
  check(vertices <= limits.vertices, `${modelPath}: vertex count must stay <= ${limits.vertices}`);
  check(bones <= limits.bones, `${modelPath}: bone/node count must stay <= ${limits.bones}`);
}

const report = {
  modelPath,
  modelBytes: modelBytes.length,
  vertices,
  bones,
  extensions: [...extensions].sort(),
  humanoid: serializeVrmHumanoidMapping(mapping),
  limits,
  legacyBudgetEnforced: enforceBudget,
  warnings,
};

if (failures.length > 0) {
  console.error(`Avatar VRM performance check failed with ${failures.length} issue(s):`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

console.log("Avatar VRM compatibility check passed.");
console.log(JSON.stringify(report, null, 2));
