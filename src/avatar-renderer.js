import * as THREE from 'three';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  createVrmHumanoidMapping,
  parseVrmHumanoid,
  serializeVrmHumanoidMapping,
} from './vrm-humanoid-mapping.js';
import { solvePoseTargetsFromPoints } from './solver/pose-solver.js';
import {
  DEPTH_CALIBRATION_CLAMP_WARNING_RATIO,
  DEPTH_CALIBRATION_LENGTH_ERROR_THRESHOLD,
  DEPTH_CALIBRATION_MIN_FULL_BODY_SEGMENTS,
  DEPTH_CALIBRATION_MIN_SEGMENT_SAMPLES,
  DEPTH_CALIBRATION_MODE_DYNAMIC,
  DEPTH_CALIBRATION_RUNTIME_P95_BUDGET_MS,
  DEPTH_CALIBRATION_SEGMENTS,
  DEPTH_CALIBRATION_SMOOTHNESS_THRESHOLD,
  DEPTH_CALIBRATION_SOLVE_STEPS,
  DEPTH_CALIBRATION_TARGET_SCORE,
  DEPTH_CALIBRATION_WARMUP_FRAMES,
  bodyScale2D,
  depthCalibrationCoverage,
  estimateCalibrationPoseQuality,
  lengthConsistencyRow,
  normalizeDepthCalibrationMode,
  normalizeDepthCalibrationReferenceProfile,
  resolveDepthCalibrationMinSegments,
  segmentLengthRatio,
  solveDistalDepth,
  summarizeLengthConsistency,
  distance3D,
} from './depth-calibration.js';
import {
  applyVrmExpressionScores,
  mapMediaPipeBlendShapesToVrmPresets,
  parseVrmExpressionMetadata,
  resolveVrmExpressionTargets,
  summarizeVrmExpressionMapping,
} from './vrm-expression-mapping.js';
import {
  HAND_FINGERS,
  getFingerSegmentCount,
  resolveFingerSegmentPoints,
} from './hand-retargeting.js';
import { sanitizeZeroAlphaVertexColors } from './vrm-rendering-compat.js';
import {
  DEFAULT_AVATAR_YAW_SIGN,
  DEFAULT_PALM_NORMAL_SIGNS,
  resolveAvatarYawDeg,
  resolveHandPalmNormal,
} from './retarget-orientation.js';
import {
  RETARGET_MODE_LEGACY,
  RETARGET_MODE_STRICT,
  buildSourceAvatarDivergenceSummary,
  buildStrictRetargetFrame,
  normalizeAvatarRetargetMode,
} from './retarget/skeleton-fk-retarget.js';
import {
  computeFaceHeadDelta,
  createFaceHeadPoseTrackerState,
  readFaceTransformQuaternion,
  resetFaceHeadPoseTrackerState,
  updateFaceHeadPoseTracker,
} from './face-head-pose.js';

const DEFAULT_MODEL_URL = './assets/models/Xbot.glb';
const DEFAULT_XBOT_MODEL_YAW_RAD = 0;
const BONE_PREFIX = 'mixamorig:';
const MAX_DEVICE_PIXEL_RATIO = 2;
const DEFAULT_LANDMARK_DEPTH_SCALE = 0.45;
const FIRST_UPDATE_DELTA_MS = 16.67;
const DEPTH_REFERENCE_SCALE = 1;
const DEPTH_MATCH_THRESHOLD_DEG = 35;
const DEPTH_SALIENT_Z_RATIO = 0.18;
const DEPTH_CALIBRATION_SMOOTHING_MS = 70;
const PROPORTION_CALIBRATION_FRAMES = 30;
const PROPORTION_CALIBRATION_MIN_SEGMENTS = 6;
const PROPORTION_CALIBRATION_MIN_UPPER_BODY_SEGMENTS = 4;
const PROPORTION_CALIBRATION_PERCENTILE = 0.35;
const MIN_BONE_LENGTH_SCALE = 0.72;
const MAX_BONE_LENGTH_SCALE = 1.38;
const MAX_HAND_LENGTH_SCALE = 1.65;
const ROOT_MOTION_CALIBRATION_FRAMES = 12;
const ROOT_MOTION_MIN_SCALE = 0.035;
const ROOT_MOTION_HORIZONTAL_SCALE = 0.9;
const ROOT_MOTION_VERTICAL_SCALE = 0.82;
const ROOT_MOTION_MAX_X_RATIO = 0.28;
const ROOT_MOTION_MAX_Y_RATIO = 0.24;
const ROOT_ORIENTATION_SIDE_ORDER_EPSILON = 0.025;
const ROOT_ORIENTATION_SWITCH_FRAMES = 6;
const ROOT_ORIENTATION_SMOOTHING_MS = 45;
const ROOT_ORIENTATION_MAX_YAW_RATE_DEG_PER_SEC = 540;
const ROOT_ORIENTATION_RECOVERY_SMOOTHING_MS = 18;
const ROOT_ORIENTATION_RECOVERY_MAX_YAW_RATE_DEG_PER_SEC = 1080;
const ROOT_ORIENTATION_SIDE_WIDTH_RATIO = 0.72;
const ROOT_ORIENTATION_NARROW_SIDE_WIDTH_RATIO = 0.52;
const ROOT_ORIENTATION_SIDE_ASPECT_RATIO = 0.18;
const ROOT_ORIENTATION_MIN_WIDTH = 0.025;
const RETARGET_LOW_CONFIDENCE_HOLD = 0.16;
const RETARGET_FULL_CONFIDENCE_VISIBILITY = 0.78;
const RETARGET_OCCLUSION_HOLD_MS = 220;
const RETARGET_OCCLUSION_DECAY_MS = 420;
const RETARGET_LOST_TRACKING_HOLD_MS = 80;
const RETARGET_LOST_TRACKING_DECAY_MS = 360;
const RETARGET_REACQUIRE_BLEND_MS = 180;
const FACE_HEAD_POSE_SMOOTHING_MS = 118;
const FACE_HEAD_POSE_MAX_ANGLE = 0.85;
const FACE_NECK_POSE_MAX_ANGLE = 0.48;
const FACE_HEAD_POSE_STRENGTH = 0.56;
const FACE_NECK_POSE_STRENGTH = 0.24;
const FACE_HEAD_TRACKING_GRACE_MS = 400;
const FACE_HEAD_REACQUIRE_BLEND_MS = 260;
const FACE_HEAD_JUMP_THRESHOLD_DEG_PER_SEC = 600;
const HEAD_CROWN_NOSE_OFFSET_BLEND = 0.72;
const HEAD_CROWN_MAX_NOSE_OFFSET_SCALE = 0.9;
const SPINE_WAVE_MAX_OFFSET_RATIO = 0.08;
const SPINE_WAVE_TWIST_GAIN = 0.32;
const SPINE_WAVE_SIDE_GAIN = 0.12;
const SPINE_WAVE_TWIST_DEADZONE = 0.035;
const SPINE_WAVE_SIDE_DEADZONE_RATIO = 0.018;
const SPINE_WAVE_MIN_CONFIDENCE = 0.45;
const SPINE_WAVE_POINTS = [
  { name: 'spineBase', t: 0.24 },
  { name: 'spineMid', t: 0.52 },
  { name: 'spineUpper', t: 0.76 },
  { name: 'chest', t: 0.9 },
];
const CLAVICLE_ELEVATION_START = 0.12;
const CLAVICLE_ELEVATION_FULL = 0.72;
const CLAVICLE_ELEVATION_OFFSET_RATIO = 0.045;
const CLAVICLE_PROTRACTION_DEADZONE = 0.18;
const CLAVICLE_PROTRACTION_OFFSET_RATIO = 0.035;
const PERFORMANCE_SAMPLE_LIMIT = 240;
const VRM_SPRING_MOTION_THRESHOLD = 0.006;
const VRM_SPRING_MOTION_FULL = 0.035;
const VRM_SPRING_MOTION_MIN_ACTIVE = 0.03;
const VRM_SPRING_ROTATION_MOTION_WEIGHT = 0.012;
const VRM_SPRING_SETTLE_MS = 320;
const VRM_SPRING_MAX_DELTA_SEC = 1 / 30;
const VRM_SPRING_MOTION_BONES = [
  'Hips',
  'Spine',
  'Spine1',
  'Spine2',
  'Neck',
  'Head',
  'LeftArm',
  'LeftForeArm',
  'LeftHand',
  'RightArm',
  'RightForeArm',
  'RightHand',
  'LeftUpLeg',
  'LeftLeg',
  'LeftFoot',
  'RightUpLeg',
  'RightLeg',
  'RightFoot',
];
const PERFORMANCE_BUDGETS_MS = {
  updateMedian: 1.5,
  updateP95: 3,
  renderMedian: 8,
  renderP95: 14,
  validationMedian: 1,
  validationP95: 2,
  faceApplyP95: 0.5,
  poseSolverP95: 2,
};
const FACE_EXPRESSION_SMOOTHING_MS = {
  default: 126,
  blink: 58,
  blinkLeft: 58,
  blinkRight: 58,
  aa: 96,
  ih: 112,
  ou: 112,
  ee: 112,
  oh: 112,
  happy: 168,
  angry: 176,
  sad: 176,
  surprised: 142,
  relaxed: 190,
  lookUp: 132,
  lookDown: 132,
  lookLeft: 132,
  lookRight: 132,
};
const RETARGET_SMOOTHING_MS = {
  torso: 72,
  neck: 92,
  head: 110,
  shoulder: 48,
  upperArm: 34,
  foreArm: 20,
  upperLeg: 44,
  lowerLeg: 40,
  foot: 48,
  hand: 36,
  fingerBase: 44,
  finger: 34,
  relax: 76,
};
const AVATAR_SMOOTHING_MODE_OFF = 'off';
const AVATAR_SMOOTHING_MODE_RETARGET = 'retarget';
const AVATAR_SMOOTHING_MODE_STRONG = 'strong';
const AVATAR_SMOOTHING_ALIASES = {
  off: AVATAR_SMOOTHING_MODE_OFF,
  none: AVATAR_SMOOTHING_MODE_OFF,
  '0': AVATAR_SMOOTHING_MODE_OFF,
  false: AVATAR_SMOOTHING_MODE_OFF,
  retarget: AVATAR_SMOOTHING_MODE_RETARGET,
  on: AVATAR_SMOOTHING_MODE_RETARGET,
  '1': AVATAR_SMOOTHING_MODE_RETARGET,
  true: AVATAR_SMOOTHING_MODE_RETARGET,
  strong: AVATAR_SMOOTHING_MODE_STRONG,
};
const HEAD_NECK_PROFILE_DEFAULTS = {
  default: {
    smoothingScale: 1,
    proportionCalibration: true,
    head: {
      strengthScale: 0.68,
      maxAngleScale: 0.72,
      maxTwistScale: 0.62,
      deadband: THREE.MathUtils.degToRad(2.5),
      hysteresis: THREE.MathUtils.degToRad(1.1),
    },
    neck: {
      strengthScale: 0.64,
      maxAngleScale: 0.72,
      maxTwistScale: 0.58,
      deadband: THREE.MathUtils.degToRad(2),
      hysteresis: THREE.MathUtils.degToRad(0.9),
    },
  },
  anime: {
    smoothingScale: 1.55,
    proportionCalibration: true,
    head: {
      strengthScale: 0.44,
      maxAngleScale: 0.56,
      maxTwistScale: 0.42,
      deadband: THREE.MathUtils.degToRad(4),
      hysteresis: THREE.MathUtils.degToRad(1.8),
    },
    neck: {
      strengthScale: 0.68,
      maxAngleScale: 1,
      maxTwistScale: 0.58,
      deadband: THREE.MathUtils.degToRad(3),
      hysteresis: THREE.MathUtils.degToRad(1.4),
    },
  },
};
const ORBIT_ROTATE_SPEED = 0.006;
const ORBIT_ZOOM_SPEED = 0.0012;
const ORBIT_MIN_POLAR = THREE.MathUtils.degToRad(12);
const ORBIT_MAX_POLAR = THREE.MathUtils.degToRad(168);
const ORBIT_MIN_DISTANCE_SCALE = 0.62;
const ORBIT_MAX_DISTANCE_SCALE = 3.25;

function createEmptyVrmRuntimeState() {
  return {
    available: false,
    version: null,
    springBoneEnabled: false,
    springBoneJointCount: 0,
    colliderCount: 0,
    colliderGroupCount: 0,
    lastUpdateDeltaSec: 0,
    springMotionScore: 0,
    springMotionActivity: 0,
    springPhysicsActive: false,
    springIdleResetCount: 0,
    runtimeUpdateFailed: false,
    updateError: null,
    humanoidAutoUpdate: null,
  };
}

function createEmptyVrmSpringMotionState() {
  return {
    samples: new Map(),
    activity: 0,
    score: 0,
    active: false,
    lastMotionAt: 0,
    idleResetDone: true,
    idleResetCount: 0,
  };
}

const POSE = {
  nose: 0,
  leftEye: 2,
  rightEye: 5,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
};

const REQUIRED_BONES = [
  'Hips',
  'Spine',
  'Spine1',
  'Spine2',
  'Neck',
  'Head',
  'LeftArm',
  'LeftForeArm',
  'LeftHand',
  'RightArm',
  'RightForeArm',
  'RightHand',
  'LeftUpLeg',
  'LeftLeg',
  'LeftFoot',
  'RightUpLeg',
  'RightLeg',
  'RightFoot',
];

const OPTIONAL_FINGER_BONES = [
  'LeftHandThumb1',
  'LeftHandIndex1',
  'LeftHandMiddle1',
  'LeftHandRing1',
  'LeftHandPinky1',
  'RightHandThumb1',
  'RightHandIndex1',
  'RightHandMiddle1',
  'RightHandRing1',
  'RightHandPinky1',
];

const BODY_RETARGETS = [
  { bone: 'Hips', from: 'hipMid', to: 'spineBase', strength: 0.5, maxAngle: 0.75, maxTwist: 0.3, smoothing: 'torso' },
  { bone: 'Spine', from: 'spineBase', to: 'spineMid', strength: 0.75, maxAngle: 0.9, maxTwist: 0.24, smoothing: 'torso' },
  { bone: 'Spine1', from: 'spineMid', to: 'spineUpper', strength: 0.82, maxAngle: 0.92, maxTwist: 0.24, smoothing: 'torso' },
  { bone: 'Spine2', from: 'spineUpper', to: 'chest', strength: 0.9, maxAngle: 0.95, maxTwist: 0.26, smoothing: 'torso' },
  { bone: 'Neck', from: 'chest', to: 'headAimBase', secondaryFrom: 'leftShoulder', secondaryTo: 'rightShoulder', strength: 0.9, maxAngle: 1.05, maxTwist: 0.35, smoothing: 'neck', profileKey: 'neck' },
  { bone: 'Head', from: 'headAimBase', to: 'headCrown', secondaryFrom: 'headAimBase', secondaryTo: 'nose', strength: 0.75, maxAngle: 0.95, maxTwist: 0.38, smoothing: 'head', profileKey: 'head' },
  { bone: 'LeftShoulder', from: 'shoulderMid', to: 'leftClavicle', strength: 0.18, maxAngle: 0.42, maxTwist: 0.2, smoothing: 'shoulder' },
  { bone: 'RightShoulder', from: 'shoulderMid', to: 'rightClavicle', strength: 0.18, maxAngle: 0.42, maxTwist: 0.2, smoothing: 'shoulder' },
  { bone: 'LeftArm', from: 'leftShoulder', to: 'leftElbow', strength: 1, maxAngle: 2.35, maxTwist: 0.65, smoothing: 'upperArm' },
  { bone: 'LeftForeArm', from: 'leftElbow', to: 'leftWrist', strength: 1, maxAngle: 2.45, maxTwist: 0.45, smoothing: 'foreArm' },
  { bone: 'RightArm', from: 'rightShoulder', to: 'rightElbow', strength: 1, maxAngle: 2.35, maxTwist: 0.65, smoothing: 'upperArm' },
  { bone: 'RightForeArm', from: 'rightElbow', to: 'rightWrist', strength: 1, maxAngle: 2.45, maxTwist: 0.45, smoothing: 'foreArm' },
  { bone: 'LeftUpLeg', from: 'leftHip', to: 'leftKnee', strength: 1, maxAngle: 2.05, maxTwist: 0.38, smoothing: 'upperLeg' },
  { bone: 'LeftLeg', from: 'leftKnee', to: 'leftAnkle', strength: 1, maxAngle: 1.95, maxTwist: 0.32, smoothing: 'lowerLeg' },
  { bone: 'LeftFoot', from: 'leftAnkle', to: 'leftFootIndex', secondaryFrom: 'leftHeel', secondaryTo: 'leftFootIndex', strength: 0.7, maxAngle: 1.15, maxTwist: 0.28, smoothing: 'foot' },
  { bone: 'RightUpLeg', from: 'rightHip', to: 'rightKnee', strength: 1, maxAngle: 2.05, maxTwist: 0.38, smoothing: 'upperLeg' },
  { bone: 'RightLeg', from: 'rightKnee', to: 'rightAnkle', strength: 1, maxAngle: 1.95, maxTwist: 0.32, smoothing: 'lowerLeg' },
  { bone: 'RightFoot', from: 'rightAnkle', to: 'rightFootIndex', secondaryFrom: 'rightHeel', secondaryTo: 'rightFootIndex', strength: 0.7, maxAngle: 1.15, maxTwist: 0.28, smoothing: 'foot' },
];

const BODY_VALIDATION_SEGMENTS = [
  { name: 'torso', group: 'torso', bone: 'Spine2', from: 'hipMid', to: 'shoulderMid' },
  { name: 'hips', group: 'torso', bone: 'Hips', from: 'hipMid', to: 'spineBase' },
  { name: 'spine', group: 'torso', bone: 'Spine', from: 'spineBase', to: 'spineMid' },
  { name: 'spine1', group: 'torso', bone: 'Spine1', from: 'spineMid', to: 'spineUpper' },
  { name: 'spine2', group: 'torso', bone: 'Spine2', from: 'spineUpper', to: 'chest' },
  { name: 'chest', group: 'torso', bone: 'Spine2', from: 'chest', to: 'shoulderMid' },
  { name: 'neck', group: 'torso', bone: 'Neck', from: 'chest', to: 'headAimBase' },
  { name: 'head', group: 'head', bone: 'Head', from: 'headAimBase', to: 'headCrown' },
  { name: 'leftUpperArm', group: 'arms', bone: 'LeftArm', from: 'leftShoulder', to: 'leftElbow' },
  { name: 'leftForeArm', group: 'arms', bone: 'LeftForeArm', from: 'leftElbow', to: 'leftWrist' },
  { name: 'rightUpperArm', group: 'arms', bone: 'RightArm', from: 'rightShoulder', to: 'rightElbow' },
  { name: 'rightForeArm', group: 'arms', bone: 'RightForeArm', from: 'rightElbow', to: 'rightWrist' },
  { name: 'leftUpperLeg', group: 'legs', bone: 'LeftUpLeg', from: 'leftHip', to: 'leftKnee' },
  { name: 'leftLowerLeg', group: 'legs', bone: 'LeftLeg', from: 'leftKnee', to: 'leftAnkle' },
  { name: 'rightUpperLeg', group: 'legs', bone: 'RightUpLeg', from: 'rightHip', to: 'rightKnee' },
  { name: 'rightLowerLeg', group: 'legs', bone: 'RightLeg', from: 'rightKnee', to: 'rightAnkle' },
];

const BODY_VISUAL_JOINTS = [
  { name: 'leftShoulder', group: 'torso', source: 'leftShoulder', avatarBone: 'LeftArm' },
  { name: 'rightShoulder', group: 'torso', source: 'rightShoulder', avatarBone: 'RightArm' },
  { name: 'leftElbow', group: 'arms', source: 'leftElbow', avatarBone: 'LeftForeArm' },
  { name: 'rightElbow', group: 'arms', source: 'rightElbow', avatarBone: 'RightForeArm' },
  { name: 'leftWrist', group: 'arms', source: 'leftWrist', avatarBone: 'LeftHand' },
  { name: 'rightWrist', group: 'arms', source: 'rightWrist', avatarBone: 'RightHand' },
  { name: 'leftHip', group: 'torso', source: 'leftHip', avatarBone: 'LeftUpLeg' },
  { name: 'rightHip', group: 'torso', source: 'rightHip', avatarBone: 'RightUpLeg' },
  { name: 'leftKnee', group: 'legs', source: 'leftKnee', avatarBone: 'LeftLeg' },
  { name: 'rightKnee', group: 'legs', source: 'rightKnee', avatarBone: 'RightLeg' },
  { name: 'leftAnkle', group: 'legs', source: 'leftAnkle', avatarBone: 'LeftFoot' },
  { name: 'rightAnkle', group: 'legs', source: 'rightAnkle', avatarBone: 'RightFoot' },
];

const SCREEN_LENGTH_CALIBRATION_SEGMENTS = [
  { bone: 'LeftArm', sourceFrom: 'shoulderMid', sourceTo: 'leftShoulder', avatarFrom: 'shoulderMid', avatarTo: 'leftShoulder' },
  { bone: 'RightArm', sourceFrom: 'shoulderMid', sourceTo: 'rightShoulder', avatarFrom: 'shoulderMid', avatarTo: 'rightShoulder' },
  { bone: 'LeftUpLeg', sourceFrom: 'hipMid', sourceTo: 'leftHip', avatarFrom: 'hipMid', avatarTo: 'leftHip' },
  { bone: 'RightUpLeg', sourceFrom: 'hipMid', sourceTo: 'rightHip', avatarFrom: 'hipMid', avatarTo: 'rightHip' },
  { bone: 'LeftForeArm', sourceFrom: 'leftShoulder', sourceTo: 'leftElbow', avatarFrom: 'leftShoulder', avatarTo: 'leftElbow' },
  { bone: 'RightForeArm', sourceFrom: 'rightShoulder', sourceTo: 'rightElbow', avatarFrom: 'rightShoulder', avatarTo: 'rightElbow' },
  { bone: 'LeftHand', sourceFrom: 'leftElbow', sourceTo: 'leftWrist', avatarFrom: 'leftElbow', avatarTo: 'leftWrist', maxScale: MAX_HAND_LENGTH_SCALE },
  { bone: 'RightHand', sourceFrom: 'rightElbow', sourceTo: 'rightWrist', avatarFrom: 'rightElbow', avatarTo: 'rightWrist', maxScale: MAX_HAND_LENGTH_SCALE },
  { bone: 'LeftLeg', sourceFrom: 'leftHip', sourceTo: 'leftKnee', avatarFrom: 'leftHip', avatarTo: 'leftKnee' },
  { bone: 'RightLeg', sourceFrom: 'rightHip', sourceTo: 'rightKnee', avatarFrom: 'rightHip', avatarTo: 'rightKnee' },
  { bone: 'LeftFoot', sourceFrom: 'leftKnee', sourceTo: 'leftAnkle', avatarFrom: 'leftKnee', avatarTo: 'leftAnkle' },
  { bone: 'RightFoot', sourceFrom: 'rightKnee', sourceTo: 'rightAnkle', avatarFrom: 'rightKnee', avatarTo: 'rightAnkle' },
];

const KNOWN_AVATAR_BONE_NAMES = new Set([
  ...REQUIRED_BONES,
  ...OPTIONAL_FINGER_BONES,
  'LeftShoulder',
  'RightShoulder',
  'LeftEye',
  'RightEye',
  'LeftHandThumb2',
  'LeftHandThumb3',
  'LeftHandThumb4',
  'LeftHandIndex2',
  'LeftHandIndex3',
  'LeftHandIndex4',
  'LeftHandMiddle2',
  'LeftHandMiddle3',
  'LeftHandMiddle4',
  'LeftHandRing2',
  'LeftHandRing3',
  'LeftHandRing4',
  'LeftHandPinky2',
  'LeftHandPinky3',
  'LeftHandPinky4',
  'LeftToeBase',
  'RightHandThumb2',
  'RightHandThumb3',
  'RightHandThumb4',
  'RightHandIndex2',
  'RightHandIndex3',
  'RightHandIndex4',
  'RightHandMiddle2',
  'RightHandMiddle3',
  'RightHandMiddle4',
  'RightHandRing2',
  'RightHandRing3',
  'RightHandRing4',
  'RightHandPinky2',
  'RightHandPinky3',
  'RightHandPinky4',
  'RightToeBase',
]);

const PRIMARY_BONE_CHILD = new Map([
  ['Hips', 'Spine'],
  ['Spine', 'Spine1'],
  ['Spine1', 'Spine2'],
  ['Spine2', 'Neck'],
  ['Neck', 'Head'],
  ['LeftShoulder', 'LeftArm'],
  ['LeftArm', 'LeftForeArm'],
  ['LeftForeArm', 'LeftHand'],
  ['LeftHand', 'LeftHandMiddle1'],
  ['RightShoulder', 'RightArm'],
  ['RightArm', 'RightForeArm'],
  ['RightForeArm', 'RightHand'],
  ['RightHand', 'RightHandMiddle1'],
  ['LeftUpLeg', 'LeftLeg'],
  ['LeftLeg', 'LeftFoot'],
  ['LeftFoot', 'LeftToeBase'],
  ['RightUpLeg', 'RightLeg'],
  ['RightLeg', 'RightFoot'],
  ['RightFoot', 'RightToeBase'],
]);

