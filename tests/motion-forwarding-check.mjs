#!/usr/bin/env node
import assert from "node:assert/strict";
import { createMotionFrame } from "../src/motion-frame.js";
import {
  MOTION_FORWARDING_PAYLOAD_TYPE,
  createMotionForwarder,
} from "../src/motion-forwarding.js";

class MockWebSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.listeners = new Map();
    this.sent = [];
    MockWebSocket.instances.push(this);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  open() {
    this.readyState = 1;
    this.emit("open");
  }

  send(payload) {
    if (this.readyState !== 1) {
      throw new Error("not open");
    }

    this.sent.push(payload);
  }

  close() {
    this.readyState = 3;
    this.emit("close");
  }
}

const forwarder = createMotionForwarder({
  WebSocketCtor: MockWebSocket,
  now: () => "2026-05-28T00:00:00.000Z",
});

let status = forwarder.connect("ws://127.0.0.1:9999/motion");
assert.equal(status.status, "connecting");
assert.equal(MockWebSocket.instances.length, 1);
MockWebSocket.instances[0].open();
status = forwarder.getStatus();
assert.equal(status.status, "connected");

const frame = createMotionFrame({
  timestamp: 42,
  mirrored: true,
  face: {
    blendShapes: [{ name: "eyeBlinkLeft", score: 0.8 }],
    transformMatrix: Array.from({ length: 16 }, (_, index) => (index % 5 === 0 ? 1 : 0)),
  },
});
assert.equal(forwarder.sendFrame(frame), true);
const payload = JSON.parse(MockWebSocket.instances[0].sent[0]);
assert.equal(payload.type, MOTION_FORWARDING_PAYLOAD_TYPE);
assert.equal(payload.version, 1);
assert.equal(payload.frame.timestamp, 42);
assert.equal(payload.frame.mirrored, true);
assert.deepEqual(payload.frame.face.blendShapes, [{ name: "eyeBlinkLeft", score: 0.8 }]);
payload.frame.face.blendShapes[0].score = 0;
assert.equal(frame.face.blendShapes[0].score, 0.8);
assert.equal(forwarder.getStatus().sentFrames, 1);

status = forwarder.disconnect();
assert.equal(status.status, "closed");
assert.equal(forwarder.sendFrame(frame), false);

const invalid = createMotionForwarder({ WebSocketCtor: MockWebSocket });
assert.equal(invalid.connect("http://127.0.0.1/").status, "failed");
assert.match(invalid.getStatus().lastError, /ws:\/\/ or wss:\/\//);

console.log("Motion forwarding check passed.");
