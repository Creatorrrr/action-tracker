#!/usr/bin/env node
// Bundle-local ISO BMFF timing-table verifier. It never derives authoring identity from FPS,
// wall time, nearest timestamps or rounded microseconds. Unsupported containers fail closed.
import crypto from 'node:crypto';
import fs from 'node:fs';

function die(code, message = code) {
  process.stderr.write(`${JSON.stringify({ status: 'failed', code, message })}\n`);
  process.exit(1);
}

function boxes(buffer, start = 0, end = buffer.length) {
  const result = []; let offset = start;
  while (offset < end) {
    if (offset + 8 > end) die('mp4_box_truncated');
    let size = buffer.readUInt32BE(offset); const type = buffer.toString('ascii', offset + 4, offset + 8); let header = 8;
    if (size === 1) { if (offset + 16 > end) die('mp4_box_truncated'); size = Number(buffer.readBigUInt64BE(offset + 8)); header = 16; }
    else if (size === 0) size = end - offset;
    if (!Number.isSafeInteger(size) || size < header || offset + size > end) die('mp4_box_size_invalid');
    result.push({ type, start: offset, dataStart: offset + header, end: offset + size, size }); offset += size;
  }
  if (offset !== end) die('mp4_box_alignment_invalid'); return result;
}

function child(buffer, parent, type) { return boxes(buffer, parent.dataStart, parent.end).find((box) => box.type === type); }
function children(buffer, parent, type) { return boxes(buffer, parent.dataStart, parent.end).filter((box) => box.type === type); }
function required(value, code) { if (!value) die(code); return value; }

function handlerType(buffer, trak) {
  const mdia = required(child(buffer, trak, 'mdia'), 'mp4_mdia_missing');
  const hdlr = required(child(buffer, mdia, 'hdlr'), 'mp4_hdlr_missing');
  if (hdlr.dataStart + 12 > hdlr.end) die('mp4_hdlr_truncated'); return buffer.toString('ascii', hdlr.dataStart + 8, hdlr.dataStart + 12);
}

function fullBox(buffer, box) {
  if (box.dataStart + 4 > box.end) die('mp4_full_box_truncated');
  return { version: buffer[box.dataStart], cursor: box.dataStart + 4 };
}

function mediaTimescale(buffer, mdhd) {
  const { version, cursor } = fullBox(buffer, mdhd); const position = version === 1 ? cursor + 16 : cursor + 8;
  if (![0, 1].includes(version) || position + 4 > mdhd.end) die('mp4_mdhd_invalid'); return buffer.readUInt32BE(position);
}

function editMediaTime(buffer, trak) {
  const edts = child(buffer, trak, 'edts'); if (!edts) return 0n; const elst = child(buffer, edts, 'elst'); if (!elst) return 0n;
  const { version, cursor } = fullBox(buffer, elst); if (![0, 1].includes(version) || cursor + 4 > elst.end) die('mp4_elst_invalid');
  const count = buffer.readUInt32BE(cursor); let position = cursor + 4;
  for (let index = 0; index < count; index += 1) {
    const width = version === 1 ? 20 : 12; if (position + width > elst.end) die('mp4_elst_invalid');
    const mediaTime = version === 1 ? buffer.readBigInt64BE(position + 8) : BigInt(buffer.readInt32BE(position + 4)); position += width;
    if (mediaTime >= 0n) return mediaTime;
  }
  return 0n;
}

function timingEntries(buffer, box, signedOffset = false) {
  const { version, cursor } = fullBox(buffer, box); if (cursor + 4 > box.end) die('mp4_timing_truncated');
  const count = buffer.readUInt32BE(cursor); let position = cursor + 4; const entries = [];
  for (let index = 0; index < count; index += 1) {
    if (position + 8 > box.end) die('mp4_timing_truncated');
    const sampleCount = buffer.readUInt32BE(position);
    const value = signedOffset && version === 1 ? buffer.readInt32BE(position + 4) : buffer.readUInt32BE(position + 4);
    if (!sampleCount) die('mp4_zero_timing_run'); entries.push({ sampleCount, value }); position += 8;
  }
  if (position !== box.end) die('mp4_timing_extra_bytes'); return entries;
}

function sampleCount(buffer, stsz) {
  const { cursor } = fullBox(buffer, stsz); if (cursor + 8 > stsz.end) die('mp4_stsz_truncated');
  const fixedSize = buffer.readUInt32BE(cursor); const count = buffer.readUInt32BE(cursor + 4);
  const expected = cursor + 8 + (fixedSize === 0 ? count * 4 : 0); if (expected !== stsz.end) die('mp4_stsz_invalid'); return count;
}