const tmpVectorA = new THREE.Vector3();
const tmpVectorB = new THREE.Vector3();
const tmpVectorC = new THREE.Vector3();
const tmpVectorD = new THREE.Vector3();
const tmpVectorE = new THREE.Vector3();
const tmpVectorF = new THREE.Vector3();
const tmpVectorG = new THREE.Vector3();
const tmpVectorH = new THREE.Vector3();
const tmpSize = new THREE.Vector2();
const tmpQuaternionA = new THREE.Quaternion();
const tmpQuaternionB = new THREE.Quaternion();
const tmpQuaternionC = new THREE.Quaternion();
const tmpQuaternionD = new THREE.Quaternion();
const tmpQuaternionE = new THREE.Quaternion();
const tmpQuaternionF = new THREE.Quaternion();
const tmpQuaternionG = new THREE.Quaternion();
const tmpQuaternionH = new THREE.Quaternion();
const tmpMatrixA = new THREE.Matrix4();
const tmpMatrixB = new THREE.Matrix4();
const tmpMatrixC = new THREE.Matrix4();
const tmpEulerA = new THREE.Euler();
const tmpSpherical = new THREE.Spherical();

export function createAvatarRenderer(options = {}) {
  const canvas = options.canvas ?? null;
  const statusElement = options.statusElement ?? null;
  const boneCountElement = options.boneCountElement ?? null;
  const modelUrl = options.modelUrl ?? DEFAULT_MODEL_URL;
  const modelLabel = options.modelLabel ?? modelUrl;

  let renderer = null;
  let scene = null;
  let camera = null;
  let model = null;
  let skeletonHelper = null;
  let environmentTexture = null;
  let contactShadow = null;
  let animationFrameId = null;
  let initPromise = null;
  let disposed = false;
  let ready = false;
  let failed = false;
  let lastUpdateTime = 0;
  let lastVrmRenderUpdateTime = 0;
  let skeletonVisible = Boolean(options.showSkeleton);
  let landmarkDepthScale = normalizeDepthScale(options.depthScale ?? DEFAULT_LANDMARK_DEPTH_SCALE);
  let depthCalibrationMode = normalizeDepthCalibrationMode(options.depthCalibrationMode);
  let activeSmoothingMode = normalizeAvatarSmoothingMode(options.smoothingMode);
  let activeRetargetMode = normalizeAvatarRetargetMode(options.retargetMode, RETARGET_MODE_STRICT);
  let anatomyConstraintsEnabled = options.anatomyConstraintsEnabled !== false;
  let orbitControlsAttached = false;
  const orbitCamera = {
    target: new THREE.Vector3(0, 1, 0),
    radius: 3.1,
    minRadius: 1,
    maxRadius: 8,
    theta: 0,
    phi: Math.PI / 2,
    defaultRadius: 3.1,
    defaultTheta: 0,
    defaultPhi: Math.PI / 2,
  };
  const orbitPointer = {
    id: null,
    x: 0,
    y: 0,
  };

  const bones = new Map();
  const boneAliasesByBone = new Map();
  const restPose = new Map();
  const restPoseByBone = new Map();
  const bodyBoneNames = new Set();
  const fingerChains = {
    Left: new Map(),
    Right: new Map(),
  };
  const handOrientation = {
    Left: null,
    Right: null,
  };
  const proportionCalibration = {
    frames: 0,
    frozen: false,
    samples: new Map(),
    lastAppliedCount: 0,
    lastMaxScaleDelta: 0,
    appliedScales: {},
  };
  const depthCalibration = {
    frames: 0,
    frozen: false,
    referenceSamples: new Map(),
    referenceRatios: {},
    referenceRatioSources: {},
    externalReferenceProfile: null,
    externalReferenceRatios: {},
    profileLocked: false,
    previousSegmentDz: new Map(),
    lastSolveDetails: new Map(),
    lastFrameKey: null,
    lastPoints: null,
    lastRawPoints: null,
    lastRows: [],
    lastSummary: summarizeLengthConsistency([]),
    lastClampedRatio: 0,
    lastMode: depthCalibrationMode,
    minimumReferenceSegments: DEPTH_CALIBRATION_MIN_FULL_BODY_SEGMENTS,
    lastCoverage: depthCalibrationCoverage(null),
  };
  const rootMotion = {
    frames: 0,
    frozen: false,
    centerXSum: 0,
    centerYSum: 0,
    scaleSum: 0,
    orientationFrames: 0,
    torsoWidthSum: 0,
    torsoHeightSum: 0,
    baseCenter: null,
    baseScale: 0,
    baseTorsoWidth: 0,
    baseTorsoHeight: 0,
    offset: new THREE.Vector3(),
    baseModelPosition: new THREE.Vector3(),
    baseModelRotationY: 0,
    yawOffset: 0,
    facing: 'front',
    candidateFacing: 'front',
    candidateFacingFrames: 0,
    targetYawOffset: 0,
    orientationMetrics: null,
    maxOffset: new THREE.Vector2(0, 0),
  };
  const poseSolverState = {
    facing: 'front',
    mode: 'lost',
  };
  const strictPoseSolverState = {
    facing: 'front',
    mode: 'lost',
  };
  let strictRetargetState = {};
  let lastStrictRetargetFrame = null;
  let lastSourceAvatarDivergence = null;
  const trackingRecovery = {
    lost: false,
    lastLostAt: 0,
    reacquiredAt: 0,
    blend: 1,
  };
  const poseSolverMetrics = {
    frames: 0,
    hingeViolationFrames: 0,
    maxHingeViolations: 0,
    hingeLimitWarningFrames: 0,
    maxHingeLimitWarnings: 0,
    hingeLimitWarningByName: {},
    maxHingeFlexDegByName: {},
    maxHingeOverflowDegByName: {},
    facingChanges: 0,
    modeChanges: 0,
    occlusionActiveFrames: 0,
    maxOcclusionActiveTargets: 0,
    previousFacing: null,
    previousMode: null,
  };
  const occludedBodyBones = new Map();
  let lastPoseSolverSnapshot = null;
  const faceHeadPose = {
    ...createFaceHeadPoseTrackerState(),
    lastStatus: 'idle',
    lastTracked: false,
    lastWithinGrace: false,
    lastGapMs: null,
    lastReacquireBlend: 0,
    lastLayout: 'unknown',
    lastMatrixDiagnostics: null,
    lastEulerDeg: null,
    lastBoneEulerDeg: null,
    lastBoneAngularVelocityDegPerSec: null,
    lastJumpReason: null,
    jumpCount: 0,
    lastBoneQuaternion: null,
  };
  const performanceStats = {
    updateMs: [],
    renderMs: [],
    validationMs: [],
    depthCalibrationMs: [],
    faceApplyMs: [],
    poseSolverMs: [],
  };
  let activeModelProfile = HEAD_NECK_PROFILE_DEFAULTS.default;
  let activeModelKind = 'default';
  let loadedGltf = null;
  let activeVrm = null;
  let activeVrmRuntime = createEmptyVrmRuntimeState();
  let vrmSpringMotion = createEmptyVrmSpringMotionState();
  let vrmHumanoid = null;
  let vrmHumanoidMapping = null;
  let vrmExpressionMapping = null;
  let faceExpressionScores = {};
  const modelDiagnostics = {
    unresolvedNodeMappings: [],
    renderCompatibility: null,
  };
  let modelHeight = 1;

  async function init() {
    if (disposed) {
      return api;
    }

    if (ready) {
      startAnimationLoop();
      return api;
    }

    if (initPromise) {
      return initPromise;
    }

    initPromise = initInternal().finally(() => {
      initPromise = null;
    });

    return initPromise;
  }

  async function initInternal() {
    try {
      setStatus('Loading avatar');
      setBoneCount(0);
      ensureCanvas(canvas);
      createScene();
      await loadModel();
      if (disposed) {
        return api;
      }
      createSkeletonOverlay();
      await discoverBones();
      if (disposed) {
        return api;
      }
      validateRequiredBones();
      cacheRestPose();
      buildRetargetMaps();
      frameModel();
      resize();
      ready = true;
      failed = false;
      setStatus('Ready');
      setBoneCount(getDiscoveredBoneCount());
      startAnimationLoop();
    } catch (error) {
      if (!disposed) {
        fail(error);
      }
    }

    return api;
  }

  function update({
    motionFrame = null,
    poseResults = null,
    handResults = null,
    mirrored = false,
    timestamp = 0,
  } = {}) {
    if (!ready || failed || disposed) {
      return;
    }

    const startedAt = nowMs();

    try {
      const frame = isMotionFramePayload(motionFrame) ? motionFrame : null;
      const frameTimestamp = frame?.timestamp ?? timestamp;
      const frameMirrored = frame?.mirrored ?? mirrored;
      const delta = updateDelta(frameTimestamp);
      const relaxAlpha = smoothingAlpha(delta, RETARGET_SMOOTHING_MS.relax);
      const poseLandmarks = frame?.poseLandmarks ?? extractPoseLandmarks(poseResults);
      const worldLandmarks = frame?.poseWorldLandmarks ?? extractWorldPoseLandmarks(poseResults);
      const hands = frame ? extractMotionFrameHands(frame) : extractHands(handResults, frameMirrored);

      if (poseLandmarks) {
        applyPose(poseLandmarks, frameMirrored, delta, worldLandmarks, frameTimestamp);
        applyScreenSpaceProportionCalibration(poseLandmarks, frameMirrored);
      } else {
        relaxBody(relaxAlpha * 0.45);
      }

      applyFaceHeadPose(frame?.face ?? null, frameMirrored, delta, frameTimestamp);
      applyHands(hands, frameMirrored, delta);
      applyFaceExpressions(frame?.face ?? null, delta);
    } catch (error) {
      // Bad detector payloads should not break the camera loop.
      console.warn('Avatar update skipped', error);
    } finally {
      recordPerformanceSample(performanceStats.updateMs, nowMs() - startedAt);
    }
  }

  function getBodyValidationSnapshot(options = {}) {
    const startedAt = nowMs();

    try {
      return getBodyValidationSnapshotInternal(options);
    } finally {
      recordPerformanceSample(performanceStats.validationMs, nowMs() - startedAt);
    }
  }

  function getBodyValidationSnapshotInternal({
    motionFrame = null,
    poseResults = null,
    mirrored = false,
    timestamp = 0,
  } = {}) {
    const frame = isMotionFramePayload(motionFrame) ? motionFrame : null;
    const frameTimestamp = frame?.timestamp ?? timestamp;
    const frameMirrored = frame?.mirrored ?? mirrored;

    if (!ready || failed || disposed) {
      return {
        ready: false,
        timestamp: frameTimestamp,
        segments: [],
        summary: summarizeValidationSegments([]),
      };
    }

    const poseLandmarks = frame?.poseLandmarks ?? extractPoseLandmarks(poseResults);
    const worldLandmarks = frame?.poseWorldLandmarks ?? extractWorldPoseLandmarks(poseResults);

    if (!poseLandmarks) {
      return {
        ready: true,
        timestamp: frameTimestamp,
        segments: [],
        summary: summarizeValidationSegments([]),
      };
    }

    model?.updateWorldMatrix(true, true);
    const { points } = getPoseFramePoints(
      poseLandmarks,
      frameMirrored,
      worldLandmarks,
      frameTimestamp,
      FIRST_UPDATE_DELTA_MS,
    );
    const segments = BODY_VALIDATION_SEGMENTS
      .map((segment) => getValidationSegment(segment, points))
      .filter(Boolean);

    return {
      ready: true,
      timestamp: frameTimestamp,
      segments,
      summary: summarizeValidationSegments(segments),
    };
  }

  function getProjectedBodyPoseSnapshot(options = {}) {
    const startedAt = nowMs();

    try {
      return getProjectedBodyPoseSnapshotInternal(options);
    } finally {
      recordPerformanceSample(performanceStats.validationMs, nowMs() - startedAt);
    }
  }

  function getProjectedBodyPoseSnapshotInternal({
    motionFrame = null,
    poseResults = null,
    mirrored = false,
    timestamp = 0,
  } = {}) {
    const frame = isMotionFramePayload(motionFrame) ? motionFrame : null;
    const frameTimestamp = frame?.timestamp ?? timestamp;
    const frameMirrored = frame?.mirrored ?? mirrored;

    if (!ready || failed || disposed || !camera) {
      return {
        ready: false,
        timestamp: frameTimestamp,
        joints: [],
        summary: summarizeVisualJoints([]),
      };
    }

    const poseLandmarks = frame?.poseLandmarks ?? extractPoseLandmarks(poseResults);

    if (!poseLandmarks) {
      return {
        ready: true,
        timestamp: frameTimestamp,
        joints: [],
        summary: summarizeVisualJoints([]),
      };
    }

    model?.updateWorldMatrix(true, true);
    const sourcePoints = buildPosePoints2D(poseLandmarks, frameMirrored);
    const avatarPoints = buildAvatarProjectedPoints();
    const sourceNormalized = normalizePose2D(sourcePoints);
    const avatarNormalized = normalizePose2D(avatarPoints);
    const joints = BODY_VISUAL_JOINTS
      .map((joint) => {
        const source = sourceNormalized.points[joint.source];
        const avatar = avatarNormalized.points[joint.source];

        if (!source || !avatar) {
          return null;
        }

        return {
          name: joint.name,
          group: joint.group,
          source: pointToArray(source),
          avatar: pointToArray(avatar),
          error: distance2D(source, avatar),
        };
      })
      .filter(Boolean);

    return {
      ready: true,
      timestamp: frameTimestamp,
      joints,
      summary: summarizeVisualJoints(joints),
      scale: {
        source: sourceNormalized.scale,
        avatar: avatarNormalized.scale,
      },
    };
  }

  function getDepthValidationSnapshot(options = {}) {
    const startedAt = nowMs();

    try {
      return getDepthValidationSnapshotInternal(options);
    } finally {
      recordPerformanceSample(performanceStats.validationMs, nowMs() - startedAt);
    }
  }

  function getDepthValidationSnapshotInternal({
    motionFrame = null,
    poseResults = null,
    mirrored = false,
    timestamp = 0,
  } = {}) {
    const frame = isMotionFramePayload(motionFrame) ? motionFrame : null;
    const frameTimestamp = frame?.timestamp ?? timestamp;
    const frameMirrored = frame?.mirrored ?? mirrored;

    if (!ready || failed || disposed) {
      return {
        ready: false,
        timestamp: frameTimestamp,
        depthScale: landmarkDepthScale,
        segments: [],
        summary: summarizeDepthValidationSegments([]),
      };
    }

    const poseLandmarks = frame?.poseLandmarks ?? extractPoseLandmarks(poseResults);
    const worldLandmarks = frame?.poseWorldLandmarks ?? extractWorldPoseLandmarks(poseResults);

    if (!poseLandmarks) {
      return {
        ready: true,
        timestamp: frameTimestamp,
        depthScale: landmarkDepthScale,
        segments: [],
        summary: summarizeDepthValidationSegments([]),
      };
    }

    model?.updateWorldMatrix(true, true);
    const poseFrame = getPoseFramePoints(
      poseLandmarks,
      frameMirrored,
      worldLandmarks,
      frameTimestamp,
      FIRST_UPDATE_DELTA_MS,
    );
    const referencePoints = isDynamicDepthCalibrationActive()
      ? poseFrame.points
      : buildPosePoints(poseLandmarks, frameMirrored, {
        depthScale: DEPTH_REFERENCE_SCALE,
        worldLandmarks,
      });
    const flatPoints = buildPosePoints(poseLandmarks, frameMirrored, {
      depthScale: 0,
      worldLandmarks,
    });
    const segments = BODY_VALIDATION_SEGMENTS
      .map((segment) => getDepthValidationSegment(segment, referencePoints, flatPoints))
      .filter(Boolean);

    return {
      ready: true,
      timestamp: frameTimestamp,
      depthScale: landmarkDepthScale,
      referenceDepthScale: isDynamicDepthCalibrationActive() ? landmarkDepthScale : DEPTH_REFERENCE_SCALE,
      selfReferential: isDynamicDepthCalibrationActive() || Math.abs(landmarkDepthScale - DEPTH_REFERENCE_SCALE) < 0.000001,
      measurementMode: isDynamicDepthCalibrationActive()
        ? 'retarget_residual_against_dynamically_calibrated_depth'
        : Math.abs(landmarkDepthScale - DEPTH_REFERENCE_SCALE) < 0.000001
        ? 'retarget_residual_against_same_mediapipe_depth_signal'
        : 'candidate_depth_scale_against_mediapipe_depth_reference',
      depthSource: worldLandmarks ? 'worldLandmarks' : 'landmark.z',
      segments,
      summary: summarizeDepthValidationSegments(segments),
      depthCalibration: getDepthCalibrationSnapshot(),
    };
  }

  function resetPose(options = {}) {
    const preserveCalibration = Boolean(options.preserveCalibration);

    if (!preserveCalibration) {
      resetProportionCalibration();
      resetDepthCalibration();
    }

    resetRootMotion(!preserveCalibration);
    resetPoseSolverMetrics();
    resetPoseSolverState(poseSolverState);
    resetPoseSolverState(strictPoseSolverState);
    strictRetargetState = {};
    lastStrictRetargetFrame = null;
    lastSourceAvatarDivergence = null;
    lastUpdateTime = 0;
    resetTrackingRecoveryState();
    resetBodyOcclusionState();
    resetFaceExpressions();
    resetFaceHeadPose();
    restoreRestPose(1);
    activeVrm?.springBoneManager?.setInitState?.();
    activeVrm?.springBoneManager?.reset?.();
    resetVrmSpringMotionState();
    lastVrmRenderUpdateTime = 0;
  }

  function resetPoseSolverState(targetState) {
    targetState.facing = 'front';
    targetState.mode = 'lost';
    targetState.targetMemory = {};
  }

  function resetView() {
    resetOrbitCamera();
    return getViewState();
  }

  function getViewState() {
    return {
      target: vectorToArray(orbitCamera.target),
      radius: orbitCamera.radius,
      theta: orbitCamera.theta,
      phi: orbitCamera.phi,
    };
  }

  function setDepthScale(value) {
    landmarkDepthScale = normalizeDepthScale(value);
    resetDepthCalibration();
    return landmarkDepthScale;
  }

  function getDepthScale() {
    return landmarkDepthScale;
  }

  function setDepthCalibrationMode(value) {
    depthCalibrationMode = normalizeDepthCalibrationMode(value);
    resetDepthCalibration();
    return depthCalibrationMode;
  }

  function getDepthCalibrationMode() {
    return depthCalibrationMode;
  }

  function setDepthCalibrationReference(profile) {
    const normalizedProfile = normalizeDepthCalibrationReferenceProfile(profile);

    depthCalibration.externalReferenceProfile = normalizedProfile;
    depthCalibration.externalReferenceRatios = { ...normalizedProfile.referenceRatios };
    resetDepthCalibration();
    return getDepthCalibrationSnapshot();
  }

  function clearDepthCalibrationReference() {
    depthCalibration.externalReferenceProfile = null;
    depthCalibration.externalReferenceRatios = {};
    resetDepthCalibration();
    return getDepthCalibrationSnapshot();
  }

  function getPerformanceSnapshot() {
    return {
      budgetsMs: { ...PERFORMANCE_BUDGETS_MS },
      model: {
        kind: activeModelKind,
        proportionCalibration: activeModelProfile.proportionCalibration,
      },
      retargetMode: activeRetargetMode,
      retargetSmoothing: {
        mode: activeSmoothingMode,
        enabled: activeSmoothingMode !== AVATAR_SMOOTHING_MODE_OFF,
        scale: retargetSmoothingScale(),
      },
      samples: {
        update: summarizePerformanceSamples(performanceStats.updateMs),
        render: summarizePerformanceSamples(performanceStats.renderMs),
        validation: summarizePerformanceSamples(performanceStats.validationMs),
        depthCalibration: summarizePerformanceSamples(performanceStats.depthCalibrationMs),
        faceApply: summarizePerformanceSamples(performanceStats.faceApplyMs),
        poseSolver: summarizePerformanceSamples(performanceStats.poseSolverMs),
      },
      depthCalibrationBudgetMs: {
        p95: DEPTH_CALIBRATION_RUNTIME_P95_BUDGET_MS,
      },
      calibration: {
        frames: proportionCalibration.frames,
        frozen: proportionCalibration.frozen,
        appliedSegments: proportionCalibration.lastAppliedCount,
        maxScaleDelta: proportionCalibration.lastMaxScaleDelta,
        appliedScales: { ...proportionCalibration.appliedScales },
      },
      rootMotion: {
        frames: rootMotion.frames,
        frozen: rootMotion.frozen,
        offset: vectorToArray(rootMotion.offset),
        baseCenter: rootMotion.baseCenter ? [rootMotion.baseCenter.x, rootMotion.baseCenter.y] : null,
        baseScale: rootMotion.baseScale,
        baseTorsoWidth: rootMotion.baseTorsoWidth,
        baseTorsoHeight: rootMotion.baseTorsoHeight,
        orientationFrames: rootMotion.orientationFrames,
        yawOffset: rootMotion.yawOffset,
        facing: rootMotion.facing,
        candidateFacing: rootMotion.candidateFacing,
        candidateFacingFrames: rootMotion.candidateFacingFrames,
        targetYawOffset: rootMotion.targetYawOffset,
        orientationMetrics: rootMotion.orientationMetrics,
      },
      handOrientation: { ...handOrientation },
      strictRetarget: lastStrictRetargetFrame,
      sourceAvatarDivergence: getSourceAvatarDivergenceSnapshot(),
      poseSolver: lastPoseSolverSnapshot,
      faceHeadPose: getFaceHeadPoseSnapshot(),
      poseSolverMetrics: getPoseSolverMetricsSnapshot(),
      occlusion: getOcclusionSnapshot(),
      trackingRecovery: getTrackingRecoverySnapshot(),
    };
  }

  function getMotionStateSnapshot() {
    return {
      model: {
        kind: activeModelKind,
        label: modelLabel,
      },
      retargetMode: activeRetargetMode,
      rootMotion: {
        frames: rootMotion.frames,
        frozen: rootMotion.frozen,
        offset: vectorToArray(rootMotion.offset),
        facing: rootMotion.facing,
        candidateFacing: rootMotion.candidateFacing,
        candidateFacingFrames: rootMotion.candidateFacingFrames,
        targetYawOffset: rootMotion.targetYawOffset,
        yawOffset: rootMotion.yawOffset,
        yawOffsetDeg: THREE.MathUtils.radToDeg(rootMotion.yawOffset),
        baseModelRotationY: rootMotion.baseModelRotationY,
        modelRotationY: model?.rotation?.y ?? null,
        orientationMetrics: rootMotion.orientationMetrics,
      },
      handOrientation: { ...handOrientation },
      strictRetarget: lastStrictRetargetFrame,
      sourceAvatarDivergence: getSourceAvatarDivergenceSnapshot(),
      poseSolver: lastPoseSolverSnapshot,
      faceHeadPose: getFaceHeadPoseSnapshot(),
      poseSolverMetrics: getPoseSolverMetricsSnapshot(),
      occlusion: getOcclusionSnapshot(),
      trackingRecovery: getTrackingRecoverySnapshot(),
    };
  }

  function clearPerformanceSamples() {
    performanceStats.updateMs.length = 0;
    performanceStats.renderMs.length = 0;
    performanceStats.validationMs.length = 0;
    performanceStats.depthCalibrationMs.length = 0;
    performanceStats.faceApplyMs.length = 0;
    performanceStats.poseSolverMs.length = 0;
    resetPoseSolverMetrics();
    return getPerformanceSnapshot();
  }

  function setRetargetMode(value) {
    const nextMode = normalizeAvatarRetargetMode(value, activeRetargetMode);

    if (nextMode !== activeRetargetMode) {
      activeRetargetMode = nextMode;
      strictPoseSolverState.facing = 'front';
      strictPoseSolverState.mode = 'lost';
      strictPoseSolverState.targetMemory = {};
      strictRetargetState = {};
      lastStrictRetargetFrame = null;
      lastSourceAvatarDivergence = null;
      resetBodyOcclusionState();
    }

    return activeRetargetMode;
  }

  function getRetargetMode() {
    return activeRetargetMode;
  }

  function setSkeletonVisible(value) {
    skeletonVisible = Boolean(value);

    if (skeletonHelper) {
      skeletonHelper.visible = skeletonVisible;
    }
  }

  function getModelDiagnostics() {
    const requiredMissing = REQUIRED_BONES.filter((name) => !getBone(name));
    const expressionDiagnostics = summarizeVrmExpressionMapping(vrmExpressionMapping);

    return {
      ready,
      failed,
      model: {
        kind: activeModelKind,
        label: modelLabel,
        height: modelHeight,
        proportionCalibration: activeModelProfile.proportionCalibration,
      },
      humanoid: serializeVrmHumanoidMapping(vrmHumanoidMapping),
      expressions: {
        expressionPresetCount: expressionDiagnostics.expressionPresetCount,
        resolvedMorphTargetCount: expressionDiagnostics.resolvedMorphTargetCount,
        missingPresets: expressionDiagnostics.missingPresets,
        version: expressionDiagnostics.version,
        unresolvedBindingCount: expressionDiagnostics.unresolvedBindingCount,
        unresolvedBindings: expressionDiagnostics.unresolvedBindings,
      },
      unresolvedNodeMappings: modelDiagnostics.unresolvedNodeMappings.slice(),
      renderCompatibility: modelDiagnostics.renderCompatibility,
      requiredBones: {
        missing: requiredMissing,
        present: REQUIRED_BONES.filter((name) => getBone(name)),
      },
      eyeBones: {
        present: ['LeftEye', 'RightEye'].filter((name) => getBone(name)),
        missing: ['LeftEye', 'RightEye'].filter((name) => !getBone(name)),
      },
      restPose: buildRestPoseDiagnostics(),
      boneOrientation: buildBoneOrientationDiagnostics(),
      fingerChains: buildCurrentFingerChainReport(),
    };
  }

  function buildRestPoseDiagnostics() {
    const uniqueRestBones = new Set();
    const missingRequired = [];

    for (const name of REQUIRED_BONES) {
      const bone = getBone(name);
      const rest = getBoneRest(bone);

      if (!bone || !rest) {
        missingRequired.push(name);
        continue;
      }

      uniqueRestBones.add(bone);
    }

    return {
      cachedBoneCount: restPoseByBone.size,
      aliasCount: restPose.size,
      requiredCachedCount: uniqueRestBones.size,
      missingRequired,
    };
  }

  function buildBoneOrientationDiagnostics() {
    const byBone = {};
    const missingAimAxes = [];

    for (const name of REQUIRED_BONES) {
      const bone = getBone(name);
      const rest = getBoneRest(bone);
      const axisLocal = rest?.axisLocal ?? null;
      const secondaryAxisLocal = rest?.secondaryAxisLocal ?? null;

      if (!bone || !axisLocal) {
        missingAimAxes.push(name);
      }

      byBone[name] = {
        present: Boolean(bone),
        axisLocal: axisLocal ? vectorToArray(axisLocal) : null,
        secondaryAxisLocal: secondaryAxisLocal ? vectorToArray(secondaryAxisLocal) : null,
        restForwardDot: bone && secondaryAxisLocal ? computeRestSecondaryForwardDot(bone, rest) : null,
      };
    }

    return {
      inferredAxisCount: REQUIRED_BONES.length - missingAimAxes.length,
      missingAimAxes,
      byBone,
    };
  }

  function computeRestSecondaryForwardDot(bone, rest) {
    if (!model || !bone || !rest?.secondaryAxisLocal) {
      return null;
    }

    const parentWorldQuaternion = bone.parent
      ? bone.parent.getWorldQuaternion(tmpQuaternionA)
      : tmpQuaternionA.identity();
    const secondaryWorld = tmpVectorA
      .copy(rest.secondaryAxisLocal)
      .applyQuaternion(rest.quaternion)
      .applyQuaternion(parentWorldQuaternion)
      .normalize();
    const modelForwardWorld = tmpVectorB
      .set(0, 0, 1)
      .applyQuaternion(model.getWorldQuaternion(tmpQuaternionB))
      .normalize();

    return secondaryWorld.dot(modelForwardWorld);
  }

  function buildStrictRigBasis() {
    const byBone = {};

    for (const target of BODY_RETARGETS) {
      const bone = getBone(target.bone);
      const rest = getBoneRest(bone);

      if (!bone || !rest?.axisLocal) {
        continue;
      }

      byBone[target.bone] = {
        restAxis: vectorToArray(rest.axisLocal),
        secondaryAxis: rest.secondaryAxisLocal ? vectorToArray(rest.secondaryAxisLocal) : null,
      };
    }

    return { bones: byBone };
  }

  function resize() {
    if (!renderer || !camera || !canvas || disposed) {
      return;
    }

    const width = Math.max(1, Math.floor(canvas.clientWidth || canvas.width || 1));
    const height = Math.max(1, Math.floor(canvas.clientHeight || canvas.height || 1));
    const current = renderer.getSize(tmpSize);

    if (current.x !== width || current.y !== height) {
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
  }

  function dispose() {
    disposed = true;
    stopAnimationLoop();
    detachOrbitControls();
    ready = false;
    initPromise = null;

    disposeSkeletonHelper();
    disposeContactShadow();
    disposeModelResources(model);
    disposeEnvironmentTexture();
    renderer?.dispose?.();
    renderer = null;
    scene = null;
    camera = null;
    model = null;
    skeletonHelper = null;
    contactShadow = null;
    bones.clear();
    boneAliasesByBone.clear();
    restPose.clear();
    restPoseByBone.clear();
    bodyBoneNames.clear();
    fingerChains.Left.clear();
    fingerChains.Right.clear();
    resetProportionCalibration();
    resetDepthCalibration();
    activeModelProfile = HEAD_NECK_PROFILE_DEFAULTS.default;
    activeModelKind = 'default';
    loadedGltf = null;
    activeVrm = null;
    activeVrmRuntime = createEmptyVrmRuntimeState();
    vrmSpringMotion = createEmptyVrmSpringMotionState();
    lastVrmRenderUpdateTime = 0;
    vrmHumanoid = null;
    vrmHumanoidMapping = null;
    modelDiagnostics.unresolvedNodeMappings = [];
    modelDiagnostics.renderCompatibility = null;
  }

  function getValidationSegment(segment, points) {
    const bone = getBone(segment.bone);
    const rest = getBoneRest(bone);
    const from = points[segment.from];
    const to = points[segment.to];

    if (!bone || !rest || !from || !to) {
      return null;
    }

    const targetDirection = new THREE.Vector3().subVectors(to, from);

    if (targetDirection.lengthSq() < 0.000001) {
      return null;
    }

    const avatarDirection = rest.axisLocal
      .clone()
      .normalize()
      .applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()))
      .normalize();
    const normalizedTargetDirection = targetDirection.normalize();
    const errorDeg = THREE.MathUtils.radToDeg(avatarDirection.angleTo(normalizedTargetDirection));

    return {
      name: segment.name,
      group: segment.group,
      bone: segment.bone,
      from: segment.from,
      to: segment.to,
      errorDeg,
      targetDirection: vectorToArray(normalizedTargetDirection),
      avatarDirection: vectorToArray(avatarDirection),
    };
  }

  function getDepthValidationSegment(segment, referencePoints, flatPoints) {
    const bone = getBone(segment.bone);
    const rest = getBoneRest(bone);
    const referenceFrom = referencePoints[segment.from];
    const referenceTo = referencePoints[segment.to];
    const flatFrom = flatPoints[segment.from];
    const flatTo = flatPoints[segment.to];

    if (!bone || !rest || !referenceFrom || !referenceTo || !flatFrom || !flatTo) {
      return null;
    }

    const targetDirection = new THREE.Vector3().subVectors(referenceTo, referenceFrom);
    const flatDirection = new THREE.Vector3().subVectors(flatTo, flatFrom);

    if (targetDirection.lengthSq() < 0.000001 || flatDirection.lengthSq() < 0.000001) {
      return null;
    }

    const avatarDirection = rest.axisLocal
      .clone()
      .normalize()
      .applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()))
      .normalize();
    const normalizedTargetDirection = targetDirection.clone().normalize();
    const normalizedFlatDirection = flatDirection.clone().normalize();
    const errorDeg = THREE.MathUtils.radToDeg(avatarDirection.angleTo(normalizedTargetDirection));
    const flatSourceErrorDeg = THREE.MathUtils.radToDeg(
      normalizedFlatDirection.angleTo(normalizedTargetDirection),
    );
    const sourceDepthRatio = Math.abs(targetDirection.z) / Math.max(flatDirection.length(), 0.0001);
    const depthSalient = sourceDepthRatio >= DEPTH_SALIENT_Z_RATIO;

    return {
      name: segment.name,
      group: segment.group,
      bone: segment.bone,
      from: segment.from,
      to: segment.to,
      errorDeg,
      flatSourceErrorDeg,
      sourceDepthRatio,
      sourceDepthDelta: targetDirection.z,
      depthSalient,
      matched: errorDeg <= DEPTH_MATCH_THRESHOLD_DEG,
      matchThresholdDeg: DEPTH_MATCH_THRESHOLD_DEG,
      targetDirection: vectorToArray(normalizedTargetDirection),
      flatDirection: vectorToArray(normalizedFlatDirection),
      avatarDirection: vectorToArray(avatarDirection),
    };
  }

  function buildAvatarProjectedPoints() {
    const points = Object.fromEntries(
      BODY_VISUAL_JOINTS.map((joint) => [
        joint.source,
        projectBonePoint(getBone(joint.avatarBone)),
      ]),
    );

    points.shoulderMid = midpoint2D(points.leftShoulder, points.rightShoulder);
    points.hipMid = midpoint2D(points.leftHip, points.rightHip);

    return points;
  }

  function projectBonePoint(bone) {
    if (!bone || !camera) {
      return null;
    }

    const projected = bone
      .getWorldPosition(new THREE.Vector3())
      .project(camera);

    if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y)) {
      return null;
    }

    return {
      x: (projected.x + 1) / 2,
      y: (1 - projected.y) / 2,
    };
  }

  function createScene() {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
    });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO));

    if ('outputColorSpace' in renderer) {
      renderer.outputColorSpace = THREE.SRGBColorSpace;
    }
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setClearAlpha?.(0);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(32, 1, 0.01, 100);
    camera.position.set(0, 1.35, 3.1);

    const environment = new RoomEnvironment(renderer);
    const pmrem = new THREE.PMREMGenerator(renderer);
    environmentTexture = pmrem.fromScene(environment, 0.04).texture;
    scene.environment = environmentTexture;
    environment.dispose();
    pmrem.dispose();

    const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x40485a, 1.05);
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.35);
    keyLight.position.set(1.2, 2.8, 2.2);
    const fillLight = new THREE.DirectionalLight(0xbfd7ff, 0.35);
    fillLight.position.set(-1.6, 1.5, -1.3);
    const rimLight = new THREE.DirectionalLight(0xdbeafe, 0.65);
    rimLight.position.set(-1.8, 2.2, 2.4);

    scene.add(hemisphereLight, keyLight, fillLight, rimLight);
    attachOrbitControls();
  }

  async function loadModel() {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await loader.loadAsync(modelUrl);

    if (disposed || !scene) {
      return;
    }

    if (!gltf?.scene) {
      throw new Error('model scene not found');
    }

    loadedGltf = gltf;
    vrmHumanoid = parseVrmHumanoid(gltf.parser?.json);
    vrmHumanoidMapping = createVrmHumanoidMapping(vrmHumanoid);
    modelDiagnostics.unresolvedNodeMappings = [];
    modelDiagnostics.renderCompatibility = null;
    activeModelKind = detectAvatarModelKind(gltf);
    activeModelProfile = HEAD_NECK_PROFILE_DEFAULTS[activeModelKind] ?? HEAD_NECK_PROFILE_DEFAULTS.default;
    lastVrmRenderUpdateTime = 0;
    activeVrm = gltf.userData?.vrm ?? null;

    if (activeVrm) {
      VRMUtils.rotateVRM0(activeVrm);
      VRMUtils.removeUnnecessaryVertices(activeVrm.scene);
      VRMUtils.combineSkeletons(activeVrm.scene);
      if (activeVrm.humanoid) {
        activeVrm.humanoid.autoUpdateHumanBones = false;
      }
      model = activeVrm.scene;
      vrmSpringMotion = createEmptyVrmSpringMotionState();
      activeVrmRuntime = {
        available: true,
        version: vrmHumanoid?.version ?? null,
        springBoneEnabled: true,
        springBoneJointCount: activeVrm.springBoneManager?.joints?.size ?? 0,
        colliderCount: activeVrm.springBoneManager?.colliders?.length ?? 0,
        colliderGroupCount: activeVrm.springBoneManager?.colliderGroups?.length ?? 0,
        lastUpdateDeltaSec: 0,
        springMotionScore: 0,
        springMotionActivity: 0,
        springPhysicsActive: false,
        springIdleResetCount: 0,
        runtimeUpdateFailed: false,
        updateError: null,
        humanoidAutoUpdate: activeVrm.humanoid?.autoUpdateHumanBones ?? null,
      };
      resetVrmSpringMotionState();
    } else {
      model = gltf.scene;
      activeVrmRuntime = createEmptyVrmRuntimeState();
      vrmSpringMotion = createEmptyVrmSpringMotionState();
    }

    const initialYaw = activeVrm
      ? 0
      : (vrmHumanoid?.recommendedModelYawRad ?? getNonVrmInitialModelYawRad());

    if (initialYaw !== 0) {
      model.rotation.y = initialYaw;
      model.updateWorldMatrix(true, true);
    }

    model.traverse((object) => {
      if (object.isMesh) {
        object.frustumCulled = false;
        object.castShadow = false;
        object.receiveShadow = false;
      }
    });
    modelDiagnostics.renderCompatibility = sanitizeZeroAlphaVertexColors(model);
    await cacheVrmExpressionMapping(gltf);
    scene.add(model);
  }

  async function cacheVrmExpressionMapping(gltf) {
    const metadata = parseVrmExpressionMetadata(gltf?.parser?.json);

    faceExpressionScores = {};
    vrmExpressionMapping = await resolveVrmExpressionTargets(metadata, {
      getNodeObject: async (nodeIndex) => {
        try {
          return await gltf?.parser?.getDependency?.('node', nodeIndex);
        } catch {
          return null;
        }
      },
    });
  }

  function createSkeletonOverlay() {
    if (!model || !scene) {
      return;
    }

    skeletonHelper = new THREE.SkeletonHelper(model);
    skeletonHelper.visible = skeletonVisible;
    skeletonHelper.frustumCulled = false;
    skeletonHelper.renderOrder = 20;

    if (skeletonHelper.material) {
      skeletonHelper.material.depthTest = false;
      skeletonHelper.material.transparent = true;
      skeletonHelper.material.opacity = 0.95;
    }

    scene.add(skeletonHelper);
  }

  async function discoverBones() {
    bones.clear();
    boneAliasesByBone.clear();

    model.traverse((object) => {
      if (!isSupportedBoneObject(object)) {
        return;
      }

      registerBoneAlias(object.name, object);
    });

    if (loadedGltf && vrmHumanoidMapping?.version) {
      await registerVrmHumanoidAliases(loadedGltf, vrmHumanoidMapping);
    }

    if (bones.size === 0) {
      throw new Error('no supported humanoid avatar bones found');
    }
  }

  function validateRequiredBones() {
    const missing = REQUIRED_BONES.filter((name) => !getBone(name));

    if (missing.length > 0) {
      if (vrmHumanoidMapping?.version) {
        const unresolved = modelDiagnostics.unresolvedNodeMappings
          .slice(0, 6)
          .map((entry) => entry.mixamoName ?? entry.canonical)
          .join(', ');
        const detail = unresolved ? `; unresolved ${unresolved}` : '';

        throw new Error(`VRM humanoid mapping incomplete: missing ${missing.slice(0, 8).join(', ')}${detail}`);
      }

      throw new Error(`missing required avatar bones: ${missing.slice(0, 8).join(', ')}`);
    }
  }

  function cacheRestPose() {
    restPose.clear();
    restPoseByBone.clear();
    model.updateWorldMatrix(true, true);

    for (const [name, bone] of bones) {
      const baseName = avatarBoneBaseName(name) || getPreferredBoneAlias(bone);
      let rest = restPoseByBone.get(bone);

      if (!rest) {
        const axisLocal = inferBoneAxisLocal(bone, baseName, hasBoneAlias);
        rest = {
          quaternion: bone.quaternion.clone(),
          position: bone.position.clone(),
          axisLocal,
          secondaryAxisLocal: inferRestSecondaryAxisLocal(bone, baseName, axisLocal),
        };
        restPoseByBone.set(bone, rest);
        restPose.set(bone.name, rest);
      }

      restPose.set(name, rest);
    }
  }

  function inferRestSecondaryAxisLocal(bone, baseName, axisLocal) {
    const resolvedBaseName = baseName || avatarBoneBaseName(bone.name);

    if ((resolvedBaseName === 'Head' || resolvedBaseName === 'Neck') && model && axisLocal) {
      const modelForwardWorld = tmpVectorA
        .set(0, 0, 1)
        .applyQuaternion(model.getWorldQuaternion(tmpQuaternionA))
        .normalize();
      const parentWorldQuaternion = bone.parent
        ? bone.parent.getWorldQuaternion(tmpQuaternionB)
        : tmpQuaternionB.identity();
      const secondaryLocal = tmpVectorB
        .copy(modelForwardWorld)
        .applyQuaternion(tmpQuaternionC.copy(parentWorldQuaternion).invert())
        .applyQuaternion(tmpQuaternionD.copy(bone.quaternion).invert())
        .normalize();

      secondaryLocal.addScaledVector(axisLocal, -secondaryLocal.dot(axisLocal));

      if (secondaryLocal.lengthSq() > 0.000001) {
        return secondaryLocal.clone().normalize();
      }
    }

    return inferSecondaryAxisLocal(axisLocal);
  }

  function buildRetargetMaps() {
    bodyBoneNames.clear();
    BODY_RETARGETS.forEach(({ bone }) => {
      if (getBone(bone)) {
        bodyBoneNames.add(boneName(bone));
      }
    });

    for (const side of ['Left', 'Right']) {
      fingerChains[side].clear();

      for (const fingerName of Object.keys(HAND_FINGERS)) {
        const chain = [1, 2, 3, 4]
          .map((segment) => getBone(`${side}Hand${fingerName}${segment}`))
          .filter(Boolean);
        fingerChains[side].set(fingerName, chain);
      }
    }
  }

  function buildCurrentFingerChainReport() {
    const report = {};

    for (const side of ['Left', 'Right']) {
      report[side] = {};

      for (const fingerName of Object.keys(HAND_FINGERS)) {
        const chain = fingerChains[side].get(fingerName) ?? [];
        report[side][fingerName] = {
          length: chain.length,
          bones: chain.map((bone) => bone.name),
        };
      }
    }

    return report;
  }

  async function registerVrmHumanoidAliases(gltf, mapping) {
    const parser = gltf?.parser;

    if (!parser?.getDependency) {
      return;
    }

    for (const [mixamoName, nodeIndex] of mapping.mixamoToNode) {
      try {
        const object = await parser.getDependency('node', nodeIndex);
        const bone = findBoneObject(object);

        if (!bone) {
          modelDiagnostics.unresolvedNodeMappings.push({
            mixamoName,
            canonical: mapping.canonicalMappings[mixamoName]?.canonical ?? null,
            nodeIndex,
            reason: 'node is not a Bone',
          });
          continue;
        }

        registerBoneAlias(mixamoName, bone);
      } catch (error) {
        modelDiagnostics.unresolvedNodeMappings.push({
          mixamoName,
          canonical: mapping.canonicalMappings[mixamoName]?.canonical ?? null,
          nodeIndex,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  function findBoneObject(object) {
    if (!object) {
      return null;
    }

    if (object.isBone) {
      return object;
    }

    let result = null;
    object.traverse?.((child) => {
      if (!result && child.isBone) {
        result = child;
      }
    });

    return result;
  }

  function registerBoneAlias(alias, bone) {
    const aliases = boneNameAliases(alias);
    const effectiveAliases = aliases.length > 0 ? aliases : [alias];

    for (const key of effectiveAliases) {
      bones.set(key, bone);

      const baseName = avatarBoneBaseName(key);

      if (baseName) {
        registerBoneBaseAlias(bone, baseName);
      }
    }
  }

  function registerBoneBaseAlias(bone, baseName) {
    const aliases = boneAliasesByBone.get(bone) ?? new Set();
    aliases.add(baseName);
    boneAliasesByBone.set(bone, aliases);
  }

  function getPreferredBoneAlias(bone) {
    const aliases = boneAliasesByBone.get(bone);

    if (aliases?.size) {
      return aliases.values().next().value;
    }

    return avatarBoneBaseName(bone?.name);
  }

  function hasBoneAlias(bone, baseName) {
    return Boolean(
      baseName &&
      (
        boneAliasesByBone.get(bone)?.has(baseName) ||
        avatarBoneBaseName(bone?.name) === baseName
      ),
    );
  }

  function frameModel() {
    const box = new THREE.Box3().setFromObject(model);

    if (box.isEmpty()) {
      configureOrbitCamera(new THREE.Vector3(0, 1, 0), 3.1, 1, 8, 0, Math.PI / 2);
      return;
    }

    const center = box.getCenter(tmpVectorB);
    model.position.x -= center.x;
    model.position.y -= box.min.y;
    model.position.z -= center.z;
    model.updateWorldMatrix(true, true);

    const fittedBox = new THREE.Box3().setFromObject(model);
    const fittedSize = fittedBox.getSize(tmpVectorA);
    const height = Math.max(fittedSize.y, 1);
    modelHeight = height;
    const maxDimension = Math.max(fittedSize.x, fittedSize.y, fittedSize.z, 1);
    const target = new THREE.Vector3(0, height * 0.56, 0);
    const viewDistance = maxDimension * 1.75;
    const verticalOffset = height * 0.58 - target.y;
    const defaultRadius = Math.max(Math.hypot(viewDistance, verticalOffset), 0.1);
    const defaultPhi = Math.acos(THREE.MathUtils.clamp(verticalOffset / defaultRadius, -1, 1));

    camera.near = Math.max(0.01, maxDimension / 100);
    camera.far = Math.max(100, maxDimension * 10);
    camera.updateProjectionMatrix();
    createContactShadow(maxDimension);
    rootMotion.baseModelPosition.copy(model.position);
    rootMotion.baseModelRotationY = model.rotation.y;
    rootMotion.maxOffset.set(height * ROOT_MOTION_MAX_X_RATIO, height * ROOT_MOTION_MAX_Y_RATIO);
    resetRootMotion(false);
    configureOrbitCamera(
      target,
      defaultRadius,
      defaultRadius * ORBIT_MIN_DISTANCE_SCALE,
      defaultRadius * ORBIT_MAX_DISTANCE_SCALE,
      getDefaultViewYaw(),
      defaultPhi,
    );
  }

  function getDefaultViewYaw() {
    const label = String(modelLabel ?? '').toLowerCase();

    if (label.includes('soldier')) {
      return Math.PI;
    }

    return 0;
  }

  function getNonVrmInitialModelYawRad() {
    const label = String(modelLabel ?? '').toLowerCase();
    const url = String(modelUrl ?? '').toLowerCase();

    if (label === 'xbot.glb' || url.endsWith('/xbot.glb') || url.endsWith('xbot.glb')) {
      return DEFAULT_XBOT_MODEL_YAW_RAD;
    }

    return 0;
  }

  function createContactShadow(maxDimension) {
    if (!scene) {
      return;
    }

    disposeContactShadow();
    const width = Math.max(maxDimension * 0.58, 0.4);
    const depth = Math.max(maxDimension * 0.18, 0.16);
    const geometry = new THREE.PlaneGeometry(width, depth);
    const material = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    });

    contactShadow = new THREE.Mesh(geometry, material);
    contactShadow.name = 'AvatarContactShadow';
    contactShadow.rotation.x = -Math.PI / 2;
    contactShadow.position.set(0, 0.012, 0.08);
    contactShadow.renderOrder = -1;
    scene.add(contactShadow);
  }

  function configureOrbitCamera(target, radius, minRadius, maxRadius, theta, phi) {
    orbitCamera.target.copy(target);
    orbitCamera.radius = radius;
    orbitCamera.minRadius = minRadius;
    orbitCamera.maxRadius = maxRadius;
    orbitCamera.theta = theta;
    orbitCamera.phi = THREE.MathUtils.clamp(phi, ORBIT_MIN_POLAR, ORBIT_MAX_POLAR);
    orbitCamera.defaultRadius = radius;
    orbitCamera.defaultTheta = theta;
    orbitCamera.defaultPhi = orbitCamera.phi;
    applyOrbitCamera();
  }

  function resetOrbitCamera() {
    orbitCamera.radius = orbitCamera.defaultRadius;
    orbitCamera.theta = orbitCamera.defaultTheta;
    orbitCamera.phi = orbitCamera.defaultPhi;
    applyOrbitCamera();
  }

  function applyOrbitCamera() {
    if (!camera) {
      return;
    }

    tmpSpherical.set(orbitCamera.radius, orbitCamera.phi, orbitCamera.theta);
    camera.position.setFromSpherical(tmpSpherical).add(orbitCamera.target);
    camera.lookAt(orbitCamera.target);
    camera.updateMatrixWorld(true);
  }

  function attachOrbitControls() {
    if (!canvas || orbitControlsAttached) {
      return;
    }

    canvas.addEventListener('pointerdown', handleOrbitPointerDown);
    canvas.addEventListener('pointermove', handleOrbitPointerMove);
    canvas.addEventListener('pointerup', handleOrbitPointerEnd);
    canvas.addEventListener('pointercancel', handleOrbitPointerEnd);
    canvas.addEventListener('lostpointercapture', handleOrbitPointerEnd);
    canvas.addEventListener('wheel', handleOrbitWheel, { passive: false });
    canvas.addEventListener('dblclick', handleOrbitDoubleClick);
    orbitControlsAttached = true;
  }

  function detachOrbitControls() {
    if (!canvas || !orbitControlsAttached) {
      return;
    }

    canvas.removeEventListener('pointerdown', handleOrbitPointerDown);
    canvas.removeEventListener('pointermove', handleOrbitPointerMove);
    canvas.removeEventListener('pointerup', handleOrbitPointerEnd);
    canvas.removeEventListener('pointercancel', handleOrbitPointerEnd);
    canvas.removeEventListener('lostpointercapture', handleOrbitPointerEnd);
    canvas.removeEventListener('wheel', handleOrbitWheel);
    canvas.removeEventListener('dblclick', handleOrbitDoubleClick);
    canvas.classList.remove('is-orbiting');
    orbitPointer.id = null;
    orbitControlsAttached = false;
  }

  function handleOrbitPointerDown(event) {
    if (!camera || disposed || failed || event.button !== 0) {
      return;
    }

    event.preventDefault();
    orbitPointer.id = event.pointerId;
    orbitPointer.x = event.clientX;
    orbitPointer.y = event.clientY;
    setOrbitPointerCapture(event.pointerId);
    canvas?.classList.add('is-orbiting');
  }

  function handleOrbitPointerMove(event) {
    if (orbitPointer.id !== event.pointerId || !camera) {
      return;
    }

    event.preventDefault();
    const dx = event.clientX - orbitPointer.x;
    const dy = event.clientY - orbitPointer.y;
    orbitPointer.x = event.clientX;
    orbitPointer.y = event.clientY;

    orbitCamera.theta -= dx * ORBIT_ROTATE_SPEED;
    orbitCamera.phi = THREE.MathUtils.clamp(
      orbitCamera.phi - dy * ORBIT_ROTATE_SPEED,
      ORBIT_MIN_POLAR,
      ORBIT_MAX_POLAR,
    );
    applyOrbitCamera();
  }

  function handleOrbitPointerEnd(event) {
    if (orbitPointer.id !== event.pointerId) {
      return;
    }

    releaseOrbitPointerCapture(event.pointerId);
    canvas?.classList.remove('is-orbiting');
    orbitPointer.id = null;
  }

  function setOrbitPointerCapture(pointerId) {
    try {
      canvas?.setPointerCapture?.(pointerId);
    } catch {
      // Programmatic tests can dispatch pointer events without a browser-owned active pointer.
    }
  }

  function releaseOrbitPointerCapture(pointerId) {
    try {
      canvas?.releasePointerCapture?.(pointerId);
    } catch {
      // Ignore unmatched synthetic pointer releases; real pointer interaction remains captured.
    }
  }

  function handleOrbitWheel(event) {
    if (!camera || disposed || failed) {
      return;
    }

    event.preventDefault();
    const zoomFactor = Math.exp(event.deltaY * ORBIT_ZOOM_SPEED);
    orbitCamera.radius = THREE.MathUtils.clamp(
      orbitCamera.radius * zoomFactor,
      orbitCamera.minRadius,
      orbitCamera.maxRadius,
    );
    applyOrbitCamera();
  }

  function handleOrbitDoubleClick(event) {
    event.preventDefault();
    resetOrbitCamera();
  }

  function getPoseFramePoints(landmarks, mirrored, worldLandmarks, timestamp = 0, delta = FIRST_UPDATE_DELTA_MS) {
    const frameKey = `${Number(timestamp).toFixed(3)}|${mirrored ? 1 : 0}|${landmarkDepthScale}|${depthCalibrationMode}`;

    if (depthCalibration.lastFrameKey === frameKey && depthCalibration.lastPoints) {
      return {
        points: depthCalibration.lastPoints,
        rawPoints: depthCalibration.lastRawPoints,
        depthCalibration: getDepthCalibrationSnapshot(),
      };
    }

    const startedAt = nowMs();
    const rawPoints = buildPosePoints(landmarks, mirrored, {
      depthScale: landmarkDepthScale,
      worldLandmarks,
    });
    const points = clonePosePoints(rawPoints);

    if (isDynamicDepthCalibrationActive()) {
      updateDepthCalibrationReferences(rawPoints, worldLandmarks);

      if (depthCalibration.frozen) {
        refineDepthFromSegmentLengths(points, rawPoints, delta);
      } else {
        depthCalibration.lastSolveDetails = new Map();
      }

      updateDepthCalibrationRows(points);
    } else {
      depthCalibration.lastSolveDetails = new Map();
      updateDepthCalibrationRows(points);
    }

    depthCalibration.lastFrameKey = frameKey;
    depthCalibration.lastRawPoints = rawPoints;
    depthCalibration.lastPoints = points;
    recordPerformanceSample(performanceStats.depthCalibrationMs, nowMs() - startedAt);

    return {
      points,
      rawPoints,
      depthCalibration: getDepthCalibrationSnapshot(),
    };
  }

  function isDynamicDepthCalibrationActive() {
    return depthCalibrationMode === DEPTH_CALIBRATION_MODE_DYNAMIC && landmarkDepthScale > 0;
  }

  function updateDepthCalibrationReferences(points, worldLandmarks) {
    if ((depthCalibration.frozen && !depthCalibration.profileLocked) || !isLandmarkList(worldLandmarks)) {
      return;
    }

    const scale = bodyScale2D(points);
    let validSegments = 0;
    let upperBodySegments = 0;
    let lowerBodySegments = 0;

    for (const segment of DEPTH_CALIBRATION_SEGMENTS) {
      if (!segment.gated) {
        continue;
      }

      const ratio = segmentLengthRatio(points, segment, scale);

      if (!Number.isFinite(ratio) || ratio <= 0) {
        continue;
      }

      const samples = depthCalibration.referenceSamples.get(segment.name) ?? [];
      samples.push(ratio);
      depthCalibration.referenceSamples.set(segment.name, samples);
      validSegments += 1;

      if (segment.group === 'legs') {
        lowerBodySegments += 1;
      } else {
        upperBodySegments += 1;
      }
    }

    const coverage = { validSegments, upperBodySegments, lowerBodySegments };
    const requiredSegments = resolveDepthCalibrationMinSegments(coverage);
    depthCalibration.lastCoverage = coverage;

    if (validSegments >= requiredSegments) {
      depthCalibration.frames += 1;
      depthCalibration.minimumReferenceSegments = Math.min(
        depthCalibration.minimumReferenceSegments,
        requiredSegments,
      );
    }

    if (depthCalibration.frames >= DEPTH_CALIBRATION_WARMUP_FRAMES) {
      freezeDepthCalibrationReferences();
    }
  }

  function freezeDepthCalibrationReferences() {
    const referenceRatios = { ...depthCalibration.externalReferenceRatios };
    const referenceRatioSources = Object.fromEntries(
      Object.keys(referenceRatios).map((name) => [name, 'external-profile']),
    );

    for (const segment of DEPTH_CALIBRATION_SEGMENTS) {
      const samples = depthCalibration.referenceSamples.get(segment.name) ?? [];

      if (samples.length < DEPTH_CALIBRATION_MIN_SEGMENT_SAMPLES) {
        continue;
      }

      referenceRatios[segment.name] = percentile(samples.slice().sort((a, b) => a - b), 0.5);
      referenceRatioSources[segment.name] = 'observed';
    }

    depthCalibration.referenceRatios = referenceRatios;
    depthCalibration.referenceRatioSources = referenceRatioSources;
    depthCalibration.frozen = Object.keys(referenceRatios).length >= depthCalibration.minimumReferenceSegments;
    depthCalibration.profileLocked = Object.values(referenceRatioSources).includes('external-profile');
    depthCalibration.referenceSamples.clear();
  }

  function refineDepthFromSegmentLengths(points, rawPoints, delta) {
    const scale = bodyScale2D(rawPoints);
    const alpha = 1;
    const solveDetails = new Map();

    for (const step of DEPTH_CALIBRATION_SOLVE_STEPS) {
      const ratio = depthCalibration.referenceRatios[step.segmentName];
      const parent = points[step.parent];
      const child = points[step.child];
      const rawChild = rawPoints[step.child];

      if (!Number.isFinite(ratio) || !parent || !child || !rawChild) {
        continue;
      }

      const solved = solveDistalDepth({
        parent,
        child,
        rawChild,
        targetLength: ratio * scale,
        previousDz: depthCalibration.previousSegmentDz.get(step.segmentName) ?? 0,
        smoothingAlpha: alpha,
      });

      child.z = solved.z;
      depthCalibration.previousSegmentDz.set(step.segmentName, solved.dz);
      solveDetails.set(step.segmentName, solved);
    }

    depthCalibration.lastSolveDetails = solveDetails;
  }

  function updateDepthCalibrationRows(points) {
    const scale = bodyScale2D(points);
    const rows = DEPTH_CALIBRATION_SEGMENTS
      .map((segment) => lengthConsistencyRow({
        segment,
        points,
        referenceRatio: depthCalibration.referenceRatios[segment.name],
        scale,
        smoothnessDelta: depthCalibration.lastSolveDetails.get(segment.name)?.smoothnessDelta ?? 0,
        clamped: depthCalibration.lastSolveDetails.get(segment.name)?.clamped ?? false,
      }))
      .filter(Boolean);
    const summary = summarizeLengthConsistency(rows);

    depthCalibration.lastRows = rows;
    depthCalibration.lastSummary = summary;
    depthCalibration.lastClampedRatio = summary.clampedRatio ?? 0;
  }

  function getDepthCalibrationSnapshot() {
    const referenceSegmentCount = Object.keys(depthCalibration.referenceRatios).length;
    const active = isDynamicDepthCalibrationActive();
    const ready = active && depthCalibration.frozen && referenceSegmentCount > 0;
    const summary = depthCalibration.lastSummary ?? summarizeLengthConsistency([]);
    const poseQuality = estimateCalibrationPoseQuality(depthCalibration.lastRawPoints ?? depthCalibration.lastPoints);

    return {
      mode: depthCalibrationMode,
      active,
      ready,
      frozen: depthCalibration.frozen,
      frames: depthCalibration.frames,
      warmupFrames: DEPTH_CALIBRATION_WARMUP_FRAMES,
      referenceSegmentCount,
      externalReferenceSegmentCount: Object.keys(depthCalibration.externalReferenceRatios).length,
      profileLocked: depthCalibration.profileLocked,
      referenceRatioSources: { ...depthCalibration.referenceRatioSources },
      minimumReferenceSegments: depthCalibration.minimumReferenceSegments,
      coverage: { ...depthCalibration.lastCoverage },
      poseQuality,
      targetScore: DEPTH_CALIBRATION_TARGET_SCORE,
      lengthErrorThreshold: DEPTH_CALIBRATION_LENGTH_ERROR_THRESHOLD,
      smoothnessThreshold: DEPTH_CALIBRATION_SMOOTHNESS_THRESHOLD,
      runtimeP95BudgetMs: DEPTH_CALIBRATION_RUNTIME_P95_BUDGET_MS,
      clampWarningRatio: DEPTH_CALIBRATION_CLAMP_WARNING_RATIO,
      score: ready ? summary.score : 0,
      passed: ready && summary.score >= DEPTH_CALIBRATION_TARGET_SCORE,
      summary,
      bySegment: Object.fromEntries(
        DEPTH_CALIBRATION_SEGMENTS.map((segment) => [
          segment.name,
          summarizeLengthConsistency(depthCalibration.lastRows.filter((row) => row.name === segment.name)),
        ]),
      ),
      segments: depthCalibration.lastRows.map((row) => ({ ...row })),
    };
  }

  function resetDepthCalibration() {
    depthCalibration.frames = 0;
    depthCalibration.frozen = false;
    depthCalibration.referenceSamples.clear();
    depthCalibration.referenceRatios = {};
    depthCalibration.referenceRatioSources = {};
    depthCalibration.previousSegmentDz.clear();
    depthCalibration.lastSolveDetails = new Map();
    depthCalibration.lastFrameKey = null;
    depthCalibration.lastPoints = null;
    depthCalibration.lastRawPoints = null;
    depthCalibration.lastRows = [];
    depthCalibration.lastSummary = summarizeLengthConsistency([]);
    depthCalibration.lastClampedRatio = 0;
    depthCalibration.lastMode = depthCalibrationMode;
    depthCalibration.minimumReferenceSegments = DEPTH_CALIBRATION_MIN_FULL_BODY_SEGMENTS;
    depthCalibration.lastCoverage = depthCalibrationCoverage(null);
    applyExternalDepthCalibrationReference();
  }

  function applyExternalDepthCalibrationReference() {
    const referenceRatios = depthCalibration.externalReferenceRatios ?? {};
    const referenceSegmentNames = Object.keys(referenceRatios);

    if (referenceSegmentNames.length === 0) {
      depthCalibration.profileLocked = false;
      return;
    }

    depthCalibration.referenceRatios = { ...referenceRatios };
    depthCalibration.referenceRatioSources = Object.fromEntries(
      referenceSegmentNames.map((name) => [name, 'external-profile']),
    );
    depthCalibration.frozen = true;
    depthCalibration.profileLocked = true;
    depthCalibration.minimumReferenceSegments = Math.min(
      depthCalibration.minimumReferenceSegments,
      referenceSegmentNames.length,
    );
  }

  function applyPose(landmarks, mirrored, delta, worldLandmarks = null, timestamp = 0) {
    const { points } = getPoseFramePoints(landmarks, mirrored, worldLandmarks, timestamp, delta);
    const limbPlaneNormals = computeLimbPlaneNormals(points);
    const solverStartedAt = nowMs();
    const solvedPose = solvePoseTargetsFromPoints(points, poseSolverState, { timestamp });
    recordPerformanceSample(performanceStats.poseSolverMs, nowMs() - solverStartedAt);
    Object.assign(poseSolverState, solvedPose.state);
    recordPoseSolverMetrics(solvedPose);
    const strictModeActive = activeRetargetMode === RETARGET_MODE_STRICT;
    const retargetSolvedPose = strictModeActive
      ? solvePoseTargetsFromPoints(points, strictPoseSolverState, {
          timestamp,
          targetStabilization: false,
        })
      : solvedPose;

    if (strictModeActive) {
      Object.assign(strictPoseSolverState, retargetSolvedPose.state);
      lastStrictRetargetFrame = buildStrictRetargetFrame({
        points,
        solvedPose: retargetSolvedPose,
        previousState: strictRetargetState,
        rigBasis: buildStrictRigBasis(),
        yawSign: DEFAULT_AVATAR_YAW_SIGN,
      });
      strictRetargetState = lastStrictRetargetFrame.state;
    } else {
      lastStrictRetargetFrame = null;
    }

    const solverSnapshot = createPoseSolverSnapshot(solvedPose);
    const solvedTargetsByBone = new Map(retargetSolvedPose.targets.map((target) => [target.bone, target]));
    const reacquireBlend = updateTrackingRecoveryState(retargetSolvedPose.meta.mode, timestamp);

    if (retargetSolvedPose.meta.mode === 'lost') {
      applyLostTrackingBodyPose(timestamp, delta);
      updateSourceAvatarDivergence(points);
      lastPoseSolverSnapshot = {
        ...solverSnapshot,
        retargetMode: activeRetargetMode,
        strictRetarget: lastStrictRetargetFrame,
        sourceAvatarDivergence: getSourceAvatarDivergenceSnapshot(),
        occlusion: getOcclusionSnapshot(),
        trackingRecovery: getTrackingRecoverySnapshot(),
      };
      return;
    }

    if (strictModeActive) {
      applyStrictRootOrientation(points, delta, retargetSolvedPose, lastStrictRetargetFrame);
    } else {
      applyRootOrientation(points, delta, solvedPose);
    }

    for (const target of BODY_RETARGETS) {
      const solvedTarget = solvedTargetsByBone.get(target.bone);

      if (!solvedTarget) {
        applyOccludedBodyBone(target.bone, timestamp, delta);
        continue;
      }

      if (
        anatomyConstraintsEnabled &&
        solvedTarget.anatomy?.neutralHold &&
        (solvedTarget.group === "legs" || solvedTarget.group === "feet")
      ) {
        applyOccludedBodyBone(target.bone, timestamp, delta, {
          holdMs: RETARGET_OCCLUSION_HOLD_MS,
          decayMs: RETARGET_OCCLUSION_DECAY_MS,
        });
        continue;
      }

      if (retargetSolvedPose.meta.mode === 'upper-body' && (solvedTarget?.group === 'legs' || solvedTarget?.group === 'feet')) {
        applyOccludedBodyBone(target.bone, timestamp, delta, {
          holdMs: 0,
          decayMs: RETARGET_LOST_TRACKING_DECAY_MS,
        });
        continue;
      }

      const direction = strictModeActive
        ? resolveStrictTargetDirection(solvedTarget)
        : resolveSolvedTargetDirection(solvedTarget);
      const profile = target.profileKey ? activeModelProfile[target.profileKey] : null;
      const smoothingMs = (RETARGET_SMOOTHING_MS[target.smoothing] ?? RETARGET_SMOOTHING_MS.foreArm)
        * (target.profileKey ? activeModelProfile.smoothingScale : 1);
      const alpha = smoothingAlpha(delta, smoothingMs);
      const confidence = solvedTarget.confidence;
      const secondaryWorld = strictModeActive
        ? profile
          ? resolveBodySecondaryAxis(target, points)
          : null
        : resolveBodySecondaryAxis(target, points) ?? limbPlaneNormals[target.bone] ?? null;
      const { maxAngle, maxTwist } = resolveBodyRetargetLimits(target, profile, strictModeActive);

      if (!strictModeActive && confidence <= RETARGET_LOW_CONFIDENCE_HOLD) {
        applyOccludedBodyBone(target.bone, timestamp, delta);
        continue;
      }

      clearBodyOcclusionState(target.bone);
      const targetAlpha = strictModeActive
        ? profile
          ? alpha * reacquireBlend * target.strength * (profile.strengthScale ?? 1) * confidence
          : 1
        : alpha * reacquireBlend * target.strength * (profile?.strengthScale ?? 1) * confidence;
      applyAimToBone(target.bone, direction, targetAlpha, maxAngle, {
        maxTwist,
        secondaryWorld,
        deadband: strictModeActive ? undefined : profile?.deadband,
        hysteresis: strictModeActive ? undefined : profile?.hysteresis,
      });
    }

    applyRootMotion(landmarks, mirrored, delta);
    updateSourceAvatarDivergence(points);
    lastPoseSolverSnapshot = {
      ...solverSnapshot,
      retargetMode: activeRetargetMode,
      strictRetarget: lastStrictRetargetFrame,
      sourceAvatarDivergence: getSourceAvatarDivergenceSnapshot(),
      occlusion: getOcclusionSnapshot(),
      trackingRecovery: getTrackingRecoverySnapshot(),
    };
  }

  function resolveBodyRetargetLimits(target, profile, strictModeActive) {
    if (strictModeActive && !profile) {
      return {
        maxAngle: undefined,
        maxTwist: undefined,
      };
    }

    return {
      maxAngle: target.maxAngle * (profile?.maxAngleScale ?? 1),
      maxTwist: profile ? target.maxTwist * (profile.maxTwistScale ?? 1) : undefined,
    };
  }

  function resolveStrictTargetDirection(solvedTarget) {
    const direction = anatomyConstraintsEnabled
      ? solvedTarget.constrainedDirection ?? solvedTarget.direction
      : solvedTarget.rawDirection ?? solvedTarget.direction;
    return tmpVectorC.set(
      direction.x,
      direction.y,
      direction.z,
    );
  }

  function resolveSolvedTargetDirection(solvedTarget) {
    if (
      anatomyConstraintsEnabled &&
      solvedTarget?.directionTorsoLocal &&
      shouldUseTorsoLocalDirection(solvedTarget)
    ) {
      const local = solvedTarget.directionTorsoLocal;
      const direction = tmpVectorC.set(
        -Number(local.x ?? 0),
        Number(local.y ?? 0),
        Number(local.z ?? 0),
      );

      if (direction.lengthSq() > 0.000001 && model) {
        model.getWorldQuaternion(tmpQuaternionG);
        return direction.normalize().applyQuaternion(tmpQuaternionG).normalize();
      }
    }

    const direction = anatomyConstraintsEnabled
      ? solvedTarget.constrainedDirection ?? solvedTarget.direction
      : solvedTarget.rawDirection ?? solvedTarget.direction;
    return tmpVectorC.set(direction.x, direction.y, direction.z);
  }

  function shouldUseTorsoLocalDirection(solvedTarget) {
    if (!(solvedTarget?.group === 'arms' || solvedTarget?.group === 'legs' || solvedTarget?.group === 'feet')) {
      return false;
    }

    const yawMagnitude = Math.abs(shortestAngle(rootMotion.yawOffset));
    return rootMotion.facing === 'back' || rootMotion.facing === 'side' || yawMagnitude >= Math.PI / 3;
  }

  function createPoseSolverSnapshot(solvedPose) {
    return {
      version: solvedPose.version,
      timestamp: solvedPose.timestamp,
      facing: solvedPose.meta.facing,
      facingDetail: solvedPose.meta.facingDetail,
      facingYawDeg: solvedPose.meta.facingYawDeg,
      facingUnwrappedYawDeg: solvedPose.meta.facingUnwrappedYawDeg,
      facingRawYawDeltaDeg: solvedPose.meta.facingRawYawDeltaDeg,
      facingLimitedYawDeltaDeg: solvedPose.meta.facingLimitedYawDeltaDeg,
      facingRawYawJump: solvedPose.meta.facingRawYawJump,
      facingYawFlipCount: solvedPose.meta.facingYawFlipCount,
      facingSideOrderSign: solvedPose.meta.facingSideOrderSign,
      facingSideOrderConfidence: solvedPose.meta.facingSideOrderConfidence,
      facingSideOrderFlip: solvedPose.meta.facingSideOrderFlip,
      facingYawReliable: solvedPose.meta.facingYawReliable,
      facingYawReliabilityReason: solvedPose.meta.facingYawReliabilityReason,
      facingUnreliableYawFrames: solvedPose.meta.facingUnreliableYawFrames,
      facingStableYawFrames: solvedPose.meta.facingStableYawFrames,
      facingRecoveringFromUnreliableYaw: solvedPose.meta.facingRecoveringFromUnreliableYaw,
      facingLastReliableYawDeg: solvedPose.meta.facingLastReliableYawDeg,
      facingRecoveryTargetYawDeg: solvedPose.meta.facingRecoveryTargetYawDeg,
      facingUnstableYawCandidateDeg: solvedPose.meta.facingUnstableYawCandidateDeg,
      facingUnstableYawCandidateFrames: solvedPose.meta.facingUnstableYawCandidateFrames,
      mode: solvedPose.meta.mode,
      targetCount: solvedPose.meta.targetCount,
      lowConfidenceTargets: solvedPose.meta.lowConfidenceTargets,
      implausibleTargets: solvedPose.meta.implausibleTargets,
      implausibleRatio: solvedPose.meta.implausibleRatio,
      occlusion: {
        activeCount: solvedPose.meta.occlusionActiveTargets ?? 0,
        holdCount: solvedPose.meta.occlusionHoldTargets ?? 0,
        decayCount: solvedPose.meta.occlusionDecayTargets ?? 0,
        reacquireCount: solvedPose.meta.occlusionReacquireTargets ?? 0,
      },
      hingeCount: solvedPose.meta.hingeCount,
      hingeViolations: solvedPose.meta.hingeViolations,
      hingeLimitWarnings: solvedPose.meta.hingeLimitWarnings,
      lowConfidenceHinges: solvedPose.meta.lowConfidenceHinges,
      anatomy: {
        enabled: anatomyConstraintsEnabled,
        softViolations: solvedPose.meta.anatomySoftViolations ?? 0,
        hardViolations: solvedPose.meta.anatomyHardViolations ?? 0,
        constrainedTargets: solvedPose.meta.anatomyConstrainedTargets ?? 0,
        lowerBodyReliable: solvedPose.meta.anatomyLowerBodyReliable ?? null,
        lowerBodyConfidence: solvedPose.meta.anatomyLowerBodyConfidence ?? null,
      },
      targets: solvedPose.targets.map((target) => ({
        bone: target.bone,
        group: target.group,
        confidence: target.confidence,
        length: target.length,
        hinge: target.hinge,
        occlusionState: target.occlusionState,
        occlusionReason: target.occlusionReason,
        implausible: Boolean(target.implausible),
        plausibilityReason: target.plausibilityReason,
        anatomy: target.anatomy ?? null,
      })),
      hinges: solvedPose.hinges.map((hinge) => ({
        name: hinge.name,
        group: hinge.group,
        flexDeg: hinge.flexDeg,
        confidence: hinge.confidence,
        minFlexDeg: hinge.minFlexDeg,
        maxFlexDeg: hinge.maxFlexDeg,
        violation: hinge.violation,
        limitWarning: hinge.limitWarning,
        reason: hinge.reason,
      })),
    };
  }

  function recordPoseSolverMetrics(solvedPose) {
    poseSolverMetrics.frames += 1;

    if (solvedPose.meta.hingeViolations > 0) {
      poseSolverMetrics.hingeViolationFrames += 1;
      poseSolverMetrics.maxHingeViolations = Math.max(
        poseSolverMetrics.maxHingeViolations,
        solvedPose.meta.hingeViolations,
      );
    }

    if (solvedPose.meta.hingeLimitWarnings > 0) {
      poseSolverMetrics.hingeLimitWarningFrames += 1;
      poseSolverMetrics.maxHingeLimitWarnings = Math.max(
        poseSolverMetrics.maxHingeLimitWarnings,
        solvedPose.meta.hingeLimitWarnings,
      );
    }

    for (const hinge of solvedPose.hinges) {
      if (!hinge?.name || !Number.isFinite(hinge.flexDeg)) {
        continue;
      }

      updateNamedMaxMetric(poseSolverMetrics.maxHingeFlexDegByName, hinge.name, hinge.flexDeg);

      if (hinge.limitWarning) {
        incrementNamedMetric(poseSolverMetrics.hingeLimitWarningByName, hinge.name);
        updateNamedMaxMetric(
          poseSolverMetrics.maxHingeOverflowDegByName,
          hinge.name,
          hinge.flexDeg - hinge.maxFlexDeg,
        );
      }
    }

    if (
      poseSolverMetrics.previousFacing &&
      poseSolverMetrics.previousFacing !== solvedPose.meta.facing
    ) {
      poseSolverMetrics.facingChanges += 1;
    }

    if (
      poseSolverMetrics.previousMode &&
      poseSolverMetrics.previousMode !== solvedPose.meta.mode
    ) {
      poseSolverMetrics.modeChanges += 1;
    }

    const occlusionActiveTargets = Number(solvedPose.meta.occlusionActiveTargets ?? 0);
    if (occlusionActiveTargets > 0) {
      poseSolverMetrics.occlusionActiveFrames += 1;
      poseSolverMetrics.maxOcclusionActiveTargets = Math.max(
        poseSolverMetrics.maxOcclusionActiveTargets,
        occlusionActiveTargets,
      );
    }

    poseSolverMetrics.previousFacing = solvedPose.meta.facing;
    poseSolverMetrics.previousMode = solvedPose.meta.mode;
  }

  function resetPoseSolverMetrics() {
    poseSolverMetrics.frames = 0;
    poseSolverMetrics.hingeViolationFrames = 0;
    poseSolverMetrics.maxHingeViolations = 0;
    poseSolverMetrics.hingeLimitWarningFrames = 0;
    poseSolverMetrics.maxHingeLimitWarnings = 0;
    poseSolverMetrics.hingeLimitWarningByName = {};
    poseSolverMetrics.maxHingeFlexDegByName = {};
    poseSolverMetrics.maxHingeOverflowDegByName = {};
    poseSolverMetrics.facingChanges = 0;
    poseSolverMetrics.modeChanges = 0;
    poseSolverMetrics.occlusionActiveFrames = 0;
    poseSolverMetrics.maxOcclusionActiveTargets = 0;
    poseSolverMetrics.previousFacing = null;
    poseSolverMetrics.previousMode = null;
  }

  function resetTrackingRecoveryState() {
    trackingRecovery.lost = false;
    trackingRecovery.lastLostAt = 0;
    trackingRecovery.reacquiredAt = 0;
    trackingRecovery.blend = 1;
  }

  function updateTrackingRecoveryState(mode, timestamp) {
    const now = Number.isFinite(timestamp) ? timestamp : nowMs();

    if (mode === 'lost') {
      trackingRecovery.lost = true;
      trackingRecovery.lastLostAt = now;
      trackingRecovery.reacquiredAt = 0;
      trackingRecovery.blend = 0;
      return trackingRecovery.blend;
    }

    if (trackingRecovery.lost) {
      trackingRecovery.lost = false;
      trackingRecovery.reacquiredAt = now;
      trackingRecovery.blend = 0;
      return trackingRecovery.blend;
    }

    if (trackingRecovery.reacquiredAt > 0) {
      const elapsed = Math.max(0, now - trackingRecovery.reacquiredAt);
      trackingRecovery.blend = clamp01(elapsed / RETARGET_REACQUIRE_BLEND_MS);

      if (trackingRecovery.blend >= 1) {
        trackingRecovery.reacquiredAt = 0;
        trackingRecovery.blend = 1;
      }

      return trackingRecovery.blend;
    }

    trackingRecovery.blend = 1;
    return trackingRecovery.blend;
  }

  function applyLostTrackingBodyPose(timestamp, delta) {
    for (const target of BODY_RETARGETS) {
      applyOccludedBodyBone(target.bone, timestamp, delta, {
        holdMs: RETARGET_LOST_TRACKING_HOLD_MS,
        decayMs: RETARGET_LOST_TRACKING_DECAY_MS,
      });
    }
  }

  function getTrackingRecoverySnapshot() {
    return {
      lost: trackingRecovery.lost,
      lastLostAt: trackingRecovery.lastLostAt,
      reacquiredAt: trackingRecovery.reacquiredAt,
      blend: trackingRecovery.blend,
      lostHoldMs: RETARGET_LOST_TRACKING_HOLD_MS,
      lostDecayMs: RETARGET_LOST_TRACKING_DECAY_MS,
      reacquireBlendMs: RETARGET_REACQUIRE_BLEND_MS,
    };
  }

  function getPoseSolverMetricsSnapshot() {
    return {
      frames: poseSolverMetrics.frames,
      hingeViolationFrames: poseSolverMetrics.hingeViolationFrames,
      maxHingeViolations: poseSolverMetrics.maxHingeViolations,
      hingeLimitWarningFrames: poseSolverMetrics.hingeLimitWarningFrames,
      maxHingeLimitWarnings: poseSolverMetrics.maxHingeLimitWarnings,
      hingeLimitWarningByName: { ...poseSolverMetrics.hingeLimitWarningByName },
      maxHingeFlexDegByName: { ...poseSolverMetrics.maxHingeFlexDegByName },
      maxHingeOverflowDegByName: { ...poseSolverMetrics.maxHingeOverflowDegByName },
      facingChanges: poseSolverMetrics.facingChanges,
      modeChanges: poseSolverMetrics.modeChanges,
      occlusionActiveFrames: poseSolverMetrics.occlusionActiveFrames,
      maxOcclusionActiveTargets: poseSolverMetrics.maxOcclusionActiveTargets,
      currentFacing: poseSolverMetrics.previousFacing,
      currentMode: poseSolverMetrics.previousMode,
    };
  }

  function updateSourceAvatarDivergence(points) {
    if (!model) {
      lastSourceAvatarDivergence = null;
      return;
    }

    model.updateWorldMatrix(true, true);
    const segments = BODY_VALIDATION_SEGMENTS
      .map((segment) => getValidationSegment(segment, points))
      .filter(Boolean);

    lastSourceAvatarDivergence = {
      retargetMode: activeRetargetMode,
      segments,
      updatedAt: nowMs(),
    };
  }

  function getSourceAvatarDivergenceSnapshot() {
    const segments = lastSourceAvatarDivergence?.segments ?? [];

    return {
      ...buildSourceAvatarDivergenceSummary({
        segments,
        handOrientation,
        rootMotion: getRootMotionDivergenceContext(),
        retargetMode: activeRetargetMode,
      }),
      updatedAt: lastSourceAvatarDivergence?.updatedAt ?? null,
      segments: segments.map((segment) => ({
        name: segment.name,
        group: segment.group,
        bone: segment.bone,
        errorDeg: segment.errorDeg,
        targetDirection: segment.targetDirection,
        avatarDirection: segment.avatarDirection,
      })),
    };
  }

  function getRootMotionDivergenceContext() {
    return {
      yawOffsetDeg: THREE.MathUtils.radToDeg(rootMotion.yawOffset),
      orientationMetrics: rootMotion.orientationMetrics,
    };
  }

  function incrementNamedMetric(target, name, amount = 1) {
    target[name] = (target[name] ?? 0) + amount;
  }

  function updateNamedMaxMetric(target, name, value) {
    if (!Number.isFinite(value)) {
      return;
    }

    target[name] = Math.max(target[name] ?? -Infinity, value);
  }

  function applyOccludedBodyBone(boneNameKey, timestamp, delta, options = {}) {
    const bone = getBone(boneNameKey);
    const rest = getBoneRest(bone);

    if (!bone || !rest) {
      return;
    }

    const key = boneName(boneNameKey);
    const now = Number.isFinite(timestamp) ? timestamp : nowMs();
    let state = occludedBodyBones.get(key);

    if (!state) {
      state = {
        startedAt: now,
        holdQuaternion: bone.quaternion.clone(),
      };
      occludedBodyBones.set(key, state);
    }

    const elapsed = Math.max(0, now - state.startedAt);
    const holdMs = Number.isFinite(options.holdMs) ? Math.max(0, options.holdMs) : RETARGET_OCCLUSION_HOLD_MS;
    const decayMs = Number.isFinite(options.decayMs) ? Math.max(1, options.decayMs) : RETARGET_OCCLUSION_DECAY_MS;
    const decayProgress = options.decayImmediately
      ? 1
      : clamp01((elapsed - holdMs) / decayMs);

    if (decayProgress <= 0) {
      bone.quaternion.copy(state.holdQuaternion);
    } else {
      bone.quaternion.copy(
        tmpQuaternionG.copy(state.holdQuaternion).slerp(rest.quaternion, decayProgress),
      );
    }

    bone.updateMatrixWorld(true);
  }

  function clearBodyOcclusionState(boneNameKey) {
    occludedBodyBones.delete(boneName(boneNameKey));
  }

  function resetBodyOcclusionState() {
    occludedBodyBones.clear();
  }

  function getOcclusionSnapshot() {
    return {
      activeCount: occludedBodyBones.size,
      holdMs: RETARGET_OCCLUSION_HOLD_MS,
      decayMs: RETARGET_OCCLUSION_DECAY_MS,
      bones: Array.from(occludedBodyBones.keys()),
    };
  }

  function resolveBodySecondaryAxis(target, points) {
    if (target.secondaryFrom && target.secondaryTo) {
      return directionBetween(points[target.secondaryFrom], points[target.secondaryTo]);
    }

    return null;
  }

  function retargetConfidence(...points) {
    const visibilities = points
      .map((point) => point?.visibility)
      .filter((value) => Number.isFinite(value));

    if (visibilities.length === 0) {
      return 1;
    }

    const visibility = Math.min(...visibilities);

    if (visibility >= RETARGET_FULL_CONFIDENCE_VISIBILITY) {
      return 1;
    }

    return clamp01(
      (visibility - RETARGET_LOW_CONFIDENCE_HOLD) /
      (RETARGET_FULL_CONFIDENCE_VISIBILITY - RETARGET_LOW_CONFIDENCE_HOLD),
    );
  }

  function applyRootOrientation(points, delta, solvedPose = null) {
    if (!model) {
      return;
    }

    const metrics = sourceTorsoFacingMetrics(points);
    updateRootOrientationCalibration(metrics);
    const solverFacing = solvedPose?.meta?.facing ?? null;
    const facing = solverFacing || updateStableRootFacing(estimateRootFacing(metrics));
    const solverYawDeg = Number(solvedPose?.meta?.facingUnwrappedYawDeg ?? solvedPose?.meta?.facingYawDeg);
    const avatarYawDeg = Number.isFinite(solverYawDeg) ? resolveAvatarYawDeg(solverYawDeg) : null;
    const targetYawOffset = Number.isFinite(avatarYawDeg)
      ? THREE.MathUtils.degToRad(avatarYawDeg)
      : facingToRootYawOffset(facing);
    const yawRecovery = getSolverYawRecoveryState(solvedPose);
    const alpha = smoothingAlpha(
      delta,
      yawRecovery.active && !yawRecovery.hold ? ROOT_ORIENTATION_RECOVERY_SMOOTHING_MS : ROOT_ORIENTATION_SMOOTHING_MS,
    );
    const yawDelta = Number.isFinite(solverYawDeg)
      ? targetYawOffset - rootMotion.yawOffset
      : shortestAngle(targetYawOffset - rootMotion.yawOffset);

    rootMotion.facing = facing;
    rootMotion.candidateFacing = facing;
    rootMotion.candidateFacingFrames = 0;
    rootMotion.targetYawOffset = targetYawOffset;
    rootMotion.orientationMetrics = {
      ...metrics,
      solverFacing: solvedPose?.meta?.facingDetail ?? facing,
      solverYawDeg: Number.isFinite(Number(solvedPose?.meta?.facingYawDeg))
        ? Number(solvedPose.meta.facingYawDeg)
        : null,
      solverUnwrappedYawDeg: Number.isFinite(solverYawDeg) ? solverYawDeg : null,
      avatarTargetYawDeg: Number.isFinite(avatarYawDeg) ? avatarYawDeg : null,
      avatarYawSign: DEFAULT_AVATAR_YAW_SIGN,
      solverRawYawJump: Boolean(solvedPose?.meta?.facingRawYawJump),
      solverSideOrderFlip: Boolean(solvedPose?.meta?.facingSideOrderFlip),
      solverYawReliable: yawRecovery.reliable,
      solverYawReliabilityReason: yawRecovery.reason,
      solverUnreliableYawFrames: yawRecovery.unreliableFrames,
      solverStableYawFrames: yawRecovery.stableFrames,
      solverRecoveringFromUnreliableYaw: yawRecovery.recovering,
      solverRecoveryTargetYawDeg: yawRecovery.recoveryTargetYawDeg,
      solverUnstableYawCandidateDeg: yawRecovery.unstableCandidateYawDeg,
      solverUnstableYawCandidateFrames: yawRecovery.unstableCandidateFrames,
      rootYawRecoveryActive: yawRecovery.active,
      rootYawHoldActive: yawRecovery.hold,
      rootYawErrorDeg: THREE.MathUtils.radToDeg(yawDelta),
    };
    rootMotion.yawOffset = rootMotion.yawOffset + yawDelta * alpha;

    if (Math.abs(yawDelta) < 0.004) {
      rootMotion.yawOffset = targetYawOffset;
    }

    model.rotation.y = rootMotion.baseModelRotationY + rootMotion.yawOffset;
    model.updateWorldMatrix(true, true);
  }

  function applyStrictRootOrientation(points, delta, solvedPose = null, strictFrame = null) {
    if (!model) {
      return;
    }

    const metrics = sourceTorsoFacingMetrics(points);
    updateRootOrientationCalibration(metrics);
    const solverYawDeg = Number(strictFrame?.root?.yawUnwrappedDeg ?? solvedPose?.meta?.facingUnwrappedYawDeg ?? solvedPose?.meta?.facingYawDeg);
    const avatarYawDeg = Number.isFinite(solverYawDeg)
      ? solverYawDeg * DEFAULT_AVATAR_YAW_SIGN
      : null;
    const normalizedAvatarYawDeg = Number.isFinite(avatarYawDeg)
      ? resolveAvatarYawDeg(solverYawDeg)
      : null;
    const targetYawOffset = Number.isFinite(avatarYawDeg)
      ? THREE.MathUtils.degToRad(avatarYawDeg)
      : rootMotion.targetYawOffset;
    const yawDelta = targetYawOffset - rootMotion.yawOffset;
    const yawRecovery = getSolverYawRecoveryState(solvedPose, strictFrame);
    const smoothing = smoothingAlpha(
      delta,
      yawRecovery.active && !yawRecovery.hold ? ROOT_ORIENTATION_RECOVERY_SMOOTHING_MS : ROOT_ORIENTATION_SMOOTHING_MS,
    );
    const maxYawRateDegPerSec = yawRecovery.active && !yawRecovery.hold
      ? ROOT_ORIENTATION_RECOVERY_MAX_YAW_RATE_DEG_PER_SEC
      : ROOT_ORIENTATION_MAX_YAW_RATE_DEG_PER_SEC;
    const maxYawStep = THREE.MathUtils.degToRad(maxYawRateDegPerSec) * Math.max(0.001, delta / 1000);
    const yawStep = clamp(yawDelta * smoothing, -maxYawStep, maxYawStep);

    rootMotion.facing = solvedPose?.meta?.facing ?? rootMotion.facing;
    rootMotion.candidateFacing = rootMotion.facing;
    rootMotion.candidateFacingFrames = 0;
    rootMotion.targetYawOffset = targetYawOffset;
    rootMotion.orientationMetrics = {
      ...metrics,
      solverFacing: solvedPose?.meta?.facingDetail ?? rootMotion.facing,
      solverYawDeg: Number.isFinite(Number(solvedPose?.meta?.facingYawDeg))
        ? Number(solvedPose.meta.facingYawDeg)
        : null,
      solverUnwrappedYawDeg: Number.isFinite(solverYawDeg) ? solverYawDeg : null,
      avatarTargetYawDeg: Number.isFinite(normalizedAvatarYawDeg) ? normalizedAvatarYawDeg : null,
      avatarTargetUnwrappedYawDeg: Number.isFinite(avatarYawDeg) ? avatarYawDeg : null,
      avatarYawSign: DEFAULT_AVATAR_YAW_SIGN,
      strictNumericYaw: true,
      strictYawSmoothingAlpha: smoothing,
      strictMaxYawRateDegPerSec: maxYawRateDegPerSec,
      strictYawRecoveryActive: yawRecovery.active,
      strictYawHoldActive: yawRecovery.hold,
      strictYawErrorDeg: THREE.MathUtils.radToDeg(yawDelta),
      solverRawYawJump: Boolean(solvedPose?.meta?.facingRawYawJump),
      solverSideOrderFlip: Boolean(solvedPose?.meta?.facingSideOrderFlip),
      solverYawReliable: yawRecovery.reliable,
      solverYawReliabilityReason: yawRecovery.reason,
      solverUnreliableYawFrames: yawRecovery.unreliableFrames,
      solverStableYawFrames: yawRecovery.stableFrames,
      solverRecoveringFromUnreliableYaw: yawRecovery.recovering,
      solverRecoveryTargetYawDeg: yawRecovery.recoveryTargetYawDeg,
      solverUnstableYawCandidateDeg: yawRecovery.unstableCandidateYawDeg,
      solverUnstableYawCandidateFrames: yawRecovery.unstableCandidateFrames,
    };
    rootMotion.yawOffset += yawStep;

    if (Math.abs(targetYawOffset - rootMotion.yawOffset) < 0.004) {
      rootMotion.yawOffset = targetYawOffset;
    }

    model.rotation.y = rootMotion.baseModelRotationY + rootMotion.yawOffset;
    model.updateWorldMatrix(true, true);
  }

  function getSolverYawRecoveryState(solvedPose = null, strictFrame = null) {
    const meta = solvedPose?.meta ?? {};
    const root = strictFrame?.root ?? {};
    const reliableValue = meta.facingYawReliable ?? root.yawReliable;
    const recoveryTargetYawDeg = numberOrNull(meta.facingRecoveryTargetYawDeg ?? root.recoveryTargetYawDeg);
    const recovering = Boolean(meta.facingRecoveringFromUnreliableYaw ?? root.recoveringFromUnreliableYaw);
    const reliable = typeof reliableValue === 'boolean' ? reliableValue : null;

    return {
      reliable,
      reason: meta.facingYawReliabilityReason ?? root.yawReliabilityReason ?? null,
      unreliableFrames: integerOrNull(meta.facingUnreliableYawFrames ?? root.unreliableYawFrames),
      stableFrames: integerOrNull(meta.facingStableYawFrames ?? root.stableYawFrames),
      recovering,
      recoveryTargetYawDeg,
      unstableCandidateYawDeg: numberOrNull(meta.facingUnstableYawCandidateDeg ?? root.unstableYawCandidateDeg),
      unstableCandidateFrames: integerOrNull(
        meta.facingUnstableYawCandidateFrames ?? root.unstableYawCandidateFrames,
      ),
      active: recovering || Number.isFinite(recoveryTargetYawDeg),
      hold: reliable === false,
    };
  }

  function numberOrNull(value) {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function integerOrNull(value) {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : null;
  }

  function sourceTorsoFacingMetrics(points) {
    const deltas = [];
    const widths = [];

    if (points.leftShoulder && points.rightShoulder) {
      const delta = points.leftShoulder.x - points.rightShoulder.x;
      deltas.push(delta);
      widths.push(Math.abs(delta));
    }

    if (points.leftHip && points.rightHip) {
      const delta = points.leftHip.x - points.rightHip.x;
      deltas.push(delta);
      widths.push(Math.abs(delta));
    }

    const signedMagnitude = deltas.reduce((sum, delta) => {
      if (!Number.isFinite(delta) || Math.abs(delta) < ROOT_ORIENTATION_SIDE_ORDER_EPSILON) {
        return sum;
      }

      return sum + Math.sign(delta) * Math.abs(delta);
    }, 0);
    const width = widths.length > 0
      ? widths.reduce((sum, value) => sum + value, 0) / widths.length
      : 0;
    const height = points.shoulderMid && points.hipMid
      ? Math.abs(points.shoulderMid.y - points.hipMid.y)
      : 0;
    const baseWidth = rootMotion.baseTorsoWidth > ROOT_ORIENTATION_MIN_WIDTH
      ? rootMotion.baseTorsoWidth
      : width;
    const widthRatio = baseWidth > ROOT_ORIENTATION_MIN_WIDTH ? width / baseWidth : 1;
    const widthHeightRatio = height > ROOT_ORIENTATION_MIN_WIDTH ? width / height : 1;
    const faceVisible = Boolean(points.nose || points.eyeMid || points.earMid);
    const hasShoulderPair = Boolean(points.leftShoulder && points.rightShoulder);
    const hasHipPair = Boolean(points.leftHip && points.rightHip);

    return {
      sign: Math.abs(signedMagnitude) >= ROOT_ORIENTATION_SIDE_ORDER_EPSILON
        ? Math.sign(signedMagnitude)
        : 0,
      signedMagnitude,
      width,
      height,
      baseWidth,
      widthRatio,
      widthHeightRatio,
      faceVisible,
      hasShoulderPair,
      hasHipPair,
    };
  }

  function updateStableRootFacing(inferredFacing) {
    const nextFacing = inferredFacing || rootMotion.facing;

    if (nextFacing === rootMotion.facing) {
      rootMotion.candidateFacing = nextFacing;
      rootMotion.candidateFacingFrames = 0;
      return rootMotion.facing;
    }

    if (rootMotion.candidateFacing !== nextFacing) {
      rootMotion.candidateFacing = nextFacing;
      rootMotion.candidateFacingFrames = 1;
    } else {
      rootMotion.candidateFacingFrames += 1;
    }

    if (rootMotion.candidateFacingFrames >= ROOT_ORIENTATION_SWITCH_FRAMES) {
      rootMotion.facing = nextFacing;
      rootMotion.candidateFacingFrames = 0;
    }

    return rootMotion.facing;
  }

  function updateRootOrientationCalibration(metrics) {
    if (
      !metrics ||
      rootMotion.orientationFrames >= ROOT_MOTION_CALIBRATION_FRAMES ||
      !Number.isFinite(metrics.width) ||
      metrics.width <= ROOT_ORIENTATION_MIN_WIDTH
    ) {
      return;
    }

    rootMotion.torsoWidthSum += metrics.width;
    rootMotion.torsoHeightSum += Number.isFinite(metrics.height) ? metrics.height : 0;
    rootMotion.orientationFrames += 1;

    if (rootMotion.orientationFrames >= ROOT_MOTION_CALIBRATION_FRAMES) {
      rootMotion.baseTorsoWidth = rootMotion.torsoWidthSum / rootMotion.orientationFrames;
      rootMotion.baseTorsoHeight = rootMotion.torsoHeightSum / rootMotion.orientationFrames;
    }
  }

  function estimateRootFacing(metrics) {
    if (!metrics) {
      return rootMotion.facing;
    }

    const widthRatio = Number.isFinite(metrics.widthRatio) ? metrics.widthRatio : 1;
    const widthHeightRatio = Number.isFinite(metrics.widthHeightRatio)
      ? metrics.widthHeightRatio
      : 1;

    if (metrics.faceVisible && widthRatio <= ROOT_ORIENTATION_SIDE_WIDTH_RATIO) {
      return 'side';
    }

    if (metrics.faceVisible && widthHeightRatio <= ROOT_ORIENTATION_SIDE_ASPECT_RATIO) {
      return 'side';
    }

    if (widthRatio <= ROOT_ORIENTATION_NARROW_SIDE_WIDTH_RATIO && metrics.sign === 0) {
      return 'side';
    }

    if (metrics.faceVisible) {
      return 'front';
    }

    return 'front';
  }

  function facingToRootYawOffset(facing) {
    if (facing === 'side') {
      return Math.PI / 2;
    }

    return 0;
  }

  function applyRootMotion(landmarks, mirrored, delta) {
    if (!model) {
      return;
    }

    const sourcePoints = buildPosePoints2D(landmarks, mirrored);
    const center = midpoint2D(sourcePoints.shoulderMid, sourcePoints.hipMid)
      ?? sourcePoints.shoulderMid
      ?? sourcePoints.hipMid;
    const torsoScale = sourcePoints.shoulderMid && sourcePoints.hipMid
      ? distance2D(sourcePoints.shoulderMid, sourcePoints.hipMid)
      : 0;
    const shoulderScale = sourcePoints.leftShoulder && sourcePoints.rightShoulder
      ? distance2D(sourcePoints.leftShoulder, sourcePoints.rightShoulder)
      : 0;
    const hipScale = sourcePoints.leftHip && sourcePoints.rightHip
      ? distance2D(sourcePoints.leftHip, sourcePoints.rightHip)
      : 0;
    const sourceScale = Math.max(torsoScale, shoulderScale, hipScale, 0);

    if (!center || sourceScale < ROOT_MOTION_MIN_SCALE) {
      return;
    }

    if (!rootMotion.frozen) {
      rootMotion.centerXSum += center.x;
      rootMotion.centerYSum += center.y;
      rootMotion.scaleSum += sourceScale;
      rootMotion.frames += 1;

      if (rootMotion.frames >= ROOT_MOTION_CALIBRATION_FRAMES) {
        rootMotion.baseCenter = {
          x: rootMotion.centerXSum / rootMotion.frames,
          y: rootMotion.centerYSum / rootMotion.frames,
        };
        rootMotion.baseScale = rootMotion.scaleSum / rootMotion.frames;
        rootMotion.frozen = true;
      } else {
        return;
      }
    }

    const baseCenter = rootMotion.baseCenter;

    if (!baseCenter) {
      return;
    }

    const targetOffset = tmpVectorD.set(
      clamp(-(center.x - baseCenter.x) * modelHeight * ROOT_MOTION_HORIZONTAL_SCALE, -rootMotion.maxOffset.x, rootMotion.maxOffset.x),
      clamp(-(center.y - baseCenter.y) * modelHeight * ROOT_MOTION_VERTICAL_SCALE, -rootMotion.maxOffset.y, rootMotion.maxOffset.y),
      0,
    );
    const alpha = smoothingAlpha(delta, RETARGET_SMOOTHING_MS.torso);

    rootMotion.offset.lerp(targetOffset, alpha);
    model.position.copy(rootMotion.baseModelPosition).add(rootMotion.offset);
    model.updateMatrixWorld(true);
  }

  function applyScreenSpaceProportionCalibration(landmarks, mirrored) {
    if (!model || !camera || proportionCalibration.frozen || !activeModelProfile.proportionCalibration) {
      return;
    }

    model.updateWorldMatrix(true, true);

    const sourceNormalized = normalizePose2D(buildPosePoints2D(landmarks, mirrored));
    const avatarNormalized = normalizePose2D(buildAvatarProjectedPoints());
    let validSegments = 0;
    let lowerBodySegments = 0;

    for (const segment of SCREEN_LENGTH_CALIBRATION_SEGMENTS) {
      const bone = getBone(segment.bone);
      const rest = getBoneRest(bone);
      const sourceFrom = sourceNormalized.points[segment.sourceFrom];
      const sourceTo = sourceNormalized.points[segment.sourceTo];
      const avatarFrom = avatarNormalized.points[segment.avatarFrom];
      const avatarTo = avatarNormalized.points[segment.avatarTo];

      if (!bone || !rest || !sourceFrom || !sourceTo || !avatarFrom || !avatarTo) {
        continue;
      }

      const sourceLength = distance2D(sourceFrom, sourceTo);
      const avatarLength = distance2D(avatarFrom, avatarTo);

      if (sourceLength < 0.0001 || avatarLength < 0.0001 || rest.position.lengthSq() < 0.000001) {
        continue;
      }

      const targetScale = clamp(
        sourceLength / avatarLength,
        MIN_BONE_LENGTH_SCALE,
        segment.maxScale ?? MAX_BONE_LENGTH_SCALE,
      );
      recordProportionCalibrationSample(bone.name, targetScale);
      validSegments += 1;

      if (isLowerBodyScreenCalibrationSegment(segment)) {
        lowerBodySegments += 1;
      }
    }

    const requiredSegments = lowerBodySegments > 0
      ? PROPORTION_CALIBRATION_MIN_SEGMENTS
      : PROPORTION_CALIBRATION_MIN_UPPER_BODY_SEGMENTS;

    if (validSegments >= requiredSegments) {
      proportionCalibration.frames += 1;
    }

    if (proportionCalibration.frames >= PROPORTION_CALIBRATION_FRAMES) {
      freezeProportionCalibration();
    }
  }

  function isLowerBodyScreenCalibrationSegment(segment) {
    return /(?:UpLeg|Leg|Foot|Hip|Knee|Ankle)/.test(
      `${segment.bone} ${segment.sourceFrom} ${segment.sourceTo} ${segment.avatarFrom} ${segment.avatarTo}`,
    );
  }

  function recordProportionCalibrationSample(boneNameKey, scale) {
    const samples = proportionCalibration.samples.get(boneNameKey) ?? [];
    samples.push(scale);
    proportionCalibration.samples.set(boneNameKey, samples);
  }

  function freezeProportionCalibration() {
    if (proportionCalibration.frozen) {
      return;
    }

    let appliedCount = 0;
    let maxScaleDelta = 0;

    const appliedScales = {};

    for (const [boneNameKey, samples] of proportionCalibration.samples) {
      const bone = bones.get(boneNameKey);
      const rest = getBoneRest(bone);

      if (!bone || !rest || samples.length < Math.max(4, PROPORTION_CALIBRATION_FRAMES / 4)) {
        continue;
      }

      const averageScale = clamp(
        percentile(samples.slice().sort((a, b) => a - b), PROPORTION_CALIBRATION_PERCENTILE),
        MIN_BONE_LENGTH_SCALE,
        MAX_HAND_LENGTH_SCALE,
      );
      bone.position.copy(rest.position).multiplyScalar(averageScale);
      bone.updateMatrixWorld(true);
      appliedCount += 1;
      maxScaleDelta = Math.max(maxScaleDelta, Math.abs(averageScale - 1));
      appliedScales[boneNameKey] = averageScale;
    }

    proportionCalibration.lastAppliedCount = appliedCount;
    proportionCalibration.lastMaxScaleDelta = maxScaleDelta;
    proportionCalibration.appliedScales = appliedScales;
    proportionCalibration.frozen = true;
    proportionCalibration.samples.clear();
  }

  function resetProportionCalibration() {
    proportionCalibration.frames = 0;
    proportionCalibration.frozen = false;
    proportionCalibration.lastAppliedCount = 0;
    proportionCalibration.lastMaxScaleDelta = 0;
    proportionCalibration.appliedScales = {};
    proportionCalibration.samples.clear();
  }

  function resetRootMotion(clearCalibration = true) {
    rootMotion.offset.set(0, 0, 0);
    rootMotion.yawOffset = 0;
    rootMotion.facing = 'front';
    rootMotion.candidateFacing = 'front';
    rootMotion.candidateFacingFrames = 0;
    rootMotion.targetYawOffset = 0;
    rootMotion.orientationMetrics = null;

    if (clearCalibration) {
      rootMotion.frames = 0;
      rootMotion.frozen = false;
      rootMotion.centerXSum = 0;
      rootMotion.centerYSum = 0;
      rootMotion.scaleSum = 0;
      rootMotion.orientationFrames = 0;
      rootMotion.torsoWidthSum = 0;
      rootMotion.torsoHeightSum = 0;
      rootMotion.baseCenter = null;
      rootMotion.baseScale = 0;
      rootMotion.baseTorsoWidth = 0;
      rootMotion.baseTorsoHeight = 0;
    }

    if (model) {
      model.position.copy(rootMotion.baseModelPosition);
      model.rotation.y = rootMotion.baseModelRotationY;
      model.updateMatrixWorld(true);
    }
  }

  function applyHands(hands, mirrored, delta) {
    const usedSides = new Set();
    const relaxAlpha = smoothingAlpha(delta, RETARGET_SMOOTHING_MS.relax);

    for (const hand of hands) {
      const side = resolveHandSide(hand, mirrored, usedSides);

      if (!side) {
        continue;
      }

      usedSides.add(side);
      applyHand(side, hand, mirrored, delta);
    }

    for (const side of ['Left', 'Right']) {
      if (!usedSides.has(side)) {
        relaxHand(side, relaxAlpha * 0.4);
        handOrientation[side] = {
          side,
          tracked: false,
          source: 'none',
        };
      }
    }
  }

  function applyFaceExpressions(face, delta) {
    if (!vrmExpressionMapping?.resolvedMorphTargetCount) {
      return;
    }

    const startedAt = nowMs();

    try {
      const targetScores = face?.blendShapes
        ? mapMediaPipeBlendShapesToVrmPresets(face.blendShapes)
        : {};

      if (hasExpressionPreset('blinkLeft') || hasExpressionPreset('blinkRight')) {
        delete targetScores.blink;
      }

      faceExpressionScores = applyVrmExpressionScores(
        vrmExpressionMapping,
        targetScores,
        faceExpressionScores,
        buildFaceExpressionSmoothingAlpha(delta),
      );
    } catch (error) {
      console.warn('Face expression update skipped', error);
    } finally {
      recordPerformanceSample(performanceStats.faceApplyMs, nowMs() - startedAt);
    }
  }

  function buildFaceExpressionSmoothingAlpha(delta) {
    return Object.fromEntries(
      Object.entries(FACE_EXPRESSION_SMOOTHING_MS)
        .map(([preset, smoothingMs]) => [preset, smoothingAlpha(delta, smoothingMs)]),
    );
  }

  function applyFaceHeadPose(face, mirrored, delta, timestamp = 0) {
    const transform = faceTransformQuaternion(face?.transformMatrix);
    const tracker = updateFaceHeadPoseTracker(faceHeadPose, transform.quaternion, timestamp, {
      trackingGraceMs: FACE_HEAD_TRACKING_GRACE_MS,
      reacquireBlendMs: FACE_HEAD_REACQUIRE_BLEND_MS,
    });

    faceHeadPose.lastStatus = tracker.status;
    faceHeadPose.lastTracked = tracker.tracked;
    faceHeadPose.lastWithinGrace = tracker.withinGrace;
    faceHeadPose.lastGapMs = Number.isFinite(tracker.gapMs) ? tracker.gapMs : null;
    faceHeadPose.lastReacquireBlend = tracker.reacquireBlend;

    if (transform.valid) {
      faceHeadPose.lastLayout = transform.layout;
      faceHeadPose.lastMatrixDiagnostics = transform.diagnostics;
    }

    if (!tracker.apply) {
      recordFaceHeadPoseTelemetry(null, delta, tracker, 0);
      return;
    }

    const poseDelta = computeFaceHeadDelta({
      baseQuaternion: faceHeadPose.baseQuaternion,
      sourceQuaternion: tracker.sourceQuaternion,
      mirrored,
      maxAngleRad: FACE_HEAD_POSE_MAX_ANGLE,
    });

    if (!poseDelta.valid) {
      recordFaceHeadPoseTelemetry(null, delta, tracker, 0);
      return;
    }

    const deltaQuaternion = plainQuaternionToThree(poseDelta.quaternion, tmpQuaternionF);
    const alpha = smoothingAlpha(delta, FACE_HEAD_POSE_SMOOTHING_MS) * tracker.reacquireBlend;

    applyLocalPoseDeltaToBone('Neck', deltaQuaternion, alpha * FACE_NECK_POSE_STRENGTH, FACE_NECK_POSE_MAX_ANGLE);
    applyLocalPoseDeltaToBone('Head', deltaQuaternion, alpha * FACE_HEAD_POSE_STRENGTH, FACE_HEAD_POSE_MAX_ANGLE);
    recordFaceHeadPoseTelemetry(poseDelta.eulerRad, delta, tracker, alpha);
  }

  function faceTransformQuaternion(transformMatrix) {
    return readFaceTransformQuaternion(transformMatrix);
  }

  function plainQuaternionToThree(quaternion, target) {
    if (!Number.isFinite(quaternion?.x) ||
      !Number.isFinite(quaternion?.y) ||
      !Number.isFinite(quaternion?.z) ||
      !Number.isFinite(quaternion?.w)
    ) {
      return target.identity();
    }

    return target
      .set(quaternion.x, quaternion.y, quaternion.z, quaternion.w)
      .normalize();
  }

  function recordFaceHeadPoseTelemetry(eulerRad, delta, tracker, alpha) {
    faceHeadPose.lastEulerDeg = eulerRad ? eulerRadToDeg(eulerRad) : null;
    faceHeadPose.lastBoneEulerDeg = getBoneRestRelativeEulerDeg('Head');
    const headBone = getBone('Head');
    const angularVelocity = estimateFaceHeadBoneAngularVelocity(headBone, delta);

    faceHeadPose.lastBoneAngularVelocityDegPerSec = angularVelocity;

    if (Number.isFinite(angularVelocity) && angularVelocity > FACE_HEAD_JUMP_THRESHOLD_DEG_PER_SEC) {
      faceHeadPose.jumpCount += 1;
      faceHeadPose.lastJumpReason = resolveFaceHeadJumpReason(tracker);
    }

    faceHeadPose.lastAppliedAlpha = alpha;
  }

  function estimateFaceHeadBoneAngularVelocity(headBone, delta) {
    if (!headBone) {
      return null;
    }

    if (!faceHeadPose.lastBoneQuaternion) {
      faceHeadPose.lastBoneQuaternion = headBone.quaternion.clone();
      return 0;
    }

    const deltaSeconds = Math.max(0.001, delta / 1000);
    const angleDeg = THREE.MathUtils.radToDeg(faceHeadPose.lastBoneQuaternion.angleTo(headBone.quaternion));
    faceHeadPose.lastBoneQuaternion.copy(headBone.quaternion);

    return angleDeg / deltaSeconds;
  }

  function resolveFaceHeadJumpReason(tracker) {
    if (tracker.status === 'reacquired') {
      return 'face-reacquired';
    }

    if (tracker.status === 'holding' || tracker.status === 'missing') {
      return 'face-gap';
    }

    if (rootMotion.orientationMetrics?.solverRawYawJump || rootMotion.orientationMetrics?.solverSideOrderFlip) {
      return 'root-yaw-jump';
    }

    return 'head-bone-jump';
  }

  function eulerRadToDeg(eulerRad) {
    return {
      x: THREE.MathUtils.radToDeg(eulerRad.x),
      y: THREE.MathUtils.radToDeg(eulerRad.y),
      z: THREE.MathUtils.radToDeg(eulerRad.z),
    };
  }

  function getBoneRestRelativeEulerDeg(boneName) {
    const bone = getBone(boneName);
    const rest = getBoneRest(bone);

    if (!bone || !rest) {
      return null;
    }

    tmpQuaternionH
      .copy(rest.quaternion)
      .invert()
      .multiply(bone.quaternion)
      .normalize();
    tmpEulerA.setFromQuaternion(tmpQuaternionH, 'YXZ');

    return eulerRadToDeg(tmpEulerA);
  }

  function applyLocalPoseDeltaToBone(boneName, deltaQuaternion, alpha, maxAngle) {
    const bone = getBone(boneName);
    const rest = getBoneRest(bone);

    if (!bone || !rest) {
      return;
    }

    const targetQuaternion = tmpQuaternionE.copy(rest.quaternion).multiply(deltaQuaternion).normalize();
    const limitedTarget = limitFromRest(rest.quaternion, targetQuaternion, maxAngle);

    bone.quaternion.slerp(limitedTarget, clamp01(alpha));
    bone.updateMatrixWorld(true);
  }

  function resetFaceExpressions() {
    if (!vrmExpressionMapping?.resolvedMorphTargetCount) {
      faceExpressionScores = {};
      return;
    }

    faceExpressionScores = applyVrmExpressionScores(vrmExpressionMapping, {}, faceExpressionScores, 1);
  }

  function resetFaceHeadPose() {
    resetFaceHeadPoseTrackerState(faceHeadPose);
    faceHeadPose.lastStatus = 'reset';
    faceHeadPose.lastTracked = false;
    faceHeadPose.lastWithinGrace = false;
    faceHeadPose.lastGapMs = null;
    faceHeadPose.lastReacquireBlend = 0;
    faceHeadPose.lastEulerDeg = null;
    faceHeadPose.lastBoneEulerDeg = null;
    faceHeadPose.lastBoneAngularVelocityDegPerSec = null;
    faceHeadPose.lastJumpReason = null;
    faceHeadPose.lastBoneQuaternion = null;
  }

  function hasExpressionPreset(preset) {
    return Boolean(vrmExpressionMapping?.presets?.[preset]);
  }

  function applyHand(side, hand, mirrored, delta) {
    const landmarks = hand?.landmarks;
    const worldLandmarks = hand?.worldLandmarks;

    if (!isLandmarkList(landmarks)) {
      return;
    }

    const points = landmarks.map((landmark) => landmarkToVector(landmark, mirrored));
    const worldPoints = isLandmarkList(worldLandmarks)
      ? worldLandmarks.map((landmark) => handWorldLandmarkToVector(landmark, mirrored))
      : null;
    const wrist = points[0];
    const indexBase = points[5];
    const middleBase = points[9];
    const pinkyBase = points[17];
    const worldPalmOrientation = worldPoints
      ? resolveHandPalmNormal({
          wrist: worldPoints[0],
          indexBase: worldPoints[5],
          pinkyBase: worldPoints[17],
          side,
          normalSigns: DEFAULT_PALM_NORMAL_SIGNS,
        })
      : null;
    const imagePalmOrientation = resolveHandPalmNormal({
      wrist,
      indexBase,
      pinkyBase,
      side,
      normalSigns: DEFAULT_PALM_NORMAL_SIGNS,
    });
    const palmOrientation = worldPalmOrientation?.valid ? worldPalmOrientation : imagePalmOrientation;
    const handAlpha = smoothingAlpha(delta, RETARGET_SMOOTHING_MS.hand);
    const fingerAlpha = smoothingAlpha(delta, RETARGET_SMOOTHING_MS.finger);
    const strictHandAlpha = activeRetargetMode === RETARGET_MODE_STRICT ? 1 : null;
    const palmNormal = palmOrientation?.normal
      ? plainVectorToThree(palmOrientation.normal, tmpVectorD)
      : null;

    if (wrist && middleBase) {
      tmpVectorC.subVectors(middleBase, wrist);
      applyAimToBone(`${side}Hand`, tmpVectorC, strictHandAlpha ?? handAlpha * 0.65, activeRetargetMode === RETARGET_MODE_STRICT ? undefined : 1.05, {
        maxTwist: activeRetargetMode === RETARGET_MODE_STRICT ? undefined : 0.62,
        secondaryWorld: palmNormal,
      });
    }

    handOrientation[side] = buildHandOrientationSnapshot({
      side,
      mirrored,
      source: worldPalmOrientation?.valid ? 'worldLandmarks' : imagePalmOrientation.valid ? 'imageLandmarks' : 'none',
      orientation: palmOrientation,
      actualPalmNormal: getBoneWorldSecondaryAxis(`${side}Hand`),
    });

    for (const fingerName of Object.keys(HAND_FINGERS)) {
      const chain = fingerChains[side].get(fingerName) ?? [];
      const segmentCount = getFingerSegmentCount(fingerName);

      for (let i = 0; i < Math.min(chain.length, segmentCount); i += 1) {
        const segmentPoints = resolveFingerSegmentPoints(points, fingerName, i);

        if (!segmentPoints) {
          continue;
        }

        const { from, to } = segmentPoints;
        const spreadStrength = i === 0 ? 1 : 0.75;
        const segmentAlpha = i === 0
          ? smoothingAlpha(delta, RETARGET_SMOOTHING_MS.fingerBase)
          : fingerAlpha;
        tmpVectorC.subVectors(to, from);
        const fingerConstraint = getFingerAimConstraint(fingerName, i);
        applyAimToBone(chain[i], tmpVectorC, strictHandAlpha ?? segmentAlpha * spreadStrength, fingerConstraint.maxAngle, {
          maxTwist: fingerConstraint.maxTwist,
        });
      }
    }
  }

  function getFingerAimConstraint(fingerName, segmentIndex) {
    if (fingerName === "Thumb") {
      return segmentIndex === 0
        ? { maxAngle: THREE.MathUtils.degToRad(90), maxTwist: THREE.MathUtils.degToRad(60) }
        : { maxAngle: THREE.MathUtils.degToRad(75), maxTwist: THREE.MathUtils.degToRad(28) };
    }

    if (segmentIndex === 0) {
      return { maxAngle: THREE.MathUtils.degToRad(95), maxTwist: THREE.MathUtils.degToRad(28) };
    }

    return { maxAngle: THREE.MathUtils.degToRad(82), maxTwist: THREE.MathUtils.degToRad(18) };
  }

  function computeLimbPlaneNormals(points) {
    return {
      LeftArm: limbPlaneNormal(points.leftShoulder, points.leftElbow, points.leftWrist),
      LeftForeArm: limbPlaneNormal(points.leftShoulder, points.leftElbow, points.leftWrist),
      RightArm: limbPlaneNormal(points.rightShoulder, points.rightElbow, points.rightWrist),
      RightForeArm: limbPlaneNormal(points.rightShoulder, points.rightElbow, points.rightWrist),
      LeftUpLeg: limbPlaneNormal(points.leftHip, points.leftKnee, points.leftAnkle),
      LeftLeg: limbPlaneNormal(points.leftHip, points.leftKnee, points.leftAnkle),
      RightUpLeg: limbPlaneNormal(points.rightHip, points.rightKnee, points.rightAnkle),
      RightLeg: limbPlaneNormal(points.rightHip, points.rightKnee, points.rightAnkle),
    };
  }

  function limbPlaneNormal(root, mid, end) {
    if (!root || !mid || !end) {
      return null;
    }

    const first = tmpVectorA.subVectors(mid, root);
    const second = tmpVectorB.subVectors(end, mid);
    const normal = new THREE.Vector3().crossVectors(first, second);

    return normal.lengthSq() > 0.000001 ? normal.normalize() : null;
  }

  function directionBetween(from, to) {
    if (!from || !to) {
      return null;
    }

    const direction = new THREE.Vector3().subVectors(to, from);
    return direction.lengthSq() > 0.000001 ? direction.normalize() : null;
  }

  function computePalmNormal(wrist, indexBase, pinkyBase) {
    if (!wrist || !indexBase || !pinkyBase) {
      return null;
    }

    const indexVector = tmpVectorA.subVectors(indexBase, wrist);
    const pinkyVector = tmpVectorB.subVectors(pinkyBase, wrist);
    const normal = new THREE.Vector3().crossVectors(indexVector, pinkyVector);

    return normal.lengthSq() > 0.000001 ? normal.normalize() : null;
  }

  function plainVectorToThree(vector, target) {
    return target.set(
      Number(vector.x ?? 0),
      Number(vector.y ?? 0),
      Number(vector.z ?? 0),
    );
  }

  function buildHandOrientationSnapshot({ side, mirrored, source, orientation, actualPalmNormal = null }) {
    const targetPalmNormal = orientation?.normal ? vectorToArray(orientation.normal) : null;

    return {
      side,
      tracked: Boolean(orientation?.valid),
      source,
      mirrored,
      palmNormalSign: orientation?.sign ?? DEFAULT_PALM_NORMAL_SIGNS[side] ?? -1,
      rawPalmNormal: orientation?.rawNormal ? vectorToArray(orientation.rawNormal) : null,
      targetPalmNormal,
      avatarPalmNormal: actualPalmNormal ? vectorToArray(actualPalmNormal) : targetPalmNormal,
    };
  }

  function getBoneWorldSecondaryAxis(boneNameKey) {
    const bone = getBone(boneNameKey);
    const rest = getBoneRest(bone);

    if (!bone || !rest?.secondaryAxisLocal) {
      return null;
    }

    return rest.secondaryAxisLocal
      .clone()
      .normalize()
      .applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()))
      .normalize();
  }

  function applyAimToBone(boneOrName, directionWorld, alpha, maxAngle, options = {}) {
    const bone = typeof boneOrName === 'string' ? getBone(boneOrName) : boneOrName;

    if (!bone || directionWorld.lengthSq() < 0.000001) {
      return;
    }

    const rest = getBoneRest(bone);

    if (!rest) {
      return;
    }

    bone.parent?.updateWorldMatrix(true, false);
    const parentWorldQuaternion = bone.parent
      ? bone.parent.getWorldQuaternion(tmpQuaternionA)
      : tmpQuaternionA.identity();
    const inverseParentWorld = tmpQuaternionB.copy(parentWorldQuaternion).invert();
    const targetDirectionLocal = tmpVectorA.copy(directionWorld).normalize().applyQuaternion(inverseParentWorld).normalize();
    const restDirectionLocal = tmpVectorB.copy(rest.axisLocal).applyQuaternion(rest.quaternion).normalize();
    const targetQuaternion = options.secondaryWorld
      ? applyAimWithSecondary(rest, targetDirectionLocal, options.secondaryWorld, inverseParentWorld)
      : tmpQuaternionD.multiplyQuaternions(
        tmpQuaternionC.setFromUnitVectors(restDirectionLocal, targetDirectionLocal),
        rest.quaternion,
      );
    const angleLimitedTarget = limitFromRest(rest.quaternion, targetQuaternion, maxAngle);
    const limitedTarget = limitTwistFromRest(
      rest.quaternion,
      angleLimitedTarget,
      rest.axisLocal,
      options.maxTwist,
    );
    const restAngle = rest.quaternion.angleTo(limitedTarget);

    if (Number.isFinite(options.deadband) && restAngle <= options.deadband) {
      bone.quaternion.slerp(rest.quaternion, clamp01(alpha * 0.5));
      bone.updateMatrixWorld(true);
      return;
    }

    if (Number.isFinite(options.hysteresis) && bone.quaternion.angleTo(limitedTarget) <= options.hysteresis) {
      return;
    }

    bone.quaternion.slerp(limitedTarget, clamp01(alpha));
    bone.updateMatrixWorld(true);
  }

  function applyAimWithSecondary(rest, targetDirectionLocal, secondaryWorld, inverseParentWorld) {
    const targetSecondaryLocal = tmpVectorC
      .copy(secondaryWorld)
      .normalize()
      .applyQuaternion(inverseParentWorld)
      .normalize();
    const restDirectionLocal = tmpVectorG.copy(rest.axisLocal).applyQuaternion(rest.quaternion).normalize();
    const restSecondaryLocal = tmpVectorH
      .copy(rest.secondaryAxisLocal)
      .applyQuaternion(rest.quaternion)
      .normalize();

    return tmpQuaternionD.multiplyQuaternions(
      basisQuaternion(targetDirectionLocal, targetSecondaryLocal, tmpMatrixA, tmpQuaternionE),
      basisQuaternion(restDirectionLocal, restSecondaryLocal, tmpMatrixB, tmpQuaternionF).invert(),
    ).multiply(rest.quaternion);
  }

  function basisQuaternion(primary, secondary, matrix, target) {
    const xAxis = tmpVectorD.copy(primary).normalize();
    const yAxis = tmpVectorE.copy(secondary).addScaledVector(xAxis, -secondary.dot(xAxis));

    if (yAxis.lengthSq() < 0.000001) {
      choosePerpendicularAxis(xAxis, yAxis);
    } else {
      yAxis.normalize();
    }

    const zAxis = tmpVectorF.crossVectors(xAxis, yAxis).normalize();
    matrix.makeBasis(xAxis, yAxis, zAxis);
    return target.setFromRotationMatrix(matrix);
  }

  function limitFromRest(restQuaternion, targetQuaternion, maxAngle) {
    if (!Number.isFinite(maxAngle)) {
      return targetQuaternion;
    }

    const angle = restQuaternion.angleTo(targetQuaternion);

    if (angle <= maxAngle) {
      return targetQuaternion;
    }

    return tmpQuaternionB.copy(restQuaternion).slerp(targetQuaternion, maxAngle / angle);
  }

  function limitTwistFromRest(restQuaternion, targetQuaternion, axisLocal, maxTwist) {
    if (!Number.isFinite(maxTwist)) {
      return targetQuaternion;
    }

    const delta = tmpQuaternionC.copy(targetQuaternion).multiply(tmpQuaternionD.copy(restQuaternion).invert());
    const twist = extractTwist(delta, axisLocal, tmpQuaternionE);
    const twistAngle = signedQuaternionAngle(twist);

    if (Math.abs(twistAngle) <= maxTwist) {
      return targetQuaternion;
    }

    const clampedTwist = tmpQuaternionF.setFromAxisAngle(
      tmpVectorA.copy(axisLocal).normalize(),
      clamp(twistAngle, -maxTwist, maxTwist),
    );
    const swing = tmpQuaternionC.copy(delta).multiply(twist.invert());

    return targetQuaternion.copy(swing.multiply(clampedTwist).multiply(restQuaternion));
  }

  function extractTwist(quaternion, axisLocal, target) {
    const axis = tmpVectorA.copy(axisLocal).normalize();
    target.set(
      axis.x * (quaternion.x * axis.x + quaternion.y * axis.y + quaternion.z * axis.z),
      axis.y * (quaternion.x * axis.x + quaternion.y * axis.y + quaternion.z * axis.z),
      axis.z * (quaternion.x * axis.x + quaternion.y * axis.y + quaternion.z * axis.z),
      quaternion.w,
    );

    if (target.lengthSq() < 0.000001) {
      return target.identity();
    }

    return target.normalize();
  }

  function signedQuaternionAngle(quaternion) {
    const angle = 2 * Math.atan2(
      Math.hypot(quaternion.x, quaternion.y, quaternion.z),
      quaternion.w,
    );

    return angle > Math.PI ? angle - Math.PI * 2 : angle;
  }

  function relaxBody(alpha) {
    for (const name of bodyBoneNames) {
      relaxBone(name, alpha);
    }
  }

  function relaxHand(side, alpha) {
    relaxBone(`${side}Hand`, alpha);

    for (const chain of fingerChains[side].values()) {
      for (const bone of chain) {
        relaxBone(bone, alpha);
      }
    }
  }

  function relaxBone(boneOrName, alpha) {
    const bone = typeof boneOrName === 'string' ? getBone(boneOrName) : boneOrName;
    const rest = getBoneRest(bone);

    if (!bone || !rest) {
      return;
    }

    bone.quaternion.slerp(rest.quaternion, clamp01(alpha));
    bone.updateMatrixWorld(true);
  }

  function restoreRestPose(alpha) {
    resetRootMotion(false);

    for (const [name, rest] of restPose) {
      const bone = bones.get(name);

      if (!bone) {
        continue;
      }

      bone.position.copy(rest.position);
      bone.quaternion.slerp(rest.quaternion, clamp01(alpha));
      bone.updateMatrixWorld(true);
    }
  }

  function updateVrmRuntimeBeforeRender(timestampMs) {
    if (!activeVrm || activeVrmRuntime.runtimeUpdateFailed) {
      lastVrmRenderUpdateTime = timestampMs;
      return;
    }

    const previous = lastVrmRenderUpdateTime || timestampMs;
    const deltaSec = Math.min(Math.max((timestampMs - previous) / 1000, 0), 1 / 15);
    lastVrmRenderUpdateTime = timestampMs;
    activeVrmRuntime.lastUpdateDeltaSec = deltaSec;

    if (deltaSec <= 0) {
      return;
    }

    try {
      updateActiveVrmRuntime(deltaSec, timestampMs);
      activeVrmRuntime.updateError = null;
    } catch (error) {
      activeVrmRuntime.runtimeUpdateFailed = true;
      activeVrmRuntime.updateError = error instanceof Error ? error.message : String(error);
      console.warn('VRM runtime update skipped', error);
    }
  }

  function updateActiveVrmRuntime(deltaSec, timestampMs) {
    // App retargeting owns raw bone quaternions and expression morph targets.
    // three-vrm humanoid/expression updates would overwrite those app-owned values.
    activeVrm.lookAt?.update?.(deltaSec);
    activeVrm.nodeConstraintManager?.update?.();
    const springActivity = updateVrmSpringMotionActivity(timestampMs);

    if (shouldUpdateVrmSpringBones(springActivity)) {
      const springDeltaSec = Math.min(deltaSec, VRM_SPRING_MAX_DELTA_SEC) * Math.max(springActivity.activity, 0.25);
      activeVrm.springBoneManager?.update?.(springDeltaSec);
    } else if (!vrmSpringMotion.idleResetDone) {
      activeVrm.springBoneManager?.reset?.();
      vrmSpringMotion.idleResetDone = true;
      vrmSpringMotion.idleResetCount += 1;
      activeVrmRuntime.springIdleResetCount = vrmSpringMotion.idleResetCount;
    }

    for (const material of activeVrm.materials ?? []) {
      material?.update?.(deltaSec);
    }
  }

  function updateVrmSpringMotionActivity(timestampMs) {
    const timestamp = Number.isFinite(timestampMs) ? timestampMs : nowMs();
    const score = measureVrmSpringDriverMotion();
    const targetActivity = clamp01(
      (score - VRM_SPRING_MOTION_THRESHOLD) / (VRM_SPRING_MOTION_FULL - VRM_SPRING_MOTION_THRESHOLD),
    );

    if (targetActivity > 0) {
      vrmSpringMotion.activity = Math.max(targetActivity, vrmSpringMotion.activity * 0.65);
      vrmSpringMotion.lastMotionAt = timestamp;
      vrmSpringMotion.idleResetDone = false;
    } else if (vrmSpringMotion.lastMotionAt > 0) {
      const idleMs = Math.max(0, timestamp - vrmSpringMotion.lastMotionAt);
      const settleActivity = idleMs < VRM_SPRING_SETTLE_MS
        ? (1 - idleMs / VRM_SPRING_SETTLE_MS) * Math.min(vrmSpringMotion.activity, 0.45)
        : 0;
      vrmSpringMotion.activity = settleActivity;
    } else {
      vrmSpringMotion.activity = 0;
    }

    vrmSpringMotion.score = score;
    vrmSpringMotion.active = activeVrmRuntime.springBoneEnabled
      && vrmSpringMotion.activity > VRM_SPRING_MOTION_MIN_ACTIVE;
    activeVrmRuntime.springMotionScore = score;
    activeVrmRuntime.springMotionActivity = vrmSpringMotion.activity;
    activeVrmRuntime.springPhysicsActive = vrmSpringMotion.active;
    activeVrmRuntime.springIdleResetCount = vrmSpringMotion.idleResetCount;

    return {
      active: vrmSpringMotion.active,
      activity: vrmSpringMotion.activity,
      score,
    };
  }

  function measureVrmSpringDriverMotion() {
    if (!model) {
      return 0;
    }

    model.updateMatrixWorld(true);

    let totalScore = 0;
    let maxScore = 0;
    let measuredCount = 0;
    const heightScale = Math.max(modelHeight, 1);

    for (const boneName of VRM_SPRING_MOTION_BONES) {
      const bone = getBone(boneName);

      if (!bone) {
        continue;
      }

      bone.getWorldPosition(tmpVectorA);
      bone.getWorldQuaternion(tmpQuaternionA);

      let sample = vrmSpringMotion.samples.get(boneName);
      if (!sample) {
        sample = {
          position: tmpVectorA.clone(),
          quaternion: tmpQuaternionA.clone(),
          ready: true,
        };
        vrmSpringMotion.samples.set(boneName, sample);
        continue;
      }

      const positionScore = sample.position.distanceTo(tmpVectorA) / heightScale;
      const rotationScore = sample.quaternion.angleTo(tmpQuaternionA) * VRM_SPRING_ROTATION_MOTION_WEIGHT;
      const score = positionScore + rotationScore;

      totalScore += score;
      maxScore = Math.max(maxScore, score);
      measuredCount += 1;
      sample.position.copy(tmpVectorA);
      sample.quaternion.copy(tmpQuaternionA);
    }

    if (measuredCount === 0) {
      return 0;
    }

    return Math.max(maxScore, (totalScore / measuredCount) * 1.75);
  }

  function shouldUpdateVrmSpringBones(springActivity) {
    return Boolean(activeVrmRuntime.springBoneEnabled)
      && Boolean(activeVrm?.springBoneManager)
      && springActivity.active;
  }

  function resetVrmSpringMotionState() {
    vrmSpringMotion.samples.clear();
    vrmSpringMotion.activity = 0;
    vrmSpringMotion.score = 0;
    vrmSpringMotion.active = false;
    vrmSpringMotion.lastMotionAt = 0;
    vrmSpringMotion.idleResetDone = true;
    activeVrmRuntime.springMotionScore = 0;
    activeVrmRuntime.springMotionActivity = 0;
    activeVrmRuntime.springPhysicsActive = false;
    activeVrmRuntime.springIdleResetCount = vrmSpringMotion.idleResetCount;
  }

  function startAnimationLoop() {
    if (animationFrameId !== null || !renderer || !scene || !camera || disposed) {
      return;
    }

    const render = (timestampMs = nowMs()) => {
      animationFrameId = requestAnimationFrame(render);
      resize();
      const startedAt = nowMs();
      updateVrmRuntimeBeforeRender(timestampMs);
      renderer.render(scene, camera);
      recordPerformanceSample(performanceStats.renderMs, nowMs() - startedAt);
    };

    animationFrameId = requestAnimationFrame(render);
  }

  function stopAnimationLoop() {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  }

  function fail(error) {
    failed = true;
    ready = false;
    stopAnimationLoop();
    detachOrbitControls();
    const reason = error instanceof Error ? error.message : String(error);
    setStatus(`Failed: ${reason || 'avatar unavailable'}`);
    setBoneCount(0);
    disposeSkeletonHelper();
    disposeContactShadow();
    disposeModelResources(model);
    disposeEnvironmentTexture();
    renderer?.dispose?.();
    renderer = null;
    scene = null;
    camera = null;
    model = null;
    skeletonHelper = null;
    contactShadow = null;
    bones.clear();
    boneAliasesByBone.clear();
    restPose.clear();
    restPoseByBone.clear();
    resetProportionCalibration();
    resetDepthCalibration();
    loadedGltf = null;
    activeVrm = null;
    activeVrmRuntime = createEmptyVrmRuntimeState();
    vrmSpringMotion = createEmptyVrmSpringMotionState();
    lastVrmRenderUpdateTime = 0;
    vrmHumanoid = null;
    vrmHumanoidMapping = null;
    modelDiagnostics.unresolvedNodeMappings = [];
    modelDiagnostics.renderCompatibility = null;
  }

  function disposeSkeletonHelper() {
    if (!skeletonHelper) {
      return;
    }

    scene?.remove?.(skeletonHelper);
    skeletonHelper.geometry?.dispose?.();
    disposeMaterial(skeletonHelper.material);
    skeletonHelper = null;
  }

  function disposeContactShadow() {
    if (!contactShadow) {
      return;
    }

    scene?.remove?.(contactShadow);
    contactShadow.geometry?.dispose?.();
    disposeMaterial(contactShadow.material);
    contactShadow = null;
  }

  function disposeEnvironmentTexture() {
    environmentTexture?.dispose?.();
    environmentTexture = null;
  }

  function getBone(name) {
    return bones.get(boneName(name)) ?? null;
  }

  function getBoneRest(bone) {
    if (!bone) {
      return null;
    }

    return restPoseByBone.get(bone) ?? restPose.get(bone.name) ?? null;
  }

  function setStatus(message) {
    if (statusElement) {
      statusElement.textContent = message;
    }
  }

  function setBoneCount(count) {
    if (boneCountElement) {
      boneCountElement.textContent = String(count);
    }
  }

  function getDiscoveredBoneCount() {
    return new Set(bones.values()).size;
  }

  function updateDelta(timestamp) {
    const now = Number.isFinite(timestamp) && timestamp > 0
      ? timestamp
      : globalThis.performance?.now?.() ?? Date.now();
    const delta = lastUpdateTime > 0
      ? Math.max(1, Math.min(100, now - lastUpdateTime))
      : FIRST_UPDATE_DELTA_MS;
    lastUpdateTime = now;
    return delta;
  }

  function smoothingAlpha(delta, smoothingMs) {
    if (activeSmoothingMode === AVATAR_SMOOTHING_MODE_OFF) {
      return 1;
    }

    const scaledSmoothingMs = smoothingMs * retargetSmoothingScale();

    if (!Number.isFinite(scaledSmoothingMs) || scaledSmoothingMs <= 0) {
      return 1;
    }

    return clamp01(1 - Math.exp(-delta / scaledSmoothingMs));
  }

  function retargetSmoothingScale() {
    return activeSmoothingMode === AVATAR_SMOOTHING_MODE_STRONG ? 1.65 : 1;
  }

  function recordPerformanceSample(samples, durationMs) {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      return;
    }

    samples.push(durationMs);

    if (samples.length > PERFORMANCE_SAMPLE_LIMIT) {
      samples.splice(0, samples.length - PERFORMANCE_SAMPLE_LIMIT);
    }
  }

  function summarizePerformanceSamples(samples) {
    if (samples.length === 0) {
      return {
        count: 0,
        medianMs: 0,
        p95Ms: 0,
        maxMs: 0,
      };
    }

    const sorted = samples.slice().sort((a, b) => a - b);

    return {
      count: samples.length,
      medianMs: percentile(sorted, 0.5),
      p95Ms: percentile(sorted, 0.95),
      maxMs: sorted[sorted.length - 1],
    };
  }

  function nowMs() {
    return globalThis.performance?.now?.() ?? Date.now();
  }

  function getVrmRuntimeReport() {
    return {
      ...activeVrmRuntime,
      springBoneEnabled: Boolean(activeVrmRuntime.springBoneEnabled),
    };
  }

  function setVrmSpringBoneEnabled(value) {
    if (!activeVrm) {
      return getVrmRuntimeReport();
    }

    activeVrmRuntime.springBoneEnabled = Boolean(value);
    activeVrmRuntime.lastUpdateDeltaSec = 0;
    activeVrmRuntime.runtimeUpdateFailed = false;
    activeVrmRuntime.updateError = null;
    lastVrmRenderUpdateTime = 0;
    activeVrm?.springBoneManager?.setInitState?.();
    activeVrm?.springBoneManager?.reset?.();
    resetVrmSpringMotionState();

    return getVrmRuntimeReport();
  }

  function getFaceHeadPoseSnapshot() {
    return {
      status: faceHeadPose.lastStatus,
      tracked: faceHeadPose.lastTracked,
      withinGrace: faceHeadPose.lastWithinGrace,
      gapMs: faceHeadPose.lastGapMs,
      reacquireBlend: faceHeadPose.lastReacquireBlend,
      resetCount: faceHeadPose.resetCount,
      reacquireCount: faceHeadPose.reacquireCount,
      baseReady: Boolean(faceHeadPose.baseQuaternion),
      layout: faceHeadPose.lastLayout,
      matrixDiagnostics: faceHeadPose.lastMatrixDiagnostics,
      faceEulerDeg: faceHeadPose.lastEulerDeg,
      boneEulerDeg: faceHeadPose.lastBoneEulerDeg,
      boneAngularVelocityDegPerSec: faceHeadPose.lastBoneAngularVelocityDegPerSec,
      jumpCount: faceHeadPose.jumpCount,
      lastJumpReason: faceHeadPose.lastJumpReason,
      appliedAlpha: faceHeadPose.lastAppliedAlpha ?? 0,
      trackingGraceMs: FACE_HEAD_TRACKING_GRACE_MS,
      reacquireBlendMs: FACE_HEAD_REACQUIRE_BLEND_MS,
      jumpThresholdDegPerSec: FACE_HEAD_JUMP_THRESHOLD_DEG_PER_SEC,
    };
  }

  const api = {
    init,
    update,
    getBodyValidationSnapshot,
    getProjectedBodyPoseSnapshot,
    getDepthValidationSnapshot,
    setSkeletonVisible,
    setDepthScale,
    getDepthScale,
    setDepthCalibrationMode,
    getDepthCalibrationMode,
    setDepthCalibrationReference,
    clearDepthCalibrationReference,
    getDepthCalibrationSnapshot,
    resetDepthCalibration,
    getPerformanceSnapshot,
    getMotionStateSnapshot,
    setRetargetMode,
    getRetargetMode,
    clearPerformanceSamples,
    getModelDiagnostics,
    getVrmRuntimeReport,
    setVrmSpringBoneEnabled,
    resetView,
    getViewState,
    resetPose,
    resize,
    dispose,
  };

  return api;
}

