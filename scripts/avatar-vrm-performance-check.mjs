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

function parseGlb(buffer, label) {
  check(buffer.length >= 20, `${label}: expected a non-empty GLB/VRM file`);

  const magic = buffer.toString("utf8", 0, 4);
  const version = buffer.readUInt32LE(4);
  const declaredLength = buffer.readUInt32LE(8);

  check(magic === "glTF", `${label}: expected glTF binary magic`);
  check(version === 2, `${label}: expected glTF 2.0 binary`);
  check(declaredLength === buffer.length, `${label}: declared length must match file size`);

  let offset = 12;
  let json = null;
  let binChunk = null;

  while (offset + 8 <= buffer.length) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.toString("utf8", offset + 4, offset + 8);
    offset += 8;

    if (chunkType === "JSON") {
      json = JSON.parse(
        buffer
          .toString("utf8", offset, offset + chunkLength)
          .replace(/\u0000+$/g, "")
          .trim(),
      );
    } else if (chunkType === "BIN\0") {
      binChunk = buffer.subarray(offset, offset + chunkLength);
    }

    offset += chunkLength;
  }

  if (!json) {
    throw new Error(`${label}: missing JSON chunk`);
  }

  return { json, binChunk };
}

function countVertices(json) {
  return (json.meshes ?? [])
    .flatMap((mesh) => mesh.primitives ?? [])
    .reduce((total, primitive) => {
      const accessor = json.accessors?.[primitive.attributes?.POSITION];
      return total + (accessor?.count ?? 0);
    }, 0);
}

const ACCESSOR_COMPONENTS = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT4: 16,
};
const COMPONENT_BYTE_SIZE = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
};

function primitiveList(json) {
  return (json.meshes ?? []).flatMap((mesh) => mesh.primitives ?? []);
}

function countColorPrimitives(json) {
  return primitiveList(json).filter((primitive) => Number.isInteger(primitive.attributes?.COLOR_0)).length;
}

function countZeroAlphaColorPrimitivesFromBin(json, binChunk) {
  const alphaMaxByAccessor = new Map();

  return primitiveList(json).filter((primitive) => {
    const accessorIndex = primitive.attributes?.COLOR_0;

    if (!Number.isInteger(accessorIndex)) {
      return false;
    }

    if (!alphaMaxByAccessor.has(accessorIndex)) {
      alphaMaxByAccessor.set(accessorIndex, readColorAccessorMaxAlpha(json, binChunk, accessorIndex));
    }

    return (alphaMaxByAccessor.get(accessorIndex) ?? 1) <= 1e-6;
  }).length;
}

function readColorAccessorMaxAlpha(json, binChunk, accessorIndex) {
  const accessor = json.accessors?.[accessorIndex];
  const bufferView = json.bufferViews?.[accessor?.bufferView];

  if (!binChunk || !accessor || !bufferView || accessor.type !== "VEC4") {
    return null;
  }

  const componentSize = COMPONENT_BYTE_SIZE[accessor.componentType];
  const componentCount = ACCESSOR_COMPONENTS[accessor.type];
  if (!componentSize || !componentCount) {
    return null;
  }

  const stride = bufferView.byteStride ?? componentSize * componentCount;
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const dataView = new DataView(binChunk.buffer, binChunk.byteOffset, binChunk.byteLength);
  let maxAlpha = -Infinity;

  for (let index = 0; index < accessor.count; index += 1) {
    const alphaOffset = start + index * stride + componentSize * 3;
    const alpha = readAccessorComponent(dataView, alphaOffset, accessor.componentType, accessor.normalized);
    maxAlpha = Math.max(maxAlpha, alpha);
  }

  return maxAlpha;
}

function readAccessorComponent(dataView, byteOffset, componentType, normalized) {
  let value = 0;

  if (componentType === 5120) {
    value = dataView.getInt8(byteOffset);
  } else if (componentType === 5121) {
    value = dataView.getUint8(byteOffset);
  } else if (componentType === 5122) {
    value = dataView.getInt16(byteOffset, true);
  } else if (componentType === 5123) {
    value = dataView.getUint16(byteOffset, true);
  } else if (componentType === 5125) {
    value = dataView.getUint32(byteOffset, true);
  } else if (componentType === 5126) {
    value = dataView.getFloat32(byteOffset, true);
  }

  if (!normalized) {
    return value;
  }

  if (componentType === 5120) {
    return Math.max(value / 127, -1);
  }

  if (componentType === 5121) {
    return value / 255;
  }

  if (componentType === 5122) {
    return Math.max(value / 32767, -1);
  }

  if (componentType === 5123) {
    return value / 65535;
  }

  return value;
}

function secondaryAnimationSummary(json) {
  const secondary = json.extensions?.VRM?.secondaryAnimation;
  const boneGroups = secondary?.boneGroups ?? [];

  return {
    boneGroupCount: boneGroups.length,
    springRootCount: boneGroups.reduce((total, group) => total + (group.bones?.length ?? 0), 0),
    colliderGroupCount: secondary?.colliderGroups?.length ?? 0,
    gravityGroupCount: boneGroups.filter((group) => Number(group.gravityPower) > 0).length,
  };
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
const { json, binChunk } = parseGlb(modelBytes, modelPath);
const extensions = extensionSet(json);
const vertices = countVertices(json);
const bones = (json.nodes ?? []).filter((node) => node?.name && !node.mesh).length;
const hasVrmExtension = extensions.has("VRM") || extensions.has("VRMC_vrm");
const humanoid = parseVrmHumanoid(json);
const mapping = createVrmHumanoidMapping(humanoid);
const secondaryAnimation = secondaryAnimationSummary(json);

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
  colorPrimitives: countColorPrimitives(json),
  zeroAlphaColorPrimitives: countZeroAlphaColorPrimitivesFromBin(json, binChunk),
  secondaryAnimation,
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
