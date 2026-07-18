// Browser-local exact still decoder. Authoring identity is the verified MP4 sample token plus
// manifest rational PTS; HTML media time, FPS, epsilon and rounded timestamps are never used.
const fail = (code) => { const error = new Error(code); error.code = code; throw error; };
const hex = (value) => value.toString(16).padStart(2, '0').toUpperCase();

function reader(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bounds = (offset, length, code = 'mp4_truncated') => { if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > bytes.length) fail(code); };
  const u8 = (offset) => { bounds(offset, 1); return view.getUint8(offset); };
  const u16 = (offset) => { bounds(offset, 2); return view.getUint16(offset); };
  const u32 = (offset) => { bounds(offset, 4); return view.getUint32(offset); };
  const i32 = (offset) => { bounds(offset, 4); return view.getInt32(offset); };
  const u64 = (offset) => { bounds(offset, 8); const value = view.getBigUint64(offset); if (value > BigInt(Number.MAX_SAFE_INTEGER)) fail('mp4_integer_unsafe'); return Number(value); };
  const bi64 = (offset) => { bounds(offset, 8); return view.getBigInt64(offset); };
  const bu64 = (offset) => { bounds(offset, 8); return view.getBigUint64(offset); };
  const ascii = (offset, length) => { bounds(offset, length); let value = ''; for (let index = 0; index < length; index += 1) value += String.fromCharCode(bytes[offset + index]); return value; };
  return { bytes, bounds, u8, u16, u32, i32, u64, bi64, bu64, ascii };
}

function parseBoxes(r, start = 0, end = r.bytes.length) {
  const result = []; let offset = start;
  while (offset < end) {
    if (offset + 8 > end) fail('mp4_box_truncated'); let size = r.u32(offset); const type = r.ascii(offset + 4, 4); let header = 8;
    if (size === 1) { if (offset + 16 > end) fail('mp4_box_truncated'); size = r.u64(offset + 8); header = 16; } else if (size === 0) size = end - offset;
    if (!Number.isSafeInteger(size) || size < header || offset + size > end) fail('mp4_box_size_invalid');
    result.push({ type, start: offset, dataStart: offset + header, end: offset + size, size }); offset += size;
  }
  if (offset !== end) fail('mp4_box_alignment_invalid'); return result;
}
const children = (r, parent, type) => parseBoxes(r, parent.dataStart, parent.end).filter((box) => !type || box.type === type);
const child = (r, parent, type) => children(r, parent, type)[0];
function oneChild(r, parent, type, code) { const matches = children(r, parent, type); if (matches.length !== 1) fail(code); return matches[0]; }
const required = (value, code) => value ?? fail(code);
function full(r, box) { if (box.dataStart + 4 > box.end) fail('mp4_full_box_truncated'); return { version: r.u8(box.dataStart), flags: r.u32(box.dataStart) & 0xffffff, cursor: box.dataStart + 4 }; }
function closedFull(r, box, versions = [0], allowedFlags = 0, code = 'mp4_full_box_invalid') { const value = full(r, box); if (!versions.includes(value.version) || (value.flags & ~allowedFlags) !== 0) fail(code); return value; }
function exactEnd(cursor, box, code) { if (cursor !== box.end) fail(code); }

