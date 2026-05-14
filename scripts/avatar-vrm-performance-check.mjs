#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelPath = process.argv[2] ?? "assets/models/anime-candidates/elel-silverbell.vrm";
const limits = {
  modelBytes: 12_000_000,
  vertices: 60_000,
  bones: 110,
};
const failures = [];

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

check(modelBytes.length <= limits.modelBytes, `${modelPath}: VRM must stay <= ${limits.modelBytes} bytes`);
check(vertices <= limits.vertices, `${modelPath}: vertex count must stay <= ${limits.vertices}`);
check(bones <= limits.bones, `${modelPath}: bone/node count must stay <= ${limits.bones}`);
check(hasVrmExtension, `${modelPath}: expected VRM or VRMC_vrm extension marker`);

const report = {
  modelPath,
  modelBytes: modelBytes.length,
  vertices,
  bones,
  extensions: [...extensions].sort(),
  limits,
};

if (failures.length > 0) {
  console.error(`Avatar VRM performance check failed with ${failures.length} issue(s):`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

console.log("Avatar VRM performance check passed.");
console.log(JSON.stringify(report, null, 2));
