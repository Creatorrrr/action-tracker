#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";

const modelPath = process.argv[2];
const failures = [];
const limits = {
  modelBytes: 3_500_000,
  vertices: 30_000,
  bones: 80,
};

function check(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function parseGlbJson(buffer, label) {
  check(buffer.length >= 20, `${label}: expected a non-empty GLB file`);

  if (buffer.length < 20) {
    return null;
  }

  const magic = buffer.toString("utf8", 0, 4);
  const version = buffer.readUInt32LE(4);
  const declaredLength = buffer.readUInt32LE(8);

  check(magic === "glTF", `${label}: expected glTF binary magic`);
  check(version === 2, `${label}: expected glTF 2.0 binary`);
  check(declaredLength === buffer.length, `${label}: GLB declared length must match file size`);

  if (magic !== "glTF" || version !== 2) {
    return null;
  }

  let offset = 12;

  while (offset + 8 <= buffer.length) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.toString("utf8", offset + 4, offset + 8);
    offset += 8;

    if (offset + chunkLength > buffer.length) {
      failures.push(`${label}: GLB chunk ${chunkType} overruns file length`);
      return null;
    }

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

  failures.push(`${label}: missing GLB JSON chunk`);
  return null;
}

function countVertices(json) {
  return (json.meshes ?? [])
    .flatMap((mesh) => mesh.primitives ?? [])
    .reduce((total, primitive) => {
      const accessor = json.accessors?.[primitive.attributes?.POSITION];
      return total + (accessor?.count ?? 0);
    }, 0);
}

if (!modelPath) {
  console.error("Usage: node scripts/avatar-glb-performance-check.mjs <model.glb>");
  process.exit(1);
}

const absoluteModelPath = path.resolve(modelPath);
const buffer = await readFile(absoluteModelPath);
const json = parseGlbJson(buffer, absoluteModelPath);
const vertices = json ? countVertices(json) : 0;
const bones = (json?.nodes ?? []).filter((node) => /^mixamorig[:]?/.test(node?.name ?? "")).length;

check(buffer.length <= limits.modelBytes, `${modelPath}: file size must stay <= ${limits.modelBytes} bytes`);
check(vertices <= limits.vertices, `${modelPath}: vertex count must stay <= ${limits.vertices}`);
check(bones > 0, `${modelPath}: expected Mixamo-compatible bones`);
check(bones <= limits.bones, `${modelPath}: Mixamo bone count must stay <= ${limits.bones}`);

const report = {
  modelPath,
  bytes: buffer.length,
  vertices,
  bones,
  limits,
};

if (failures.length > 0) {
  console.error(`Avatar GLB performance check failed with ${failures.length} issue(s):`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

console.log("Avatar GLB performance check passed.");
console.log(JSON.stringify(report, null, 2));