function videoTrack(r, moov) {
  const tracks = children(r, moov, 'trak').filter((trak) => {
    const mdia = child(r, trak, 'mdia'); const hdlr = mdia && child(r, mdia, 'hdlr');
    return Boolean(hdlr && hdlr.dataStart + 12 <= hdlr.end && r.ascii(hdlr.dataStart + 8, 4) === 'vide');
  });
  if (tracks.length !== 1) fail('mp4_video_track_count'); return tracks[0];
}
function trackId(r, trak) {
  const tkhd = required(child(r, trak, 'tkhd'), 'mp4_tkhd_missing'); const box = full(r, tkhd); if (![0, 1].includes(box.version)) fail('mp4_tkhd_invalid');
  const position = box.version === 1 ? box.cursor + 16 : box.cursor + 8; if (position + 4 > tkhd.end) fail('mp4_tkhd_invalid'); return r.u32(position);
}
function timescale(r, mdhd) {
  const box = closedFull(r, mdhd, [0, 1], 0, 'mp4_mdhd_invalid'); const position = box.version === 1 ? box.cursor + 16 : box.cursor + 8;
  if (position + 4 > mdhd.end) fail('mp4_mdhd_invalid'); const value = r.u32(position); if (!value) fail('mp4_mdhd_invalid'); return value;
}
function editMediaTime(r, trak) {
  const edtsMatches = children(r, trak, 'edts'); if (edtsMatches.length > 1) fail('mp4_edts_duplicate'); const edts = edtsMatches[0]; if (!edts) return 0n; const elstMatches = children(r, edts, 'elst'); if (elstMatches.length !== 1) fail('mp4_elst_missing_or_duplicate'); const elst = elstMatches[0];
  const box = closedFull(r, elst, [0, 1], 0, 'mp4_elst_invalid'); if (box.cursor + 4 > elst.end) fail('mp4_elst_invalid'); const count = r.u32(box.cursor); let cursor = box.cursor + 4; let selected = null; let nonempty = 0;
  for (let index = 0; index < count; index += 1) {
    const width = box.version === 1 ? 20 : 12; if (cursor + width > elst.end) fail('mp4_elst_invalid');
    const mediaTime = box.version === 1 ? r.bi64(cursor + 8) : BigInt(r.i32(cursor + 4)); const rateOffset = box.version === 1 ? cursor + 16 : cursor + 8; const rateInteger = r.u16(rateOffset); const rateFraction = r.u16(rateOffset + 2); cursor += width;
    if (rateInteger !== 1 || rateFraction !== 0 || mediaTime < 0n) fail('mp4_elst_semantics_unsupported'); nonempty += 1; selected = mediaTime;
  }
  exactEnd(cursor, elst, 'mp4_elst_invalid'); if (count && nonempty !== 1) fail('mp4_elst_semantics_unsupported'); return selected ?? 0n;
}
function timingRuns(r, box, signed = false) {
  const info = closedFull(r, box, signed ? [0, 1] : [0], 0, 'mp4_timing_version_invalid'); if (info.cursor + 4 > box.end) fail('mp4_timing_truncated'); const count = r.u32(info.cursor); let cursor = info.cursor + 4; const runs = [];
  if (count > 100_000 || info.cursor + 4 + count * 8 !== box.end) fail('mp4_timing_count_limit'); let total = 0;
  for (let index = 0; index < count; index += 1) { if (cursor + 8 > box.end) fail('mp4_timing_truncated'); const sampleCount = r.u32(cursor); if (!sampleCount || sampleCount > 100_000 || total > 100_000 - sampleCount) fail('mp4_timing_count_limit'); total += sampleCount; const value = signed && info.version === 1 ? r.i32(cursor + 4) : r.u32(cursor + 4); runs.push({ sampleCount, value }); cursor += 8; }
  exactEnd(cursor, box, 'mp4_timing_extra_bytes'); return runs;
}
function expandRuns(runs, count, defaultValue = 0) {
  if (!Number.isSafeInteger(count) || count < 0 || count > 100_000) fail('mp4_sample_count_limit'); if (!runs) return Array(count).fill(defaultValue);
  const total = runs.reduce((sum, run) => { if (sum > count - run.sampleCount) fail('mp4_timing_count_mismatch'); return sum + run.sampleCount; }, 0); if (total !== count) fail('mp4_timing_count_mismatch'); const values = new Array(count); let offset = 0;
  for (const run of runs) { values.fill(run.value, offset, offset + run.sampleCount); offset += run.sampleCount; } return values;
}
function codecConfig(r, stbl) {
  const stsd = oneChild(r, stbl, 'stsd', 'mp4_stsd_missing_or_duplicate'); const info = closedFull(r, stsd, [0], 0, 'mp4_stsd_invalid'); if (info.cursor + 4 > stsd.end || r.u32(info.cursor) !== 1) fail('mp4_stsd_invalid');
  const entries = parseBoxes(r, info.cursor + 4, stsd.end); if (entries.length !== 1 || !['avc1', 'avc3'].includes(entries[0].type)) fail('mp4_avc_entry_required');
  const entry = entries[0]; if (entry.dataStart + 78 > entry.end) fail('mp4_visual_entry_invalid'); const codedWidth = r.u16(entry.dataStart + 24); const codedHeight = r.u16(entry.dataStart + 26); if (!codedWidth || !codedHeight) fail('mp4_visual_entry_invalid');
  const avcBoxes = parseBoxes(r, entry.dataStart + 78, entry.end).filter((box) => box.type === 'avcC'); if (avcBoxes.length !== 1) fail('mp4_avcc_missing_or_duplicate'); const avcC = avcBoxes[0]; const description = r.bytes.slice(avcC.dataStart, avcC.end);
  if (description.length < 7 || description[0] !== 1 || (description[4] & 0xfc) !== 0xfc || (description[4] & 3) !== 3 || (description[5] & 0xe0) !== 0xe0) fail('mp4_avcc_invalid');
  let avcCursor = 6; const spsCount = description[5] & 0x1f; if (!spsCount) fail('mp4_avcc_invalid');
  for (let index = 0; index < spsCount; index += 1) { if (avcCursor + 2 > description.length) fail('mp4_avcc_invalid'); const size = (description[avcCursor] << 8) | description[avcCursor + 1]; avcCursor += 2; if (!size || avcCursor + size > description.length || (description[avcCursor] & 0x1f) !== 7) fail('mp4_avcc_invalid'); avcCursor += size; }
  if (avcCursor >= description.length) fail('mp4_avcc_invalid'); const ppsCount = description[avcCursor++]; if (!ppsCount) fail('mp4_avcc_invalid');
  for (let index = 0; index < ppsCount; index += 1) { if (avcCursor + 2 > description.length) fail('mp4_avcc_invalid'); const size = (description[avcCursor] << 8) | description[avcCursor + 1]; avcCursor += 2; if (!size || avcCursor + size > description.length || (description[avcCursor] & 0x1f) !== 8) fail('mp4_avcc_invalid'); avcCursor += size; }
  if (avcCursor < description.length) {
    if (![100, 110, 122, 144].includes(description[1])) fail('mp4_avcc_invalid');
    if (avcCursor + 4 > description.length || (description[avcCursor] & 0xfc) !== 0xfc || (description[avcCursor + 1] & 0xf8) !== 0xf8 || (description[avcCursor + 2] & 0xf8) !== 0xf8) fail('mp4_avcc_invalid'); avcCursor += 3; const extensionCount = description[avcCursor++];
    for (let index = 0; index < extensionCount; index += 1) { if (avcCursor + 2 > description.length) fail('mp4_avcc_invalid'); const size = (description[avcCursor] << 8) | description[avcCursor + 1]; avcCursor += 2; if (!size || avcCursor + size > description.length || (description[avcCursor] & 0x1f) !== 13) fail('mp4_avcc_invalid'); avcCursor += size; }
  }
  if (avcCursor !== description.length) fail('mp4_avcc_invalid'); const codec = `${entry.type}.${hex(description[1])}${hex(description[2])}${hex(description[3])}`;
  return { codec, codedWidth, codedHeight, description };
}
function sampleSizes(r, stsz, expectedCount) {
  const info = closedFull(r, stsz, [0], 0, 'mp4_stsz_invalid'); if (info.cursor + 8 > stsz.end) fail('mp4_stsz_invalid'); const fixed = r.u32(info.cursor); const count = r.u32(info.cursor + 4); if (count > 100_000) fail('mp4_sample_count_limit'); const expected = info.cursor + 8 + (fixed ? 0 : count * 4); if (expected !== stsz.end) fail('mp4_stsz_invalid');
  if (count && count !== expectedCount) fail('exact_manifest_row_count_mismatch');
  const sizes = []; for (let index = 0; index < count; index += 1) { const size = fixed || r.u32(info.cursor + 8 + index * 4); if (!size) fail('mp4_sample_size_invalid'); sizes.push(size); } return sizes;
}
function chunkOffsets(r, stbl) {
  const stcos = children(r, stbl, 'stco'); const co64s = children(r, stbl, 'co64'); if (stcos.length + co64s.length !== 1) fail('mp4_chunk_offset_table_invalid'); const stco = stcos[0]; const box = stco ?? co64s[0]; const info = closedFull(r, box, [0], 0, 'mp4_chunk_offset_table_invalid'); if (info.cursor + 4 > box.end) fail('mp4_chunk_offset_table_invalid');
  const count = r.u32(info.cursor); const width = stco ? 4 : 8; if (count > 100_000 || info.cursor + 4 + count * width !== box.end) fail('mp4_chunk_offset_table_invalid'); const offsets = [];
  for (let index = 0; index < count; index += 1) offsets.push(stco ? r.u32(info.cursor + 4 + index * 4) : r.u64(info.cursor + 4 + index * 8)); return offsets;
}
function sampleOffsets(r, stbl, sizes) {
  const offsetsByChunk = chunkOffsets(r, stbl); const stsc = oneChild(r, stbl, 'stsc', 'mp4_stsc_missing_or_duplicate'); const info = closedFull(r, stsc, [0], 0, 'mp4_stsc_invalid'); if (info.cursor + 4 > stsc.end) fail('mp4_stsc_invalid'); const count = r.u32(info.cursor); if (!count || count > 100_000 || info.cursor + 4 + count * 12 !== stsc.end) fail('mp4_stsc_invalid'); const runs = [];
  for (let index = 0; index < count; index += 1) { const cursor = info.cursor + 4 + index * 12; const run = { firstChunk: r.u32(cursor), samplesPerChunk: r.u32(cursor + 4), sampleDescriptionIndex: r.u32(cursor + 8) }; if (!run.firstChunk || !run.samplesPerChunk || run.samplesPerChunk > 100_000 || run.sampleDescriptionIndex !== 1 || (index === 0 ? run.firstChunk !== 1 : run.firstChunk <= runs.at(-1).firstChunk)) fail('mp4_stsc_invalid'); runs.push(run); }
  const offsets = new Array(sizes.length); let sample = 0; let runIndex = 0;
  for (let chunkIndex = 1; chunkIndex <= offsetsByChunk.length; chunkIndex += 1) {
    while (runIndex + 1 < runs.length && runs[runIndex + 1].firstChunk <= chunkIndex) runIndex += 1; let offset = offsetsByChunk[chunkIndex - 1];
    if (runs[runIndex].samplesPerChunk > sizes.length - sample) fail('mp4_sample_map_invalid');
    for (let inChunk = 0; inChunk < runs[runIndex].samplesPerChunk; inChunk += 1) { offsets[sample] = offset; offset += sizes[sample++]; if (!Number.isSafeInteger(offset)) fail('mp4_sample_map_invalid'); }
  }
  if (sample !== sizes.length) fail('mp4_sample_map_invalid'); return offsets;
}
function syncSamples(r, stbl, count) {
  const matches = children(r, stbl, 'stss'); if (matches.length > 1) fail('mp4_stss_invalid'); const stss = matches[0]; if (!stss) return new Set(Array.from({ length: count }, (_, index) => index)); const info = closedFull(r, stss, [0], 0, 'mp4_stss_invalid'); if (info.cursor + 4 > stss.end) fail('mp4_stss_invalid'); const entries = r.u32(info.cursor); if (entries > count || info.cursor + 4 + entries * 4 !== stss.end) fail('mp4_stss_invalid'); const result = new Set(); let previous = 0;
  for (let index = 0; index < entries; index += 1) { const sample = r.u32(info.cursor + 4 + index * 4); if (!sample || sample > count || sample <= previous) fail('mp4_stss_invalid'); result.add(sample - 1); previous = sample; } if (!result.size) fail('mp4_stss_invalid'); return result;
}
function ordinarySamples(r, stbl, edit, expectedCount) {
  const stsz = oneChild(r, stbl, 'stsz', 'mp4_stsz_missing_or_duplicate'); const sizes = sampleSizes(r, stsz, expectedCount); if (!sizes.length) return [];
  const offsets = sampleOffsets(r, stbl, sizes); const stts = oneChild(r, stbl, 'stts', 'mp4_stts_missing_or_duplicate'); const deltas = expandRuns(timingRuns(r, stts), sizes.length); const cttsMatches = children(r, stbl, 'ctts'); if (cttsMatches.length > 1) fail('mp4_ctts_duplicate'); const compositions = expandRuns(cttsMatches[0] ? timingRuns(r, cttsMatches[0], true) : null, sizes.length, 0); const sync = syncSamples(r, stbl, sizes.length); const samples = []; let dts = 0n;
  for (let index = 0; index < sizes.length; index += 1) { if (!deltas[index]) fail('mp4_sample_duration_invalid'); samples.push({ decodeIndex: index, dts, ptsTicks: dts + BigInt(compositions[index]) - edit, offset: offsets[index], size: sizes[index], key: sync.has(index) }); dts += BigInt(deltas[index]); } return samples;
}
function trexDefaults(r, moov, wantedTrack) {
  const mvex = child(r, moov, 'mvex'); if (!mvex) return null;
  let found = null; for (const trex of children(r, mvex, 'trex')) { const info = closedFull(r, trex, [0], 0, 'mp4_trex_invalid'); if (info.cursor + 20 !== trex.end) fail('mp4_trex_invalid'); if (r.u32(info.cursor) === wantedTrack) { if (found) fail('mp4_trex_duplicate'); const description = r.u32(info.cursor + 4); if (description !== 1) fail('mp4_sample_description_invalid'); found = { duration: r.u32(info.cursor + 8), size: r.u32(info.cursor + 12), flags: r.u32(info.cursor + 16) }; } } return found;
}
function fragmentSamples(r, roots, moov, wantedTrack, edit, expectedCount) {
  const defaults = trexDefaults(r, moov, wantedTrack); const samples = []; let decodeIndex = 0;
  for (const moof of roots.filter((box) => box.type === 'moof')) for (const traf of children(r, moof, 'traf')) {
    const tfhd = oneChild(r, traf, 'tfhd', 'mp4_tfhd_missing_or_duplicate'); const allowedTfhd = 0x000001 | 0x000002 | 0x000008 | 0x000010 | 0x000020 | 0x010000 | 0x020000; const header = closedFull(r, tfhd, [0], allowedTfhd, 'mp4_tfhd_invalid'); if ((header.flags & 0x010000) || ((header.flags & 0x000001) && (header.flags & 0x020000))) fail('mp4_tfhd_semantics_unsupported'); let cursor = header.cursor; if (cursor + 4 > tfhd.end) fail('mp4_tfhd_invalid'); const id = r.u32(cursor); cursor += 4; if (id !== wantedTrack) continue;
    if (!(header.flags & 0x000001) && !(header.flags & 0x020000)) fail('mp4_tfhd_base_ambiguous'); const tfhdPayload = 4 + (header.flags & 0x000001 ? 8 : 0) + (header.flags & 0x000002 ? 4 : 0) + (header.flags & 0x000008 ? 4 : 0) + (header.flags & 0x000010 ? 4 : 0) + (header.flags & 0x000020 ? 4 : 0); if (header.cursor + tfhdPayload !== tfhd.end) fail('mp4_tfhd_invalid'); let baseDataOffset = moof.start; if (header.flags & 0x000001) { baseDataOffset = r.u64(cursor); cursor += 8; }
    let description = defaults ? 1 : 0; if (header.flags & 0x000002) { description = r.u32(cursor); cursor += 4; }
    let defaultDuration = defaults?.duration ?? 0; let defaultSize = defaults?.size ?? 0; let defaultFlags = defaults?.flags ?? 0;
    if (header.flags & 0x000008) { defaultDuration = r.u32(cursor); cursor += 4; } if (header.flags & 0x000010) { defaultSize = r.u32(cursor); cursor += 4; } if (header.flags & 0x000020) { defaultFlags = r.u32(cursor); cursor += 4; }
    exactEnd(cursor, tfhd, 'mp4_tfhd_invalid'); if (description !== 1) fail('mp4_sample_description_invalid');
    const tfdt = oneChild(r, traf, 'tfdt', 'mp4_tfdt_missing_or_duplicate'); const decodeTime = closedFull(r, tfdt, [0, 1], 0, 'mp4_tfdt_invalid'); if (decodeTime.cursor + (decodeTime.version === 1 ? 8 : 4) !== tfdt.end) fail('mp4_tfdt_invalid'); let dts = decodeTime.version === 1 ? r.bu64(decodeTime.cursor) : BigInt(r.u32(decodeTime.cursor)); let dataCursor = null;
    const truns = children(r, traf, 'trun'); if (!truns.length) fail('mp4_trun_missing');
    for (const trun of truns) {
      const allowedTrun = 0x000001 | 0x000004 | 0x000100 | 0x000200 | 0x000400 | 0x000800; const info = closedFull(r, trun, [0, 1], allowedTrun, 'mp4_trun_invalid'); if ((info.flags & 0x000004) && (info.flags & 0x000400)) fail('mp4_trun_flag_conflict'); let p = info.cursor; if (p + 4 > trun.end) fail('mp4_trun_invalid'); const count = r.u32(p); p += 4; if (count > 100_000 || samples.length > expectedCount - count) fail('exact_manifest_row_count_mismatch'); const prefixBytes = (info.flags & 0x000001 ? 4 : 0) + (info.flags & 0x000004 ? 4 : 0); if (p + prefixBytes > trun.end) fail('mp4_trun_invalid');
      if (info.flags & 0x000001) { dataCursor = baseDataOffset + r.i32(p); p += 4; } if (dataCursor === null) dataCursor = baseDataOffset;
      let firstFlags = defaultFlags; if (info.flags & 0x000004) { firstFlags = r.u32(p); p += 4; }
      const perSampleBytes = (info.flags & 0x000100 ? 4 : 0) + (info.flags & 0x000200 ? 4 : 0) + (info.flags & 0x000400 ? 4 : 0) + (info.flags & 0x000800 ? 4 : 0); if (p + count * perSampleBytes !== trun.end) fail('mp4_trun_invalid');
      let scan = p; let totalDataBytes = 0;
      for (let index = 0; index < count; index += 1) { if (info.flags & 0x000100) scan += 4; const size = info.flags & 0x000200 ? r.u32(scan) : defaultSize; if (info.flags & 0x000200) scan += 4; if (info.flags & 0x000400) scan += 4; if (info.flags & 0x000800) scan += 4; if (!size || totalDataBytes > Number.MAX_SAFE_INTEGER - size) fail('mp4_fragment_default_missing'); totalDataBytes += size; }
      const dataEnd = dataCursor + totalDataBytes; if (!Number.isSafeInteger(dataCursor) || !Number.isSafeInteger(dataEnd) || !roots.filter((box) => box.type === 'mdat').some((mdat) => dataCursor >= mdat.dataStart && dataEnd <= mdat.end)) fail('mp4_sample_outside_mdat');
      for (let index = 0; index < count; index += 1) {
        let duration = defaultDuration; let size = defaultSize; let flags = index === 0 ? firstFlags : defaultFlags; let composition = 0;
        if (info.flags & 0x000100) { duration = r.u32(p); p += 4; } if (info.flags & 0x000200) { size = r.u32(p); p += 4; } if (info.flags & 0x000400) { flags = r.u32(p); p += 4; } if (info.flags & 0x000800) { composition = info.version === 1 ? r.i32(p) : r.u32(p); p += 4; }
        if (!duration || !size || !Number.isSafeInteger(dataCursor) || dataCursor < 0 || dataCursor > Number.MAX_SAFE_INTEGER - size) fail('mp4_fragment_default_missing'); samples.push({ decodeIndex: decodeIndex++, dts, ptsTicks: dts + BigInt(composition) - edit, offset: dataCursor, size, key: (flags & 0x00010000) === 0 }); dataCursor += size; dts += BigInt(duration);
      }
      exactEnd(p, trun, 'mp4_trun_invalid');
    }
  }
  if (samples.length !== expectedCount) fail('exact_manifest_row_count_mismatch'); return samples;
}
function validateSampleRanges(samples, mdats, byteLength) {
  const ranges = samples.map((sample) => ({ start: sample.offset, end: sample.offset + sample.size, decodeIndex: sample.decodeIndex })).sort((a, b) => a.start - b.start || a.end - b.end);
  for (let index = 0; index < ranges.length; index += 1) {
    const range = ranges[index]; if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 0 || range.end > byteLength || range.start >= range.end || !mdats.some((mdat) => range.start >= mdat.dataStart && range.end <= mdat.end)) fail('mp4_sample_outside_mdat');
    if (index && ranges[index - 1].end > range.start) fail('mp4_video_sample_overlap');
  }
}