function buildPosePoints(landmarks, mirrored, depthOptions = {}) {
  const resolvedDepthOptions = {
    ...depthOptions,
    landmarks,
    worldContext: createWorldDepthContext(landmarks, depthOptions.worldLandmarks),
  };
  const points = {
    nose: posePoint(landmarks, POSE.nose, mirrored, 0.15, resolvedDepthOptions),
    leftEye: posePoint(landmarks, POSE.leftEye, mirrored, 0.1, resolvedDepthOptions),
    rightEye: posePoint(landmarks, POSE.rightEye, mirrored, 0.1, resolvedDepthOptions),
    leftEar: posePoint(landmarks, POSE.leftEar, mirrored, 0.1, resolvedDepthOptions),
    rightEar: posePoint(landmarks, POSE.rightEar, mirrored, 0.1, resolvedDepthOptions),
    leftShoulder: posePoint(landmarks, POSE.leftShoulder, mirrored, 0.2, resolvedDepthOptions),
    rightShoulder: posePoint(landmarks, POSE.rightShoulder, mirrored, 0.2, resolvedDepthOptions),
    leftElbow: posePoint(landmarks, POSE.leftElbow, mirrored, 0.2, resolvedDepthOptions),
    rightElbow: posePoint(landmarks, POSE.rightElbow, mirrored, 0.2, resolvedDepthOptions),
    leftWrist: posePoint(landmarks, POSE.leftWrist, mirrored, 0.2, resolvedDepthOptions),
    rightWrist: posePoint(landmarks, POSE.rightWrist, mirrored, 0.2, resolvedDepthOptions),
    leftHip: posePoint(landmarks, POSE.leftHip, mirrored, 0.2, resolvedDepthOptions),
    rightHip: posePoint(landmarks, POSE.rightHip, mirrored, 0.2, resolvedDepthOptions),
    leftKnee: posePoint(landmarks, POSE.leftKnee, mirrored, 0.2, resolvedDepthOptions),
    rightKnee: posePoint(landmarks, POSE.rightKnee, mirrored, 0.2, resolvedDepthOptions),
    leftAnkle: posePoint(landmarks, POSE.leftAnkle, mirrored, 0.2, resolvedDepthOptions),
    rightAnkle: posePoint(landmarks, POSE.rightAnkle, mirrored, 0.2, resolvedDepthOptions),
    leftHeel: posePoint(landmarks, POSE.leftHeel, mirrored, 0.1, resolvedDepthOptions),
    rightHeel: posePoint(landmarks, POSE.rightHeel, mirrored, 0.1, resolvedDepthOptions),
    leftFootIndex: posePoint(landmarks, POSE.leftFootIndex, mirrored, 0.1, resolvedDepthOptions),
    rightFootIndex: posePoint(landmarks, POSE.rightFootIndex, mirrored, 0.1, resolvedDepthOptions),
  };

  points.shoulderMid = midpoint(points.leftShoulder, points.rightShoulder);
  points.hipMid = midpoint(points.leftHip, points.rightHip);
  points.eyeMid = midpoint(points.leftEye, points.rightEye) || midpoint(points.leftEar, points.rightEar);
  points.earMid = midpoint(points.leftEar, points.rightEar);
  points.headAimBase = points.earMid || points.eyeMid;
  points.headCrown = estimateHeadCrown(points);
  assignSpineWavePoints(points);

  return points;
}

