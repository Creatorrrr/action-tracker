'use strict';
const marker = require('./sandbox-init.node');
const expected = '3590d5c646ed3ca0e1769927797a87ae49bb1ce3920e40218a547d480beef481';
if (marker?.active !== true || marker?.profileSha256 !== expected) {
  const error = new Error('sandbox_marker_invalid');
  error.code = 'sandbox_marker_invalid';
  throw error;
}
Object.defineProperty(globalThis, Symbol.for('sam-goal.manual-review.sandbox-v1'), {
  configurable: false,
  enumerable: false,
  writable: false,
  value: Object.freeze({ active: true, profileSha256: expected }),
});