export function parseIsoBmffVideo(input, expectedRowCount) {
  if (!Number.isInteger(expectedRowCount) || expectedRowCount < 1 || expectedRowCount > 6_711) fail('exact_manifest_row_count_invalid');
  const r = reader(input); const roots = parseBoxes(r); const moovs = roots.filter((box) => box.type === 'moov'); if (moovs.length !== 1) fail('mp4_moov_missing_or_duplicate'); const moov = moovs[0]; const trak = videoTrack(r, moov); const mdia = oneChild(r, trak, 'mdia', 'mp4_mdia_missing_or_duplicate'); const mdhd = oneChild(r, mdia, 'mdhd', 'mp4_mdhd_missing_or_duplicate'); const minf = oneChild(r, mdia, 'minf', 'mp4_minf_missing_or_duplicate'); const stbl = oneChild(r, minf, 'stbl', 'mp4_stbl_missing_or_duplicate'); const config = codecConfig(r, stbl); const edit = editMediaTime(r, trak);
  let samples = ordinarySamples(r, stbl, edit, expectedRowCount); if (!samples.length) samples = fragmentSamples(r, roots, moov, trackId(r, trak), edit, expectedRowCount); if (!samples.length || new Set(samples.map((sample) => sample.decodeIndex)).size !== samples.length) fail('mp4_video_samples_invalid');
  validateSampleRanges(samples, roots.filter((box) => box.type === 'mdat'), r.bytes.length); const presentation = [...samples].sort((a, b) => a.ptsTicks < b.ptsTicks ? -1 : a.ptsTicks > b.ptsTicks ? 1 : a.decodeIndex - b.decodeIndex);
  presentation.forEach((sample, sourceFrameIndex) => { sample.sourceFrameIndex = sourceFrameIndex; }); if (new Set(presentation.map((sample) => `${sample.ptsTicks}`)).size !== presentation.length || !samples.some((sample) => sample.key)) fail('mp4_presentation_mapping_invalid');
  return { bytes: r.bytes, timeBase: { numerator: 1, denominator: timescale(r, mdhd) }, config, decodeSamples: samples, presentation };
}