function assignSpineWavePoints(points) {
  if (!points?.hipMid || !points?.shoulderMid) {
    return;
  }

  const torsoVector = new THREE.Vector3().subVectors(points.shoulderMid, points.hipMid);
  const torsoLength = torsoVector.length();

  if (torsoLength < 0.000001) {
    return;
  }

  const up = torsoVector.clone().normalize();
  const shoulderAxis = points.leftShoulder && points.rightShoulder
    ? safeNormalizeVector3(new THREE.Vector3().subVectors(points.leftShoulder, points.rightShoulder))
    : null;
  const hipAxis = points.leftHip && points.rightHip
    ? safeNormalizeVector3(new THREE.Vector3().subVectors(points.leftHip, points.rightHip))
    : null;
  const blendedAxis = shoulderAxis && hipAxis
    ? safeNormalizeVector3(shoulderAxis.clone().add(hipAxis)) ?? shoulderAxis
    : shoulderAxis ?? hipAxis;
  const left = blendedAxis
    ? safeNormalizeVector3(blendedAxis.clone().addScaledVector(up, -blendedAxis.dot(up))) ?? blendedAxis
    : null;
  const forward = left ? safeNormalizeVector3(new THREE.Vector3().crossVectors(up, left)) : null;
  const twistSignedSin = shoulderAxis && hipAxis
    ? clamp(new THREE.Vector3().crossVectors(hipAxis, shoulderAxis).dot(up), -1, 1)
    : 0;
  const confidence = derivedPointConfidence(
    points.leftShoulder,
    points.rightShoulder,
    points.leftHip,
    points.rightHip,
  );
  const confidenceScale = ramp01((confidence - SPINE_WAVE_MIN_CONFIDENCE) / (1 - SPINE_WAVE_MIN_CONFIDENCE));
  const twistSignal = applySignedDeadzone(twistSignedSin, SPINE_WAVE_TWIST_DEADZONE);
  const sideRatio = left ? torsoVector.dot(left) / torsoLength : 0;
  const sideSignal = applySignedDeadzone(sideRatio, SPINE_WAVE_SIDE_DEADZONE_RATIO);
  const maxOffset = torsoLength * SPINE_WAVE_MAX_OFFSET_RATIO;
  const twistOffset = forward
    ? clamp(twistSignal * torsoLength * SPINE_WAVE_TWIST_GAIN * confidenceScale, -maxOffset, maxOffset)
    : 0;
  const sideOffset = left
    ? clamp(sideSignal * torsoLength * SPINE_WAVE_SIDE_GAIN * confidenceScale, -maxOffset * 0.6, maxOffset * 0.6)
    : 0;
  const metadata = {
    source: 'shoulder_hip_axis',
    twistSin: round(twistSignedSin),
    twistSignal: round(twistSignal),
    twistOffset: round(twistOffset),
    sideRatio: round(sideRatio),
    sideSignal: round(sideSignal),
    sideOffset: round(sideOffset),
    confidence: round(confidence),
    active: Math.abs(twistOffset) > 0.000001 || Math.abs(sideOffset) > 0.000001,
  };

  for (const { name, t } of SPINE_WAVE_POINTS) {
    const curve = Math.sin(Math.PI * t);
    const upperBodyFallback = name === 'chest' && confidence < SPINE_WAVE_MIN_CONFIDENCE;
    const point = upperBodyFallback
      ? points.shoulderMid.clone()
      : points.hipMid.clone().addScaledVector(torsoVector, t);

    if (!upperBodyFallback && forward) {
      point.addScaledVector(forward, twistOffset * curve);
    }

    if (!upperBodyFallback && left) {
      point.addScaledVector(left, sideOffset * curve * (1 - t));
    }

    points[name] = name === 'chest' && upperBodyFallback
      ? copyDerivedPointMetadata(point, points.shoulderMid)
      : copyDerivedPointMetadata(point, points.hipMid, points.shoulderMid);
    points[name].spineWave = {
      ...metadata,
      upperBodyFallback,
    };
  }

  assignClaviclePoints(points, {
    up,
    forward,
    torsoLength,
  });
}

