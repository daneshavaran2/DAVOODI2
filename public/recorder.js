// ضبط صدا در مرورگر برای تشخیص گفتار روی سرور:
// میکروفون ← تشخیص پایان جمله (سکوت) ← بریدن سکوت ابتدا و انتها ← ۱۶ کیلوهرتز ← WAV.
// در همهٔ مرورگرهای امروزی (کروم، فایرفاکس، سافاری، اج) کار می‌کند؛ فقط HTTPS یا localhost لازم است.

const TARGET_RATE = 16000;

export function recorderSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && (window.AudioContext || window.webkitAudioContext));
}

function rms(f32) {
  let s = 0;
  for (let i = 0; i < f32.length; i++) s += f32[i] * f32[i];
  return Math.sqrt(s / f32.length);
}

function merge(chunks, total) {
  const out = new Float32Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** کاهش نرخ نمونه‌برداری با میانگین‌گیری (پایین‌گذر ساده، برای گفتار کافی است). */
export function downsample(input, inRate, outRate = TARGET_RATE) {
  if (inRate === outRate) return input;
  const ratio = inRate / outRate;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let j = start; j < end; j++) s += input[j];
    out[i] = end > start ? s / (end - start) : 0;
  }
  return out;
}

function normalize(f32) {
  let peak = 0;
  for (let i = 0; i < f32.length; i++) peak = Math.max(peak, Math.abs(f32[i]));
  if (peak < 0.01 || peak >= 0.9) return f32;
  const gain = Math.min(10, 0.9 / peak);
  for (let i = 0; i < f32.length; i++) f32[i] *= gain;
  return f32;
}

/** Float32 (-1..1) ← WAV PCM ۱۶ بیتی تک‌کاناله */
export function encodeWav(f32, rate = TARGET_RATE) {
  const buf = new ArrayBuffer(44 + f32.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + f32.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // تک‌کاناله
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, f32.length * 2, true);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/**
 * شروع ضبط. خروجی: { stop(), done } که done پس از پایان به
 * { wav, seconds, hadSpeech } می‌رسد. ضبط خودکار تمام می‌شود وقتی:
 * بعد از گفتن، silenceMs سکوت شود؛ یا تا noSpeechMs صدایی نیاید؛ یا maxMs بگذرد.
 */
export async function startRecording({ onLevel, onSpeech, maxMs = 12000, silenceMs = 1200, noSpeechMs = 7000 } = {}) {
  // AudioContext پیش از پرسیدن اجازهٔ میکروفون و در همان لمس کاربر ساخته و روشن می‌شود؛
  // سافاری آیفون پس از پنجرهٔ اجازه، دیگر اجازهٔ روشن کردنش را نمی‌دهد و صدایی ضبط نمی‌شود.
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  const resuming = ctx.state === 'suspended' ? ctx.resume().catch(() => {}) : null;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (e) {
    ctx.close().catch(() => {});
    throw e;
  }
  await resuming;
  if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
  const rate = ctx.sampleRate;
  const source = ctx.createMediaStreamSource(stream);
  const mute = ctx.createGain();
  mute.gain.value = 0;

  const chunks = [];
  let total = 0;
  let noise = Infinity; // کمترین سطح صدا در ۳۰۰ میلی‌ثانیهٔ اول = نویز زمینه
  let speechStart = null; // اندیس نمونه
  let lastVoice = 0;
  let finished = false;
  let resolveDone;
  const done = new Promise((r) => (resolveDone = r));

  const onFrame = (f32) => {
    if (finished) return;
    chunks.push(f32);
    total += f32.length;
    const level = rms(f32);
    const ms = (total / rate) * 1000;
    if (ms < 300) {
      noise = Math.min(noise, level);
      onLevel?.(0);
      return;
    }
    const threshold = Math.max(0.012, (Number.isFinite(noise) ? noise : 0.004) * 3);
    onLevel?.(Math.min(1, level / (threshold * 4)));
    if (level > threshold) {
      if (speechStart === null) {
        speechStart = Math.max(0, total - f32.length);
        onSpeech?.();
      }
      lastVoice = total;
    }
    const sinceVoice = ((total - lastVoice) / rate) * 1000;
    if ((speechStart !== null && sinceVoice > silenceMs) || (speechStart === null && ms > noSpeechMs) || ms > maxMs) finish();
  };

  let node;
  if (ctx.audioWorklet && window.AudioWorkletNode) {
    try {
      await ctx.audioWorklet.addModule('/pcm-worklet.js');
      node = new AudioWorkletNode(ctx, 'pcm-capture');
      node.port.onmessage = (e) => onFrame(e.data);
    } catch {
      node = null;
    }
  }
  if (!node) {
    // مرورگرهای قدیمی‌تر
    node = ctx.createScriptProcessor(4096, 1, 1);
    node.onaudioprocess = (e) => onFrame(new Float32Array(e.inputBuffer.getChannelData(0)));
  }
  source.connect(node);
  node.connect(mute);
  mute.connect(ctx.destination);

  function finish() {
    if (finished) return;
    finished = true;
    try {
      source.disconnect();
      node.disconnect();
      mute.disconnect();
    } catch {}
    stream.getTracks().forEach((t) => t.stop());
    ctx.close().catch(() => {});
    let pcm = merge(chunks, total);
    if (speechStart !== null) {
      // سکوت ابتدا و انتها حذف می‌شود تا whisper زودتر جواب بدهد
      const from = Math.max(0, speechStart - Math.round(rate * 0.3));
      const to = Math.min(pcm.length, lastVoice + Math.round(rate * 0.4));
      pcm = pcm.subarray(from, to);
    }
    const out = normalize(downsample(pcm, rate));
    resolveDone({ wav: encodeWav(out), seconds: out.length / TARGET_RATE, hadSpeech: speechStart !== null });
  }

  return { stop: finish, done };
}
