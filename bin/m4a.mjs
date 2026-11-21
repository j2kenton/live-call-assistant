// Read a phone call recording while it's still being written.
//
// Android's recorder (MediaRecorder / MPEG4Writer, as used by Samsung's call recorder) writes an .m4a as
// "ftyp", then "mdat" (the audio frames, one after another), and only when the recording stops, "moov",
// the index that says where each frame is. Until then no player can open the file. But a finished
// recording from the same phone has a "moov" with the same codec settings, so the audio so far can be
// played by giving it a copy of that index that describes all the bytes written so far as one big frame:
// FFmpeg's AAC decoder decodes a frame, sees it used fewer bytes than it was given, and carries on with
// the rest, so every frame comes out.
import fs from 'node:fs';

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'udta']);

// The top-level boxes of an MP4: [{type, start, header, size}]. A box still being written (size 0, or
// running past the end) ends at the end of the data.
export function boxes(buf, start = 0, end = buf.length) {
  const out = [];
  let i = start;
  while (i + 8 <= end) {
    let size = buf.readUInt32BE(i);
    const type = buf.toString('latin1', i + 4, i + 8);
    let header = 8;
    if (size === 1 && i + 16 <= end) {
      size = Number(buf.readBigUInt64BE(i + 8));
      header = 16;
    }
    if (size === 0 || i + size > end) size = end - i;      // still being written
    if (size < header) break;
    out.push({ type, start: i, header, size });
    i += size;
  }
  return out;
}

const find = (buf, b, type) => boxes(buf, b.start + b.header, b.start + b.size).find((x) => x.type === type);

// Is the recording finished (its index written)?
export function isComplete(buf) {
  return boxes(buf).some((b) => b.type === 'moov');
}

// Where the audio frames start, and how many bytes of them there are so far.
export function audioData(buf) {
  const mdat = boxes(buf).find((b) => b.type === 'mdat');
  if (!mdat) return null;
  return { offset: mdat.start + mdat.header, length: mdat.size - mdat.header };
}

const box = (type, body) => {
  const h = Buffer.alloc(8);
  h.writeUInt32BE(8 + body.length);
  h.write(type, 4, 'latin1');
  return Buffer.concat([h, body]);
};
const u32 = (...n) => {
  const b = Buffer.alloc(4 * n.length);
  n.forEach((v, i) => b.writeUInt32BE(v >>> 0, 4 * i));
  return b;
};
const fullBox = (type, ...n) => box(type, u32(0, ...n));   // version 0, flags 0

// Rebuild a container box from its children, replacing some of them (type -> Buffer, or null to drop).
// A replacement with no child of that type yet is added at the end.
function rebuild(buf, b, replace) {
  const children = boxes(buf, b.start + b.header, b.start + b.size);
  const kids = children.map((k) => (k.type in replace ? replace[k.type] : buf.subarray(k.start, k.start + k.size)));
  for (const [type, body] of Object.entries(replace)) {
    if (body && !children.some((k) => k.type === type)) kids.push(body);
  }
  return box(b.type, Buffer.concat(kids.filter(Boolean)));
}

// A playable MP4 of everything recorded so far in `partial`, using a finished recording from the same
// recorder (`reference`) for the codec settings. Returns null if either isn't what's expected.
export function playable(partial, reference) {
  const data = audioData(partial);
  const refBoxes = boxes(reference);
  const moov = refBoxes.find((b) => b.type === 'moov');
  const ftyp = refBoxes.find((b) => b.type === 'ftyp');
  if (!data || data.length < 1000 || !moov || !ftyp) return null;
  const trak = find(reference, moov, 'trak');
  const mdia = trak && find(reference, trak, 'mdia');
  const minf = mdia && find(reference, mdia, 'minf');
  const stbl = minf && find(reference, minf, 'stbl');
  if (!stbl || !find(reference, stbl, 'stsd')) return null;

  const head = Buffer.concat([
    reference.subarray(ftyp.start, ftyp.start + ftyp.size),
    u32(data.length + 8), Buffer.from('mdat', 'latin1'),
  ]);
  // One sample holding all the audio so far, in one chunk. Its duration doesn't matter to the decoder.
  const tables = {
    stts: fullBox('stts', 1, 1, 1024),
    stsc: fullBox('stsc', 1, 1, 1, 1),
    stsz: fullBox('stsz', 0, 1, data.length),
    stco: fullBox('stco', 1, head.length),
    co64: null, stss: null, ctts: null, sgpd: null, sbgp: null,
  };
  const newStbl = rebuild(reference, stbl, tables);
  const newMinf = rebuild(reference, minf, { stbl: newStbl });
  const newMdia = rebuild(reference, mdia, { minf: newMinf });
  const newTrak = rebuild(reference, trak, { mdia: newMdia, edts: null });
  const newMoov = rebuild(reference, moov, { trak: newTrak, udta: null, meta: null });
  return Buffer.concat([head, partial.subarray(data.offset, data.offset + data.length), newMoov]);
}

export const readFile = (f) => fs.readFileSync(f);
