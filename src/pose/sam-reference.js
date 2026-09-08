import { MHR70_JOINT_NAMES, MHR70_TO_MEDIAPIPE33 } from "../skeleton/mhr70-mapping.js";
import { MHR70_HAND_TO_MEDIAPIPE21 } from "../skeleton/mhr70-hands.js";
import { buildCanonicalPose, cameraPointToCanonical, captureRawPoseObservation } from "./canonical-pose.js";

// The manifest is mandatory: timestamp_sec in the arms-crossed export starts
// one source frame earlier than the decoder presentation timestamps.
export function createSamReferenceFrame(row, { decoderFrame, clipId, personIndex = 0, mirrored = false } = {}) {
  if (!Number.isInteger(personIndex) || personIndex < 0) throw new Error("Invalid SAM person index");
  if (!decoderFrame || decoderFrame.clipId !== clipId || decoderFrame.sourceFrameIndex !== row.frame_index) {
    throw new Error("SAM reference requires an exact clip/frame decoder manifest match");
  }
  const numerator = decoderFrame.timeBase?.numerator;
  const denominator = decoderFrame.timeBase?.denominator;
  if (!Number.isInteger(numerator) || numerator <= 0 || !Number.isInteger(denominator) || denominator <= 0 ||
      !/^-?\d+$/.test(String(decoderFrame.ptsTicks))) throw new Error("Invalid decoder PTS");
  const ticks = Number(decoderFrame.ptsTicks);
  if (!Number.isSafeInteger(ticks)) throw new Error("Decoder PTS exceeds exact integer range");
  const sourcePtsSec = ticks * numerator / denominator;
  const person = row.persons?.[personIndex] ?? null;
  const width = row.image_size?.width;
  const height = row.image_size?.height;
  if (!(width > 0 && height > 0)) throw new Error("SAM reference requires image dimensions");
  if (person) {
    validateJoints(person.keypoints_mhr70_3d, 3);
    validateJoints(person.keypoints_mhr70_2d, 2);
  }
  const world = person?.keypoints_mhr70_3d.map(([x, y, z]) => ({ x, y, z, visibility: 1 })) ?? null;
  const image = person?.keypoints_mhr70_2d.map(([x, y]) => ({ x: x / width, y: y / height, z: 0, visibility: 1 })) ?? null;
  const body = (values) => values ? Array.from({ length: 33 }, (_, index) =>
    values[MHR70_TO_MEDIAPIPE33[index]] ?? { x: 0, y: 0, z: 0, visibility: 0, presence: 0 }) : null;
  const hand = (values, side) => values ? MHR70_HAND_TO_MEDIAPIPE21[side].map((index) => values[index]) : null;
  const frame = {
    version: 1, timestamp: sourcePtsSec * 1000, mirrored: Boolean(mirrored),
    poseLandmarks: body(image), poseWorldLandmarks: body(world),
    leftHandLandmarks: hand(image, "left"), rightHandLandmarks: hand(image, "right"),
    leftHandWorldLandmarks: hand(world, "left"), rightHandWorldLandmarks: hand(world, "right"),
    face: null,
    sourceMeta: {
      extractor: "sam3d-body", inputKind: "video", sourcePtsSource: "decoder-manifest", clipId, sourceFrameIndex: row.frame_index,
      sourcePtsSec, videoTime: sourcePtsSec,
      ptsTicks: String(decoderFrame.ptsTicks), ptsTimeBaseNumerator: numerator, ptsTimeBaseDenominator: denominator,
      loopEpoch: decoderFrame.loopEpoch ?? 0,
      teacherTimestampSec: row.timestamp_sec,
      timestampCorrectionMs: (sourcePtsSec - row.timestamp_sec) * 1000,
      personIndex, personId: person?.person_id ?? null, personCount: row.persons?.length ?? 0,
      observationStatus: person ? "observed" : "missing", imageWidth: width, imageHeight: height,
      skeletonMode: "canonical-world", hands: "mhr70-to-mediapipe21",
    },
    rawSamObservation: {
      frameIndex: row.frame_index, timestampSec: row.timestamp_sec, imageSize: row.image_size,
      person: person ? JSON.parse(JSON.stringify(person)) : null,
    },
  };
  frame.rawPoseObservation = { ...captureRawPoseObservation(frame), provenance: "sam-reference" };
  frame.canonicalPose = buildCanonicalPose(frame);
  frame.canonicalPose.landmarks[9] = null;
  frame.canonicalPose.landmarks[10] = null;
  frame.canonicalPose.semantics = "mhr70-joint-centres;pose33-finger-slots-are-mcp-proxies";
  frame.canonicalPose.jointsMhr70 = world && frame.canonicalPose.cameraOrigin
    ? Object.fromEntries(MHR70_JOINT_NAMES.map((name, index) => [name,
      cameraPointToCanonical(world[index], frame.canonicalPose.cameraOrigin, mirrored)])) : null;
  frame.canonicalPose.rootTranslation = { status: "unavailable", reason: "sam-camera-convention-pending-verification" };
  return frame;
}

function validateJoints(joints, dimensions) {
  if (!Array.isArray(joints) || joints.length !== 70 || joints.some((joint) =>
    !Array.isArray(joint) || joint.length < dimensions || !joint.slice(0, dimensions).every(Number.isFinite))) {
    throw new Error(`SAM reference requires 70 finite ${dimensions}D joints`);
  }
}