function assignClaviclePoints(points, basis) {
  if (!points?.shoulderMid) {
    return;
  }

  assignClaviclePoint(points, 'left', basis);
  assignClaviclePoint(points, 'right', basis);
}

function assignClaviclePoint(points, side, basis) {
  const shoulderName = `${side}Shoulder`;
  const elbowName = `${side}Elbow`;
  const targetName = `${side}Clavicle`;
  const shoulder = points[shoulderName];

  if (!shoulder) {
    return;
  }

  const elbow = points[elbowName];
  const upperArmDirection = elbow
    ? safeNormalizeVector3(new THREE.Vector3().subVectors(elbow, shoulder))
    : null;
  const confidence = elbow
    ? derivedPointConfidence(shoulder, elbow, points.shoulderMid)
    : derivedPointConfidence(shoulder, points.shoulderMid);
  const confidenceScale = ramp01((confidence - SPINE_WAVE_MIN_CONFIDENCE) / (1 - SPINE_WAVE_MIN_CONFIDENCE));
  const elevation = upperArmDirection && basis.up
    ? ramp01((upperArmDirection.dot(basis.up) - CLAVICLE_ELEVATION_START) /
      (CLAVICLE_ELEVATION_FULL - CLAVICLE_ELEVATION_START))
    : 0;
  const protraction = upperArmDirection && basis.forward
    ? Math.max(0, applySignedDeadzone(upperArmDirection.dot(basis.forward), CLAVICLE_PROTRACTION_DEADZONE))
    : 0;
  const point = shoulder.clone();

  if (basis.up) {
    point.addScaledVector(
      basis.up,
      basis.torsoLength * CLAVICLE_ELEVATION_OFFSET_RATIO * elevation * confidenceScale,
    );
  }

  if (basis.forward) {
    point.addScaledVector(
      basis.forward,
      basis.torsoLength * CLAVICLE_PROTRACTION_OFFSET_RATIO * protraction * confidenceScale,
    );
  }

  points[targetName] = copyDerivedPointMetadata(point, shoulder, points.shoulderMid, elbow);
  points[targetName].virtualJoint = {
    source: 'shoulder_arm_proxy',
    elevation: round(elevation),
    protraction: round(protraction),
    confidence: round(confidence),
    active: elevation > 0 || protraction > 0,
  };
}