export function verifyExactManifest(parsed, manifestRows, clipId) {
  if (!Array.isArray(manifestRows) || parsed.presentation.length !== manifestRows.length) fail('exact_manifest_row_count_mismatch');
  for (let index = 0; index < manifestRows.length; index += 1) {
    const row = manifestRows[index]; const sample = parsed.presentation[index];
    if (row.clipId !== clipId || row.sourceFrameIndex !== index || row.ptsTicks !== `${sample.ptsTicks}` || row.loopEpoch !== 0 || row.timeBase?.numerator !== parsed.timeBase.numerator || row.timeBase?.denominator !== parsed.timeBase.denominator) fail('exact_manifest_identity_mismatch');
  }
  return true;
}
export async function sha256Hex(bytes) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((value) => value.toString(16).padStart(2, '0')).join(''); }

export async function decodeExactFrame(parsed, sourceFrameIndex, signal) {
  if (!Number.isInteger(sourceFrameIndex) || sourceFrameIndex < 0 || sourceFrameIndex >= parsed.presentation.length || typeof VideoDecoder !== 'function' || typeof EncodedVideoChunk !== 'function') fail('webcodecs_unavailable');
  const target = parsed.presentation[sourceFrameIndex]; let start = target.decodeIndex; while (start > 0 && !parsed.decodeSamples[start].key) start -= 1; if (!parsed.decodeSamples[start].key) fail('decode_sync_sample_missing');
  let end = parsed.decodeSamples.length - 1; for (let index = target.decodeIndex + 1; index < parsed.decodeSamples.length; index += 1) if (parsed.decodeSamples[index].key) { end = index; break; }
  const support = await VideoDecoder.isConfigSupported({ codec: parsed.config.codec, codedWidth: parsed.config.codedWidth, codedHeight: parsed.config.codedHeight, description: parsed.config.description }); if (!support.supported) fail('webcodecs_config_unsupported');
  let targetFrame = null; let callbackError = null; let settleDecoderError; let decoderErrorSettled = false;
  const decoderError = new Promise((resolve) => { settleDecoderError = resolve; });
  const stableDecoderError = (cause) => { const error = new Error('webcodecs_decode_error', { cause }); error.code = 'webcodecs_decode_error'; return error; };
  const reportDecoderError = (cause) => { if (decoderErrorSettled) return; decoderErrorSettled = true; settleDecoderError(stableDecoderError(cause)); };
  const decoder = new VideoDecoder({
    output(frame) {
      if (frame.timestamp === sourceFrameIndex && !targetFrame) targetFrame = frame;
      else { if (frame.timestamp === sourceFrameIndex) callbackError = Object.assign(new Error('duplicate_target_frame'), { code: 'duplicate_target_frame' }); frame.close(); }
    },
    error(error) { reportDecoderError(error); },
  });
  const abort = () => { try { decoder.close(); } catch {} };
  if (signal?.aborted) fail('exact_decode_aborted'); signal?.addEventListener('abort', abort, { once: true });
  try {
    decoder.configure(support.config);
    for (let index = start; index <= end; index += 1) {
      if (signal?.aborted) fail('exact_decode_aborted'); const sample = parsed.decodeSamples[index];
      decoder.decode(new EncodedVideoChunk({ type: sample.key ? 'key' : 'delta', timestamp: sample.sourceFrameIndex, duration: 1, data: parsed.bytes.subarray(sample.offset, sample.offset + sample.size) }));
    }
    const decodeFailure = await Promise.race([decoder.flush().then(() => null, stableDecoderError), decoderError]);
    if (signal?.aborted) fail('exact_decode_aborted'); if (decodeFailure) throw decodeFailure; if (callbackError) throw callbackError; if (!targetFrame || targetFrame.timestamp !== sourceFrameIndex) fail('exact_target_frame_missing');
    if (targetFrame.codedWidth !== parsed.config.codedWidth || targetFrame.codedHeight !== parsed.config.codedHeight || targetFrame.displayWidth !== targetFrame.codedWidth || targetFrame.displayHeight !== targetFrame.codedHeight) fail('exact_frame_geometry_mismatch');
    return { frame: targetFrame, evidence: { sampleToken: targetFrame.timestamp, codedWidth: targetFrame.codedWidth, codedHeight: targetFrame.codedHeight, displayWidth: targetFrame.displayWidth, displayHeight: targetFrame.displayHeight, codec: parsed.config.codec, gopDecodeStart: start, gopDecodeEndInclusive: end } };
  } catch (error) { targetFrame?.close(); throw error; }
  finally { signal?.removeEventListener('abort', abort); if (decoder.state !== 'closed') decoder.close(); }
}

export class ExactStillDecoder {
  constructor() { this.cache = new Map(); }
  async load({ clipId, url, expectedBytes, expectedSha256, manifestRows }) {
    if (!this.cache.has(clipId)) this.cache.set(clipId, (async () => {
      const response = await fetch(url, { cache: 'no-store' }); if (!response.ok) fail('source_fetch_failed'); const bytes = new Uint8Array(await response.arrayBuffer()); if (bytes.length !== expectedBytes) fail('source_byte_length_mismatch'); const digest = await sha256Hex(bytes); if (digest !== expectedSha256) fail('source_sha256_mismatch'); const parsed = parseIsoBmffVideo(bytes, manifestRows.length); verifyExactManifest(parsed, manifestRows, clipId); return { parsed, sourceByteSha256: digest };
    })());
    try { return await this.cache.get(clipId); } catch (error) { this.cache.delete(clipId); throw error; }
  }
  async decode(options, sourceFrameIndex, signal) { const loaded = await this.load(options); const decoded = await decodeExactFrame(loaded.parsed, sourceFrameIndex, signal); return { ...decoded, sourceByteSha256: loaded.sourceByteSha256 }; }
}
