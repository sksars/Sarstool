import { Mp3Encoder } from '@breezystack/lamejs';

function floatTo16BitPCM(float32) {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function encodeWav(channels, sampleRate) {
  const numChannels = channels.length;
  const numSamples = channels[0].length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeString(offset, str) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const s = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return buffer;
}

function encodeMp3(channels, sampleRate, kbps) {
  const numChannels = Math.min(2, channels.length);
  const encoder = new Mp3Encoder(numChannels, sampleRate, kbps || 192);
  const left = floatTo16BitPCM(channels[0]);
  const right = numChannels > 1 ? floatTo16BitPCM(channels[1]) : null;
  const chunkSize = 1152;
  const mp3Chunks = [];
  const total = left.length;

  for (let i = 0; i < total; i += chunkSize) {
    const leftChunk = left.subarray(i, i + chunkSize);
    const mp3buf = right
      ? encoder.encodeBuffer(leftChunk, right.subarray(i, i + chunkSize))
      : encoder.encodeBuffer(leftChunk);
    if (mp3buf.length > 0) {
      mp3Chunks.push(new Uint8Array(mp3buf));
    }
    if ((i / chunkSize) % 40 === 0) {
      self.postMessage({
        type: 'progress',
        value: Math.min(95, Math.round((i / total) * 95)),
      });
    }
  }

  const end = encoder.flush();
  if (end.length > 0) {
    mp3Chunks.push(new Uint8Array(end));
  }

  let totalLen = 0;
  for (const c of mp3Chunks) totalLen += c.length;
  const merged = new Uint8Array(totalLen);
  let pos = 0;
  for (const c of mp3Chunks) {
    merged.set(c, pos);
    pos += c.length;
  }
  return merged.buffer;
}

self.onmessage = (event) => {
  const { format, channelBuffers, sampleRate, kbps } = event.data;
  try {
    const channels = channelBuffers.map((b) => new Float32Array(b));
    let outBuffer;
    if (format === 'wav') {
      self.postMessage({ type: 'progress', value: 50 });
      outBuffer = encodeWav(channels, sampleRate);
    } else {
      outBuffer = encodeMp3(channels, sampleRate, kbps);
    }
    self.postMessage({ type: 'progress', value: 100 });
    self.postMessage({ type: 'done', buffer: outBuffer }, [outBuffer]);
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message || String(err) });
  }
};
