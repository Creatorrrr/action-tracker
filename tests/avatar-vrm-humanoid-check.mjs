import {
  createVrmHumanoidMapping,
  parseVrmHumanoid,
} from "../src/vrm-humanoid-mapping.js";

const failures = [];

function check(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function mapFromJson(json) {
  const humanoid = parseVrmHumanoid(json);
  return createVrmHumanoidMapping(humanoid);
}

function vrm1Json(humanBones) {
  return {
    extensions: {
      VRMC_vrm: {
        humanoid: {
          humanBones,
        },
      },
    },
  };
}

function vrm0Json(humanBones) {
  return {
    extensions: {
      VRM: {
        humanoid: {
          humanBones,
        },
      },
    },
  };
}

const vrm1Full = mapFromJson(vrm1Json({
  hips: { node: 0 },
  spine: { node: 1 },
  chest: { node: 2 },
  upperChest: { node: 3 },
  neck: { node: 4 },
  head: { node: 5 },
  leftEye: { node: 6 },
  rightEye: { node: 7 },
  leftUpperArm: { node: 8 },
  leftLowerArm: { node: 9 },
  leftHand: { node: 10 },
  rightUpperArm: { node: 11 },
  rightLowerArm: { node: 12 },
  rightHand: { node: 13 },
  leftUpperLeg: { node: 14 },
  leftLowerLeg: { node: 15 },
  leftFoot: { node: 16 },
  rightUpperLeg: { node: 17 },
  rightLowerLeg: { node: 18 },
  rightFoot: { node: 19 },
  leftThumbMetacarpal: { node: 20 },
  leftThumbProximal: { node: 21 },
  leftThumbDistal: { node: 22 },
  leftIndexProximal: { node: 23 },
  leftIndexIntermediate: { node: 24 },
  leftIndexDistal: { node: 25 },
  leftLittleProximal: { node: 26 },
  jaw: { node: 27 },
}));

check(vrm1Full.version === "vrm1", "VRM1 object humanBones should be detected");
check(vrm1Full.frontAxisSign === 1, "VRM1 front axis should face positive Z");
check(vrm1Full.recommendedModelYawRad === 0, "VRM1 should not receive a default 180 degree model yaw");
check(vrm1Full.mixamoToNode.get("Spine2") === 3, "VRM1 upperChest should map to Spine2");
check(vrm1Full.mixamoToNode.get("LeftEye") === 6, "VRM1 leftEye should map to LeftEye");
check(vrm1Full.mixamoToNode.get("RightEye") === 7, "VRM1 rightEye should map to RightEye");
check(vrm1Full.mixamoToNode.get("LeftHandThumb1") === 20, "VRM1 thumb metacarpal should map to Thumb1");
check(vrm1Full.mixamoToNode.get("LeftHandThumb2") === 21, "VRM1 thumb proximal should map to Thumb2");
check(vrm1Full.mixamoToNode.get("LeftHandThumb3") === 22, "VRM1 thumb distal should map to Thumb3");
check(vrm1Full.mixamoToNode.get("LeftHandPinky1") === 26, "VRM little finger should map to Pinky");
check(vrm1Full.ignoredCanonicals.includes("jaw"), "unsupported VRM canonicals should be reported as ignored");

const vrm1NoUpperChest = mapFromJson(vrm1Json({
  hips: { node: 0 },
  spine: { node: 1 },
  chest: { node: 2 },
}));

check(vrm1NoUpperChest.mixamoToNode.get("Spine1") === 2, "VRM chest should map to Spine1");
check(vrm1NoUpperChest.mixamoToNode.get("Spine2") === 2, "VRM chest should fall back to Spine2 without upperChest");
check(
  vrm1NoUpperChest.fallbackAliases.some((entry) => entry.mixamoName === "Spine2" && entry.canonical === "chest"),
  "upperChest fallback should be reported",
);

const vrm0Thumb = mapFromJson(vrm0Json([
  { bone: "leftThumbProximal", node: 30 },
  { bone: "leftThumbIntermediate", node: 31 },
  { bone: "leftThumbDistal", node: 32 },
  { bone: "rightThumbProximal", node: 33 },
  { bone: "rightThumbIntermediate", node: 34 },
  { bone: "rightThumbDistal", node: 35 },
]));

check(vrm0Thumb.version === "vrm0", "VRM0 array humanBones should be detected");
check(vrm0Thumb.frontAxisSign === -1, "VRM0 front axis should face negative Z");
check(vrm0Thumb.recommendedModelYawRad === Math.PI, "VRM0 should receive a default 180 degree model yaw");
check(vrm0Thumb.mixamoToNode.get("LeftHandThumb1") === 30, "VRM0 thumb proximal should map to Thumb1");
check(vrm0Thumb.mixamoToNode.get("LeftHandThumb2") === 31, "VRM0 thumb intermediate should map to Thumb2");
check(vrm0Thumb.mixamoToNode.get("LeftHandThumb3") === 32, "VRM0 thumb distal should map to Thumb3");
check(vrm0Thumb.mixamoToNode.get("RightHandThumb1") === 33, "VRM0 right thumb proximal should map to Thumb1");

const noVrm = parseVrmHumanoid({ extensions: {} });
check(noVrm === null, "missing VRM humanoid extension should return null");

if (failures.length > 0) {
  console.error(`Avatar VRM humanoid check failed with ${failures.length} issue(s):`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Avatar VRM humanoid check passed.");