function estimateHeadCrown(points) {
  const base = points?.headAimBase;

  if (!base) {
    return null;
  }

  const headUp = points.shoulderMid
    ? tmpVectorA.subVectors(base, points.shoulderMid)
    : tmpVectorA.set(0, 1, 0);

  if (headUp.lengthSq() < 0.000001) {
    headUp.set(0, 1, 0);
  } else {
    headUp.normalize();
  }

  const shoulderWidth = distance2D(points.leftShoulder, points.rightShoulder);
  const eyeWidth = distance2D(points.leftEye, points.rightEye);
  const headLength = Math.max(shoulderWidth * 0.28, eyeWidth * 1.8, 0.12);
  const headDirection = tmpVectorB.copy(headUp).multiplyScalar(headLength);

  if (points.nose) {
    const noseOffset = tmpVectorC.subVectors(points.nose, base);
    const maxNoseOffset = headLength * HEAD_CROWN_MAX_NOSE_OFFSET_SCALE;

    if (noseOffset.lengthSq() > maxNoseOffset * maxNoseOffset) {
      noseOffset.setLength(maxNoseOffset);
    }

    headDirection.addScaledVector(noseOffset, HEAD_CROWN_NOSE_OFFSET_BLEND);
  }

  if (headDirection.lengthSq() < 0.000001) {
    headDirection.copy(headUp).multiplyScalar(headLength);
  }

  return copyDerivedPointMetadata(base.clone().add(headDirection), base, points.nose);
}

