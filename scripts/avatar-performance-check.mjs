#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

const limits = {
  modelBytes: 3_500_000,
  vertices: 30_000,
  bones: 80,
  updateMedianMs: 1.5,
  updateP95Ms: 3,
  renderMedianMs: 8,
  renderP95Ms: 14,
  validationMedianMs: 1,
  validationP95Ms: 2,
  faceApplyP95Ms: 0.5,
  poseSolverP95Ms: 2,
  performanceSampleLimit: 240,
  defaultDepthScale: 0.5,
  maxDevicePixelRatio: 2,
};

function check(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function checkPattern(source, pattern, message) {
  check(pattern.test(source), message);
}

function numberConstant(source, name) {
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*([0-9.]+)`));
  return match ? Number(match[1]) : NaN;
}

function parseGlbJson(buffer) {
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

  throw new Error("missing GLB JSON chunk");
}

const [packageSource, rendererSource, appSource, modelBytes] = await Promise.all([
  readFile(path.join(projectRoot, "package.json"), "utf8"),
  readFile(path.join(projectRoot, "src/avatar-renderer.js"), "utf8"),
  readFile(path.join(projectRoot, "src/app.js"), "utf8"),
  readFile(path.join(projectRoot, "assets/models/Xbot.glb")),
]);

const packageJson = JSON.parse(packageSource);
const glbJson = parseGlbJson(modelBytes);
const primitives = (glbJson.meshes ?? []).flatMap((mesh) => mesh.primitives ?? []);
const vertices = primitives.reduce((total, primitive) => {
  const accessor = glbJson.accessors?.[primitive.attributes?.POSITION];
  return total + (accessor?.count ?? 0);
}, 0);
const bones = (glbJson.nodes ?? []).filter((node) => /^mixamorig:/.test(node?.name ?? "")).length;
const defaultDepthScale = numberConstant(rendererSource, "DEFAULT_LANDMARK_DEPTH_SCALE");
const performanceSampleLimit = numberConstant(rendererSource, "PERFORMANCE_SAMPLE_LIMIT");
const maxDevicePixelRatio = numberConstant(rendererSource, "MAX_DEVICE_PIXEL_RATIO");

check(modelBytes.length <= limits.modelBytes, `Xbot.glb must stay <= ${limits.modelBytes} bytes`);
check(vertices <= limits.vertices, `Xbot.glb vertex count must stay <= ${limits.vertices}`);
check(bones <= limits.bones, `Xbot.glb Mixamo bone count must stay <= ${limits.bones}`);
check(defaultDepthScale <= limits.defaultDepthScale, "default depth scale must remain conservative");
check(performanceSampleLimit <= limits.performanceSampleLimit, "performance sample window must stay bounded");
check(maxDevicePixelRatio <= limits.maxDevicePixelRatio, "device pixel ratio cap must stay performance-safe");

for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
  check(
    Object.keys(packageJson[field] ?? {}).length === 0,
    `package.json must remain dependency-free for ${field}`,
  );
}

check(packageJson.scripts?.["perf:avatar"] === "node scripts/avatar-performance-check.mjs",
  "package.json must expose perf:avatar");

checkPattern(rendererSource, /PERFORMANCE_BUDGETS_MS\s*=\s*\{[\s\S]*updateMedian:\s*1\.5[\s\S]*updateP95:\s*3[\s\S]*renderMedian:\s*8[\s\S]*renderP95:\s*14[\s\S]*validationMedian:\s*1[\s\S]*validationP95:\s*2/,
  "avatar renderer must declare explicit performance budgets");
checkPattern(rendererSource, /faceApplyP95:\s*0\.5/,
  "avatar renderer must declare the face expression apply budget");
checkPattern(rendererSource, /poseSolverP95:\s*2/,
  "avatar renderer must declare the pose solver budget");
checkPattern(rendererSource, /RETARGET_SMOOTHING_MS\s*=\s*\{[\s\S]*upperArm[\s\S]*foreArm[\s\S]*finger/,
  "avatar renderer must use bone-group smoothing budgets");
checkPattern(rendererSource, /PROPORTION_CALIBRATION_FRAMES\s*=\s*30/,
  "avatar renderer must freeze proportion calibration after a bounded warmup");
checkPattern(rendererSource, /function\s+freezeProportionCalibration\s*\(/,
  "avatar renderer must freeze screen-space proportion calibration");
checkPattern(rendererSource, /function\s+limitTwistFromRest\s*\(/,
  "avatar renderer must limit parent-relative twist");
checkPattern(rendererSource, /function\s+extractTwist\s*\(/,
  "avatar renderer must expose swing/twist decomposition logic");
checkPattern(rendererSource, /function\s+computePalmNormal\s*\(/,
  "avatar renderer must use a palm normal for hand roll");
checkPattern(rendererSource, /function\s+computeLimbPlaneNormals\s*\(/,
  "avatar renderer must use limb plane normals as secondary retarget axes");
checkPattern(rendererSource, /renderer\.toneMapping\s*=\s*THREE\.ACESFilmicToneMapping/,
  "avatar renderer must use ACES tone mapping");
checkPattern(rendererSource, /RoomEnvironment/,
  "avatar renderer must use a low-cost environment light");
checkPattern(rendererSource, /AvatarContactShadow/,
  "avatar renderer must include a low-cost contact shadow");
checkPattern(rendererSource, /getPerformanceSnapshot/,
  "avatar renderer must expose runtime performance snapshots");
checkPattern(appSource, /getAvatarPerformanceReport/,
  "debug API must expose avatar performance reports");

const report = {
  modelBytes: modelBytes.length,
  vertices,
  bones,
  defaultDepthScale,
  performanceSampleLimit,
  maxDevicePixelRatio,
  budgetsMs: {
    updateMedian: limits.updateMedianMs,
    updateP95: limits.updateP95Ms,
    renderMedian: limits.renderMedianMs,
    renderP95: limits.renderP95Ms,
    validationMedian: limits.validationMedianMs,
    validationP95: limits.validationP95Ms,
    faceApplyP95: limits.faceApplyP95Ms,
    poseSolverP95: limits.poseSolverP95Ms,
  },
};

if (failures.length > 0) {
  console.error(`Avatar performance check failed with ${failures.length} issue(s):`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

console.log("Avatar performance check passed.");
console.log(JSON.stringify(report, null, 2));
