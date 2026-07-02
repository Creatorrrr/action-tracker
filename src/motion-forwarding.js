import { MOTION_FRAME_VERSION, serializeMotionFrame } from "./motion-frame.js";

export const MOTION_FORWARDING_PAYLOAD_TYPE = "action-tracker-motion-frame";

export function createMotionForwarder({
  WebSocketCtor = globalThis.WebSocket,
  now = () => new Date().toISOString(),
} = {}) {
  let socket = null;
  let url = "";
  let status = "idle";
  let lastError = "";
  let connectedAt = "";
  let closedAt = "";
  let sentFrames = 0;
  let failedFrames = 0;

  function connect(nextUrl) {
    disconnect();

    try {
      url = normalizeWebSocketUrl(nextUrl);

      if (!WebSocketCtor) {
        throw new Error("WebSocket is unavailable in this browser.");
      }

      status = "connecting";
      lastError = "";
      closedAt = "";
      socket = new WebSocketCtor(url);
      socket.addEventListener?.("open", () => {
        status = "connected";
        connectedAt = now();
        lastError = "";
      });
      socket.addEventListener?.("close", () => {
        if (status !== "failed") {
          status = "closed";
        }

        closedAt = now();
        socket = null;
      });
      socket.addEventListener?.("error", (event) => {
        status = "failed";
        lastError = event?.message || "WebSocket forwarding failed.";
      });
    } catch (error) {
      status = "failed";
      lastError = error?.message ?? String(error);
      socket = null;
    }

    return getStatus();
  }

  function disconnect() {
    if (socket) {
      try {
        socket.close();
      } catch {
        // Close is best-effort; the status below is the public result.
      }
    }

    socket = null;

    if (status !== "idle") {
      status = "closed";
      closedAt = now();
    }

    return getStatus();
  }

  function sendFrame(frame) {
    if (!socket || socket.readyState !== 1 || status !== "connected") {
      return false;
    }

    try {
      socket.send(JSON.stringify({
        type: MOTION_FORWARDING_PAYLOAD_TYPE,
        version: MOTION_FRAME_VERSION,
        frame: serializeMotionFrame(frame),
      }));
      sentFrames += 1;
      return true;
    } catch (error) {
      failedFrames += 1;
      status = "failed";
      lastError = error?.message ?? String(error);
      return false;
    }
  }

  function getStatus() {
    return {
      enabled: Boolean(socket),
      status,
      url,
      readyState: socket?.readyState ?? null,
      connectedAt,
      closedAt,
      sentFrames,
      failedFrames,
      lastError,
    };
  }

  return {
    connect,
    disconnect,
    sendFrame,
    getStatus,
  };
}

function normalizeWebSocketUrl(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Forwarding URL must be a ws:// or wss:// URL.");
  }

  const url = new URL(value, globalThis.location?.href ?? "http://127.0.0.1/");

  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("Forwarding URL must use ws:// or wss://.");
  }

  return url.href;
}