function clonePosePoints(points) {
  return Object.fromEntries(
    Object.entries(points ?? {}).map(([name, point]) => [
      name,
      point?.clone
        ? copyPointMetadata(point, point.clone())
        : point
        ? copyPointMetadata(point, new THREE.Vector3(point.x, point.y, point.z ?? 0))
        : point,
    ]),
  );
}

function buildPosePoints2D(landmarks, mirrored) {
  const points = {
    leftShoulder: posePoint2D(landmarks, POSE.leftShoulder, mirrored),
    rightShoulder: posePoint2D(landmarks, POSE.rightShoulder, mirrored),
    leftElbow: posePoint2D(landmarks, POSE.leftElbow, mirrored),
    rightElbow: posePoint2D(landmarks, POSE.rightElbow, mirrored),
    leftWrist: posePoint2D(landmarks, POSE.leftWrist, mirrored),
    rightWrist: posePoint2D(landmarks, POSE.rightWrist, mirrored),
    leftHip: posePoint2D(landmarks, POSE.leftHip, mirrored),
    rightHip: posePoint2D(landmarks, POSE.rightHip, mirrored),
    leftKnee: posePoint2D(landmarks, POSE.leftKnee, mirrored),
    rightKnee: posePoint2D(landmarks, POSE.rightKnee, mirrored),
    leftAnkle: posePoint2D(landmarks, POSE.leftAnkle, mirrored),
    rightAnkle: posePoint2D(landmarks, POSE.rightAnkle, mirrored),
  };

  points.shoulderMid = midpoint2D(points.leftShoulder, points.rightShoulder);
  points.hipMid = midpoint2D(points.leftHip, points.rightHip);

  return points;
}