function trackId(buffer, trak) {
  const tkhd = required(child(buffer, trak, 'tkhd'), 'mp4_tkhd_missing'); const { version, cursor } = fullBox(buffer, tkhd);
  const position = version === 1 ? cursor + 16 : cursor + 8; if (![0, 1].includes(version) || position + 4 > tkhd.end) die('mp4_tkhd_invalid'); return buffer.readUInt32BE(position);
}

function trexDefaults(buffer, moov, wantedTrackId) {
  const mvex = child(buffer, moov, 'mvex'); if (!mvex) return null;
  for (const trex of children(buffer, mvex, 'trex')) {
    const { cursor } = fullBox(buffer, trex); if (cursor + 20 !== trex.end) die('mp4_trex_invalid');
    if (buffer.readUInt32BE(cursor) === wantedTrackId) return { duration: buffer.readUInt32BE(cursor + 8), size: buffer.readUInt32BE(cursor + 12), flags: buffer.readUInt32BE(cursor + 16) };
  }
  return null;
}

function fragmentSamples(buffer, roots, wantedTrackId, defaults) {
  const samples = []; let decodeIndex = 0;
  for (const moof of roots.filter((box) => box.type === 'moof')) for (const traf of children(buffer, moof, 'traf')) {
    const tfhd = required(child(buffer, traf, 'tfhd'), 'mp4_tfhd_missing');
    const tfhdFlags = buffer.readUInt32BE(tfhd.dataStart) & 0xffffff; let cursor = tfhd.dataStart + 4;
    if (cursor + 4 > tfhd.end) die('mp4_tfhd_invalid'); const id = buffer.readUInt32BE(cursor); cursor += 4;
    if (id !== wantedTrackId) continue;
    if (tfhdFlags & 0x000001) cursor += 8;
    if (tfhdFlags & 0x000002) cursor += 4;
    let defaultDuration = defaults?.duration ?? 0; let defaultSize = defaults?.size ?? 0; let defaultFlags = defaults?.flags ?? 0;
    if (tfhdFlags & 0x000008) { if (cursor + 4 > tfhd.end) die('mp4_tfhd_invalid'); defaultDuration = buffer.readUInt32BE(cursor); cursor += 4; }
    if (tfhdFlags & 0x000010) { if (cursor + 4 > tfhd.end) die('mp4_tfhd_invalid'); defaultSize = buffer.readUInt32BE(cursor); cursor += 4; }
    if (tfhdFlags & 0x000020) { if (cursor + 4 > tfhd.end) die('mp4_tfhd_invalid'); defaultFlags = buffer.readUInt32BE(cursor); cursor += 4; }
    if (cursor !== tfhd.end) die('mp4_tfhd_invalid');
    const tfdt = required(child(buffer, traf, 'tfdt'), 'mp4_tfdt_missing'); const tfdtFull = fullBox(buffer, tfdt);
    let dts = tfdtFull.version === 1 ? buffer.readBigUInt64BE(tfdtFull.cursor) : BigInt(buffer.readUInt32BE(tfdtFull.cursor));
    for (const trun of children(buffer, traf, 'trun')) {
      const flags = buffer.readUInt32BE(trun.dataStart) & 0xffffff; const version = buffer[trun.dataStart]; let p = trun.dataStart + 4;
      if (p + 4 > trun.end) die('mp4_trun_invalid'); const count = buffer.readUInt32BE(p); p += 4;
      if (flags & 0x000001) p += 4;
      let firstFlags = defaultFlags; if (flags & 0x000004) { firstFlags = buffer.readUInt32BE(p); p += 4; }
      for (let index = 0; index < count; index += 1) {
        let duration = defaultDuration; let size = defaultSize; let sampleFlags = index === 0 ? firstFlags : defaultFlags; let compositionOffset = 0;
        if (flags & 0x000100) { duration = buffer.readUInt32BE(p); p += 4; }
        if (flags & 0x000200) { size = buffer.readUInt32BE(p); p += 4; }
        if (flags & 0x000400) { sampleFlags = buffer.readUInt32BE(p); p += 4; }
        if (flags & 0x000800) { compositionOffset = version === 1 ? buffer.readInt32BE(p) : buffer.readUInt32BE(p); p += 4; }
        if (!duration || !size || p > trun.end) die('mp4_fragment_default_missing');
        samples.push({ decodeIndex: decodeIndex++, ptsTicks: dts + BigInt(compositionOffset), sampleFlags }); dts += BigInt(duration);
      }
      if (p !== trun.end) die('mp4_trun_invalid');
    }
  }
  return samples;
}