function posePoint2D(landmarks, index, mirrored, minVisibility = 0.2) {
  const landmark = landmarks?.[index];

  if (!landmark || !Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) {
    return null;
  }

  if (Number.isFinite(landmark.visibility) && landmark.visibility < minVisibility) {
    return null;
  }

  return copyPointMetadata(landmark, {
    x: mirrored ? 1 - landmark.x : landmark.x,
    y: landmark.y,
  });
}

function extractPoseLandmarks(results) {
  if (!results) {
    return null;
  }

  if (isLandmarkList(results.poseLandmarks)) {
    return results.poseLandmarks;
  }

  if (Array.isArray(results.poseLandmarks) && isLandmarkList(results.poseLandmarks[0])) {
    return results.poseLandmarks[0];
  }

  if (isLandmarkList(results.landmarks)) {
    return results.landmarks;
  }

  if (Array.isArray(results.landmarks) && isLandmarkList(results.landmarks[0])) {
    return results.landmarks[0];
  }

  return null;
}

function extractWorldPoseLandmarks(results) {
  if (!results) {
    return null;
  }

  if (isLandmarkList(results.poseWorldLandmarks)) {
    return results.poseWorldLandmarks;
  }

  if (Array.isArray(results.poseWorldLandmarks) && isLandmarkList(results.poseWorldLandmarks[0])) {
    return results.poseWorldLandmarks[0];
  }

  if (isLandmarkList(results.worldLandmarks)) {
    return results.worldLandmarks;
  }

  if (Array.isArray(results.worldLandmarks) && isLandmarkList(results.worldLandmarks[0])) {
    return results.worldLandmarks[0];
  }

  return null;
}

function isMotionFramePayload(value) {
  return Boolean(value && value.version === 1);
}

function extractMotionFrameHands(frame) {
  const hands = [];

  if (isLandmarkList(frame.leftHandLandmarks)) {
    hands.push({
      landmarks: frame.leftHandLandmarks,
      worldLandmarks: isLandmarkList(frame.leftHandWorldLandmarks) ? frame.leftHandWorldLandmarks : null,
      side: 'Left',
      score: 1,
    });
  }

  if (isLandmarkList(frame.rightHandLandmarks)) {
    hands.push({
      landmarks: frame.rightHandLandmarks,
      worldLandmarks: isLandmarkList(frame.rightHandWorldLandmarks) ? frame.rightHandWorldLandmarks : null,
      side: 'Right',
      score: 1,
    });
  }

  return hands;
}

function extractHands(results, mirrored) {
  if (!results) {
    return [];
  }

  const hands = [];

  if (isLandmarkList(results.leftHandLandmarks)) {
    hands.push({
      landmarks: results.leftHandLandmarks,
      worldLandmarks: isLandmarkList(results.leftHandWorldLandmarks) ? results.leftHandWorldLandmarks : null,
      side: 'Left',
      score: 1,
    });
  }

  if (isLandmarkList(results.rightHandLandmarks)) {
    hands.push({
      landmarks: results.rightHandLandmarks,
      worldLandmarks: isLandmarkList(results.rightHandWorldLandmarks) ? results.rightHandWorldLandmarks : null,
      side: 'Right',
      score: 1,
    });
  }

  const landmarkGroups = normalizeHandLandmarkGroups(results);
  const worldLandmarkGroups = normalizeHandWorldLandmarkGroups(results);
  const handedness = results.multiHandedness ?? results.handednesses ?? results.handedness ?? [];

  landmarkGroups.forEach((landmarks, index) => {
    if (!isLandmarkList(landmarks)) {
      return;
    }

    const side = normalizeHandLabel(readHandLabel(handedness[index]), mirrored);
    const score = readHandScore(handedness[index]);
    hands.push({
      landmarks,
      worldLandmarks: isLandmarkList(worldLandmarkGroups[index]) ? worldLandmarkGroups[index] : null,
      side,
      score,
    });
  });

  return dedupeHands(hands);
}

function normalizeHandLandmarkGroups(results) {
  if (Array.isArray(results.multiHandLandmarks)) {
    return results.multiHandLandmarks;
  }

  if (Array.isArray(results.handLandmarks) && isLandmarkList(results.handLandmarks[0])) {
    return results.handLandmarks;
  }

  if (Array.isArray(results.landmarks) && isLandmarkList(results.landmarks[0])) {
    return results.landmarks;
  }

  if (isLandmarkList(results.landmarks)) {
    return [results.landmarks];
  }

  return [];
}

function normalizeHandWorldLandmarkGroups(results) {
  if (Array.isArray(results.multiHandWorldLandmarks)) {
    return results.multiHandWorldLandmarks;
  }

  if (Array.isArray(results.handWorldLandmarks) && isLandmarkList(results.handWorldLandmarks[0])) {
    return results.handWorldLandmarks;
  }

  if (Array.isArray(results.worldLandmarks) && isLandmarkList(results.worldLandmarks[0])) {
    return results.worldLandmarks;
  }

  if (isLandmarkList(results.worldLandmarks)) {
    return [results.worldLandmarks];
  }

  return [];
}

function resolveHandSide(hand, mirrored, usedSides) {
  if (hand.side && !usedSides.has(hand.side)) {
    return hand.side;
  }

  const wrist = hand.landmarks?.[0];

  if (wrist && Number.isFinite(wrist.x)) {
    const x = mirrored ? 1 - wrist.x : wrist.x;
    const inferred = x < 0.5 ? 'Left' : 'Right';

    if (!usedSides.has(inferred)) {
      return inferred;
    }
  }

  return ['Left', 'Right'].find((side) => !usedSides.has(side)) ?? null;
}

function dedupeHands(hands) {
  const bySide = new Map();
  const unknown = [];

  for (const hand of hands) {
    if (!hand?.landmarks?.length) {
      continue;
    }

    if (!hand.side) {
      unknown.push(hand);
      continue;
    }

    const current = bySide.get(hand.side);

    if (!current || hand.score > current.score) {
      bySide.set(hand.side, hand);
      continue;
    }

    if (!current.worldLandmarks && isLandmarkList(hand.worldLandmarks)) {
      current.worldLandmarks = hand.worldLandmarks;
    }
  }

  return [...bySide.values(), ...unknown].slice(0, 2);
}

function readHandLabel(entry) {
  if (!entry) {
    return null;
  }

  if (Array.isArray(entry)) {
    return readHandLabel(entry[0]);
  }

  const candidate = entry.categoryName
    ?? entry.displayName
    ?? entry.label
    ?? entry.classification?.[0]?.label
    ?? entry.classifications?.[0]?.label
    ?? null;

  return typeof candidate === 'string' ? candidate : null;
}

function readHandScore(entry) {
  if (!entry) {
    return 0;
  }

  if (Array.isArray(entry)) {
    return readHandScore(entry[0]);
  }

  return Number(entry.score ?? entry.probability ?? entry.classification?.[0]?.score ?? 0) || 0;
}

function normalizeHandLabel(label, mirrored) {
  if (!label) {
    return null;
  }

  const lower = label.toLowerCase();
  const side = lower.includes('left') ? 'Left' : lower.includes('right') ? 'Right' : null;

  if (!side) {
    return null;
  }

  return mirrored ? side : oppositeSide(side);
}

function oppositeSide(side) {
  return side === 'Left' ? 'Right' : 'Left';
}

function createWorldDepthContext(landmarks, worldLandmarks) {
  if (!isLandmarkList(worldLandmarks)) {
    return null;
  }

  const screenShoulderMid = midpoint(
    screenVector(landmarks?.[POSE.leftShoulder]),
    screenVector(landmarks?.[POSE.rightShoulder]),
  );
  const screenHipMid = midpoint(
    screenVector(landmarks?.[POSE.leftHip]),
    screenVector(landmarks?.[POSE.rightHip]),
  );
  const worldShoulderMid = midpoint(
    worldVector(worldLandmarks?.[POSE.leftShoulder]),
    worldVector(worldLandmarks?.[POSE.rightShoulder]),
  );
  const worldHipMid = midpoint(
    worldVector(worldLandmarks?.[POSE.leftHip]),
    worldVector(worldLandmarks?.[POSE.rightHip]),
  );
  const screenShoulderWidth = distance2D(
    screenVector(landmarks?.[POSE.leftShoulder]),
    screenVector(landmarks?.[POSE.rightShoulder]),
  );
  const worldShoulderWidth = distance3D(
    worldVector(worldLandmarks?.[POSE.leftShoulder]),
    worldVector(worldLandmarks?.[POSE.rightShoulder]),
  );

  const screenTorsoLength = screenShoulderMid && screenHipMid
    ? screenShoulderMid.distanceTo(screenHipMid)
    : 0;
  const worldTorsoLength = worldShoulderMid && worldHipMid
    ? worldShoulderMid.distanceTo(worldHipMid)
    : 0;
  const screenScale = screenTorsoLength >= 0.0001 ? screenTorsoLength : screenShoulderWidth;
  const worldScale = worldTorsoLength >= 0.0001 ? worldTorsoLength : worldShoulderWidth;
  const centerZ = worldHipMid?.z ?? worldShoulderMid?.z;

  if (!Number.isFinite(centerZ) || screenScale < 0.0001 || worldScale < 0.0001) {
    return null;
  }

  return {
    centerZ,
    worldToScreenScale: screenScale / worldScale,
  };
}

function screenVector(landmark) {
  if (!landmark || !Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) {
    return null;
  }

  return new THREE.Vector3((landmark.x - 0.5) * 2, (0.5 - landmark.y) * 2, 0);
}

function worldVector(landmark) {
  if (
    !landmark ||
    !Number.isFinite(landmark.x) ||
    !Number.isFinite(landmark.y) ||
    !Number.isFinite(landmark.z)
  ) {
    return null;
  }

  return new THREE.Vector3(landmark.x, landmark.y, landmark.z);
}

function posePoint(landmarks, index, mirrored, minVisibility = 0.2, depthOptions = {}) {
  const landmark = landmarks?.[index];

  if (!landmark || !Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) {
    return null;
  }

  if (Number.isFinite(landmark.visibility) && landmark.visibility < minVisibility) {
    return null;
  }

  return landmarkToVector(landmark, mirrored, index, depthOptions);
}

function landmarkToVector(landmark, mirrored, index = -1, depthOptions = {}) {
  if (!landmark || !Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) {
    return null;
  }

  const x = ((mirrored ? 1 - landmark.x : landmark.x) - 0.5) * 2;
  const y = (0.5 - landmark.y) * 2;
  const z = -resolveLandmarkDepth(landmark, index, depthOptions);

  return copyPointMetadata(landmark, new THREE.Vector3(x, y, z));
}

function handWorldLandmarkToVector(landmark, mirrored) {
  if (
    !landmark ||
    !Number.isFinite(landmark.x) ||
    !Number.isFinite(landmark.y) ||
    !Number.isFinite(landmark.z)
  ) {
    return null;
  }

  return new THREE.Vector3(
    mirrored ? -landmark.x : landmark.x,
    -landmark.y,
    -landmark.z,
  );
}

function resolveLandmarkDepth(landmark, index, depthOptions) {
  const depthScale = normalizeDepthScale(depthOptions.depthScale ?? DEFAULT_LANDMARK_DEPTH_SCALE);

  if (depthScale === 0) {
    return 0;
  }

  const worldLandmark = depthOptions.worldLandmarks?.[index];
  const worldContext = depthOptions.worldContext
    ?? createWorldDepthContext(depthOptions.landmarks, depthOptions.worldLandmarks);

  if (
    worldContext &&
    worldLandmark &&
    Number.isFinite(worldLandmark.z)
  ) {
    return (worldLandmark.z - worldContext.centerZ) * worldContext.worldToScreenScale * depthScale;
  }

  return (Number.isFinite(landmark.z) ? landmark.z : 0) * depthScale;
}

function midpoint(a, b) {
  if (!a || !b) {
    return null;
  }

  return copyDerivedPointMetadata(
    new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5),
    a,
    b,
  );
}

function midpoint2D(a, b) {
  if (!a || !b) {
    return null;
  }

  return copyDerivedPointMetadata({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  }, a, b);
}

function copyPointMetadata(source, target) {
  if (!source || !target) {
    return target;
  }

  if (Number.isFinite(source.visibility)) {
    target.visibility = clamp01(source.visibility);
  }

  if (Number.isFinite(source.presence)) {
    target.presence = clamp01(source.presence);
  }

  return target;
}

function copyDerivedPointMetadata(target, ...sources) {
  const visibility = sources
    .map((source) => source?.visibility)
    .filter((value) => Number.isFinite(value));
  const presence = sources
    .map((source) => source?.presence)
    .filter((value) => Number.isFinite(value));

  if (visibility.length > 0) {
    target.visibility = Math.min(...visibility);
  }

  if (presence.length > 0) {
    target.presence = Math.min(...presence);
  }

  return target;
}

function normalizePose2D(points) {
  const center = midpoint2D(points.shoulderMid, points.hipMid) ?? points.hipMid ?? points.shoulderMid;
  const torsoScale = points.shoulderMid && points.hipMid
    ? distance2D(points.shoulderMid, points.hipMid)
    : 0;
  const shoulderScale = points.leftShoulder && points.rightShoulder
    ? distance2D(points.leftShoulder, points.rightShoulder)
    : 0;
  const hipScale = points.leftHip && points.rightHip
    ? distance2D(points.leftHip, points.rightHip)
    : 0;
  const scale = Math.max(torsoScale, shoulderScale, hipScale, 0.0001);
  const normalizedPoints = {};

  for (const [name, point] of Object.entries(points)) {
    if (!point || !center) {
      continue;
    }

    normalizedPoints[name] = {
      x: (point.x - center.x) / scale,
      y: (point.y - center.y) / scale,
    };
  }

  return {
    points: normalizedPoints,
    center,
    scale,
  };
}

function summarizeVisualJoints(joints) {
  const errors = joints
    .map((joint) => joint.error)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  return {
    count: errors.length,
    meanError: mean(errors),
    medianError: percentile(errors, 0.5),
    p90Error: percentile(errors, 0.9),
    maxError: errors.length > 0 ? errors[errors.length - 1] : 0,
  };
}

function summarizeDepthValidationSegments(segments) {
  const all = summarizeDepthRows(segments);
  const depthSalient = summarizeDepthRows(segments.filter((segment) => segment.depthSalient));

  return {
    depthSource: 'mediapipe_relative_depth',
    matchThresholdDeg: DEPTH_MATCH_THRESHOLD_DEG,
    salientZRatio: DEPTH_SALIENT_Z_RATIO,
    all,
    depthSalient,
  };
}

function summarizeDepthRows(rows) {
  const errors = rows
    .map((segment) => segment.errorDeg)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  const matchedCount = rows.filter((segment) => segment.matched).length;

  return {
    count: rows.length,
    matchedCount,
    matchRate: rows.length > 0 ? matchedCount / rows.length : 0,
    meanErrorDeg: mean(errors),
    medianErrorDeg: percentile(errors, 0.5),
    p90ErrorDeg: percentile(errors, 0.9),
    maxErrorDeg: errors.length > 0 ? errors[errors.length - 1] : 0,
  };
}

function distance2D(a, b) {
  if (!a || !b) {
    return 0;
  }

  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointToArray(point) {
  return [point.x, point.y];
}

function summarizeValidationSegments(segments) {
  const errors = segments
    .map((segment) => segment.errorDeg)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  const groups = {};

  for (const segment of segments) {
    if (!Number.isFinite(segment.errorDeg)) {
      continue;
    }

    const group = groups[segment.group] ?? {
      count: 0,
      meanErrorDeg: 0,
      maxErrorDeg: 0,
    };
    group.count += 1;
    group.meanErrorDeg += segment.errorDeg;
    group.maxErrorDeg = Math.max(group.maxErrorDeg, segment.errorDeg);
    groups[segment.group] = group;
  }

  for (const group of Object.values(groups)) {
    if (group.count > 0) {
      group.meanErrorDeg /= group.count;
    }
  }

  const worstSegment = segments.reduce((worst, segment) => {
    if (!Number.isFinite(segment.errorDeg)) {
      return worst;
    }

    if (!worst || segment.errorDeg > worst.errorDeg) {
      return {
        name: segment.name,
        group: segment.group,
        bone: segment.bone,
        errorDeg: segment.errorDeg,
      };
    }

    return worst;
  }, null);

  return {
    count: errors.length,
    meanErrorDeg: mean(errors),
    medianErrorDeg: percentile(errors, 0.5),
    p90ErrorDeg: percentile(errors, 0.9),
    maxErrorDeg: errors.length > 0 ? errors[errors.length - 1] : 0,
    groups,
    worstSegment,
  };
}

function mean(values) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(sortedValues, fraction) {
  if (sortedValues.length === 0) {
    return 0;
  }

  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(sortedValues.length * fraction) - 1),
  );
  return sortedValues[index];
}

function vectorToArray(vector) {
  return [vector.x, vector.y, vector.z];
}

function inferBoneAxisLocal(bone, baseName = '', hasBoneAlias = null) {
  const resolvedBaseName = baseName || avatarBoneBaseName(bone.name);
  const preferOwnPositionForAxis = resolvedBaseName === 'Head';

  if (preferOwnPositionForAxis && bone.position.lengthSq() > 0.000001) {
    return bone.position.clone().normalize();
  }

  const primaryChildName = PRIMARY_BONE_CHILD.get(resolvedBaseName);
  const primaryChild = primaryChildName
    ? bone.children.find((child) => (
      isSupportedBoneObject(child) &&
      (
        hasBoneAlias?.(child, primaryChildName) ||
        avatarBoneBaseName(child.name) === primaryChildName
      )
    ))
    : null;
  const childBone = primaryChild ?? (
    preferOwnPositionForAxis ? null : bone.children.find((child) => isSupportedBoneObject(child))
  );

  if (childBone && childBone.position.lengthSq() > 0.000001) {
    return childBone.position.clone().normalize();
  }

  if (bone.position.lengthSq() > 0.000001) {
    return bone.position.clone().normalize();
  }

  const fallbackName = resolvedBaseName || bone.name;

  if (
    fallbackName.includes('Arm') ||
    fallbackName.includes('Hand') ||
    fallbackName.includes('Finger') ||
    fallbackName.includes('Thumb') ||
    fallbackName.includes('Index') ||
    fallbackName.includes('Middle') ||
    fallbackName.includes('Ring') ||
    fallbackName.includes('Pinky')
  ) {
    return fallbackName.startsWith('Right') ? new THREE.Vector3(-1, 0, 0) : new THREE.Vector3(1, 0, 0);
  }

  return new THREE.Vector3(0, 1, 0);
}

function isSupportedBoneObject(object) {
  return Boolean(object?.isBone || avatarBoneBaseName(object?.name));
}

function inferSecondaryAxisLocal(axisLocal) {
  const secondary = new THREE.Vector3();
  choosePerpendicularAxis(axisLocal, secondary);
  return secondary;
}

function choosePerpendicularAxis(primary, target) {
  const fallback = Math.abs(primary.y) < 0.82
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(0, 0, 1);

  target.copy(fallback).addScaledVector(primary, -fallback.dot(primary));

  if (target.lengthSq() < 0.000001) {
    target.set(1, 0, 0).addScaledVector(primary, -primary.x);
  }

  return target.normalize();
}

function disposeModelResources(root) {
  if (!root) {
    return;
  }

  root.traverse((object) => {
    if (object.isMesh) {
      object.geometry?.dispose?.();
      disposeMaterial(object.material);
    }
  });
}

function disposeMaterial(material) {
  if (Array.isArray(material)) {
    material.forEach(disposeMaterial);
    return;
  }

  if (!material) {
    return;
  }

  for (const value of Object.values(material)) {
    if (value?.isTexture) {
      value.dispose();
    }
  }

  material.dispose?.();
}

function isLandmarkList(value) {
  return Array.isArray(value)
    && value.length >= 2
    && Number.isFinite(value[0]?.x)
    && Number.isFinite(value[0]?.y);
}

function detectAvatarModelKind(gltf) {
  const json = gltf?.parser?.json ?? {};
  const extensionNames = new Set([
    ...(json.extensionsUsed ?? []),
    ...(json.extensionsRequired ?? []),
    ...Object.keys(json.extensions ?? {}),
  ]);

  return extensionNames.has('VRM') || extensionNames.has('VRMC_vrm') ? 'anime' : 'default';
}

function boneNameAliases(name) {
  const baseName = avatarBoneBaseName(name);

  if (!baseName) {
    return [];
  }

  const aliases = new Set([
    name,
    baseName,
    `${BONE_PREFIX}${baseName}`,
    `${sanitizeBoneName(BONE_PREFIX)}${baseName}`,
  ]);

  for (const alias of [...aliases]) {
    const sanitized = sanitizeBoneName(alias);
    const unsanitized = unsanitizeBoneName(alias);

    if (sanitized) {
      aliases.add(sanitized);
    }

    if (unsanitized) {
      aliases.add(unsanitized);
    }
  }

  return [...aliases];
}

function avatarBoneBaseName(name) {
  if (typeof name !== 'string' || name.length === 0) {
    return '';
  }

  const sanitizedPrefix = sanitizeBoneName(BONE_PREFIX);
  let candidate = name;

  if (candidate.startsWith(BONE_PREFIX)) {
    candidate = candidate.slice(BONE_PREFIX.length);
  } else if (candidate.startsWith(sanitizedPrefix)) {
    candidate = candidate.slice(sanitizedPrefix.length);
  }

  return KNOWN_AVATAR_BONE_NAMES.has(candidate) ? candidate : '';
}

function boneName(name) {
  if (name.startsWith(BONE_PREFIX)) {
    return name;
  }

  if (name.startsWith(sanitizeBoneName(BONE_PREFIX))) {
    return name;
  }

  return `${BONE_PREFIX}${name}`;
}

function sanitizeBoneName(name) {
  return typeof name === 'string' ? name.replaceAll(':', '') : '';
}

function unsanitizeBoneName(name) {
  const sanitizedPrefix = sanitizeBoneName(BONE_PREFIX);

  if (typeof name !== 'string' || !name.startsWith(sanitizedPrefix)) {
    return name;
  }

  return `${BONE_PREFIX}${name.slice(sanitizedPrefix.length)}`;
}

function ensureCanvas(value) {
  if (!value || typeof value.getContext !== 'function') {
    throw new Error('avatar canvas missing');
  }
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value || 0));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function safeNormalizeVector3(vector) {
  if (!vector || vector.lengthSq() < 0.000001) {
    return null;
  }

  return vector.normalize();
}

function derivedPointConfidence(...points) {
  const visibilities = points
    .map((point) => point?.visibility)
    .filter((value) => Number.isFinite(value));

  if (visibilities.length === 0) {
    return 1;
  }

  const visibility = Math.min(...visibilities);

  if (visibility >= RETARGET_FULL_CONFIDENCE_VISIBILITY) {
    return 1;
  }

  return ramp01(
    (visibility - RETARGET_LOW_CONFIDENCE_HOLD) /
    (RETARGET_FULL_CONFIDENCE_VISIBILITY - RETARGET_LOW_CONFIDENCE_HOLD),
  );
}

function applySignedDeadzone(value, deadzone) {
  const numericValue = Number(value);
  const numericDeadzone = Math.max(0, Number(deadzone) || 0);
  const magnitude = Math.abs(numericValue);

  if (!Number.isFinite(numericValue) || magnitude <= numericDeadzone) {
    return 0;
  }

  return Math.sign(numericValue) * ((magnitude - numericDeadzone) / Math.max(0.000001, 1 - numericDeadzone));
}

function ramp01(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return clamp(number, 0, 1);
}

function round(value, digits = 6) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function shortestAngle(value) {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

function normalizeDepthScale(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return DEFAULT_LANDMARK_DEPTH_SCALE;
  }

  return clamp(number, 0, 1.5);
}

function normalizeAvatarSmoothingMode(value) {
  const normalized = String(value ?? AVATAR_SMOOTHING_MODE_RETARGET).toLowerCase();

  if (normalized === 'retarget' || normalized === 'on' || normalized === '1' || normalized === 'true') {
    return AVATAR_SMOOTHING_MODE_RETARGET;
  }

  if (normalized === 'strong') {
    return AVATAR_SMOOTHING_MODE_STRONG;
  }

  const mode = AVATAR_SMOOTHING_ALIASES[normalized] ?? AVATAR_SMOOTHING_MODE_RETARGET;

  if (mode === AVATAR_SMOOTHING_MODE_RETARGET || mode === AVATAR_SMOOTHING_MODE_STRONG) {
    return mode;
  }

  return AVATAR_SMOOTHING_MODE_OFF;
}