function expand(entries, count, defaultValue = 0) {
  if (!entries) return Array(count).fill(defaultValue); const result = [];
  for (const entry of entries) for (let i = 0; i < entry.sampleCount; i += 1) result.push(entry.value);
  if (result.length !== count) die('mp4_timing_count_mismatch'); return result;
}

export function decodePresentationTimeline(buffer) {
  const roots = boxes(buffer); const moov = required(roots.find((box) => box.type === 'moov'), 'mp4_moov_missing');
  const videoTracks = children(buffer, moov, 'trak').filter((trak) => handlerType(buffer, trak) === 'vide');
  if (videoTracks.length !== 1) die('mp4_video_track_count'); const trak = videoTracks[0];
  const mdia = required(child(buffer, trak, 'mdia'), 'mp4_mdia_missing'); const mdhd = required(child(buffer, mdia, 'mdhd'), 'mp4_mdhd_missing');
  const minf = required(child(buffer, mdia, 'minf'), 'mp4_minf_missing'); const stbl = required(child(buffer, minf, 'stbl'), 'mp4_stbl_missing');
  const stts = required(child(buffer, stbl, 'stts'), 'mp4_stts_missing'); const ctts = child(buffer, stbl, 'ctts'); const stsz = required(child(buffer, stbl, 'stsz'), 'mp4_stsz_missing');
  const count = sampleCount(buffer, stsz); let samples = [];
  if (count > 0) {
    const deltas = expand(timingEntries(buffer, stts), count); const offsets = expand(ctts ? timingEntries(buffer, ctts, true) : null, count, 0); let dts = 0n;
    for (let index = 0; index < count; index += 1) { samples.push({ decodeIndex: index, ptsTicks: dts + BigInt(offsets[index]) }); dts += BigInt(deltas[index]); }
  } else samples = fragmentSamples(buffer, roots, trackId(buffer, trak), trexDefaults(buffer, moov, trackId(buffer, trak)));
  const mediaTime = editMediaTime(buffer, trak); for (const sample of samples) sample.ptsTicks -= mediaTime;
  samples.sort((a, b) => a.ptsTicks < b.ptsTicks ? -1 : a.ptsTicks > b.ptsTicks ? 1 : a.decodeIndex - b.decodeIndex);
  return { timeBase: { numerator: 1, denominator: mediaTimescale(buffer, mdhd) }, samples };
}

function strictRows(bytes) {
  const text = bytes.toString('utf8'); if (!text.endsWith('\n')) die('manifest_terminal_lf');
  try { return text.slice(0, -1).split('\n').map((line) => JSON.parse(line)); } catch { die('manifest_json_invalid'); }
}

function parseArgs(argv) {
  const out = {}; for (let i = 0; i < argv.length; i += 2) { const key = argv[i]; if (!key?.startsWith('--') || i + 1 >= argv.length || Object.hasOwn(out, key)) die('cli_flag_invalid'); out[key] = argv[i + 1]; }
  const allowed = ['--video', '--manifest', '--clip-id', '--expected-video-sha256']; if (Object.keys(out).some((key) => !allowed.includes(key)) || allowed.some((key) => !out[key])) die('cli_flag_invalid'); return out;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const args = parseArgs(process.argv.slice(2)); const video = fs.readFileSync(args['--video']);
  if (crypto.createHash('sha256').update(video).digest('hex') !== args['--expected-video-sha256']) die('source_hash_mismatch');
  const rows = strictRows(fs.readFileSync(args['--manifest'])).filter((row) => row.clipId === args['--clip-id']); const timeline = decodePresentationTimeline(video);
  if (rows.length !== timeline.samples.length) die('decoded_row_count_mismatch');
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]; const sample = timeline.samples[index];
    if (row.sourceFrameIndex !== index || row.loopEpoch !== 0 || row.ptsTicks !== `${sample.ptsTicks}` || row.timeBase.numerator !== timeline.timeBase.numerator || row.timeBase.denominator !== timeline.timeBase.denominator) die('decoded_identity_mismatch', `${args['--clip-id']}:${index}`);
  }
  process.stdout.write(`${JSON.stringify({ status: 'exact_pts_preflight_pass', clipId: args['--clip-id'], rows: rows.length, firstPtsTicks: rows[0].ptsTicks, lastPtsTicks: rows.at(-1).ptsTicks, timeBase: timeline.timeBase })}\n`);
}
