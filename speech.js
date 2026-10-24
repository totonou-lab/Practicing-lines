// 音声の読み上げ（端末内蔵の音声合成）と、マイクで「言い終わり」を聞き取る処理
(function (global) {
  'use strict';

  const synth = global.speechSynthesis;
  let japaneseVoices = [];

  function loadVoices() {
    if (!synth) return [];
    const all = synth.getVoices();
    japaneseVoices = all.filter(v => /^ja/i.test(v.lang));
    return japaneseVoices;
  }
  if (synth) {
    loadVoices();
    synth.addEventListener && synth.addEventListener('voiceschanged', loadVoices);
  }

  function voices() {
    return japaneseVoices.length ? japaneseVoices : loadVoices();
  }

  function findVoice(uri) {
    const list = voices();
    return list.find(v => v.voiceURI === uri) || null;
  }

  // 読み上げ用に記号を整える
  function cleanForSpeech(text) {
    return text
      .replace(/[『』「」]/g, '')
      .replace(/[・･]{2,}|…+|‥+/g, '、')
      .replace(/[―ー]{2,}/g, '、')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // 長い文は途中で止まる端末があるため、文ごとに区切って読む
  function chunks(text) {
    const parts = text.split(/(?<=[。！？!?⁉])/).map(s => s.trim()).filter(Boolean);
    const out = [];
    for (const p of parts) {
      const last = out[out.length - 1];
      if (last && last.length + p.length <= 80) out[out.length - 1] = last + p;
      else out.push(p);
    }
    return out;
  }

  let speakToken = 0;

  // 読み終わったら resolve する。cancel() されたら false で resolve する
  function speak(text, { voiceURI, rate = 1, pitch = 1 } = {}) {
    const my = ++speakToken;
    const pieces = chunks(cleanForSpeech(text));
    if (!synth || !pieces.length) return Promise.resolve(true);
    const voice = findVoice(voiceURI) || voices()[0] || null;

    return new Promise(resolve => {
      let i = 0;
      const next = () => {
        if (my !== speakToken) return resolve(false);
        if (i >= pieces.length) return resolve(true);
        const u = new SpeechSynthesisUtterance(pieces[i++]);
        u.lang = 'ja-JP';
        if (voice) u.voice = voice;
        u.rate = rate;
        u.pitch = pitch;
        // 終了の合図が来ない端末への保険
        const guard = setTimeout(() => { if (my === speakToken) next(); }, (u.text.length * 0.35 / rate + 4) * 1000);
        u.onend = u.onerror = () => { clearTimeout(guard); next(); };
        global.__currentUtterance = u; // 途中で破棄されて onend が来なくなるのを防ぐ
        synth.speak(u);
      };
      next();
    });
  }

  function cancel() {
    speakToken++;
    if (synth) synth.cancel();
  }

  // iPhone では最初の読み上げをボタン操作の中で行う必要があるため、空の音声を流しておく
  function unlock() {
    if (!synth) return;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    synth.speak(u);
  }

  // ---------- マイク ----------

  let audioCtx = null;

  // 話し始めて、その後 silenceSec 秒黙ったら resolve する。
  // onLevel(0〜1, 状態) で画面に音量を伝える。signal.cancelled が true になったら終わる
  async function waitForSpeechEnd({ silenceSec = 1.5, maxWaitSec = 30, onLevel, signal }) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    audioCtx = audioCtx || new (global.AudioContext || global.webkitAudioContext)();
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    const src = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);

    const rms = () => {
      analyser.getFloatTimeDomainData(buf);
      let s = 0;
      for (const v of buf) s += v * v;
      return Math.sqrt(s / buf.length);
    };

    return new Promise(resolve => {
      const startedAt = performance.now();
      let noise = 0, noiseSamples = 0;
      let speaking = false, voicedMs = 0, silentMs = 0, last = performance.now();

      const finish = reason => {
        clearInterval(timer);
        src.disconnect();
        stream.getTracks().forEach(t => t.stop());
        resolve(reason);
      };

      const timer = setInterval(() => {
        if (signal && signal.cancelled) return finish('cancelled');
        const now = performance.now();
        const dt = now - last;
        last = now;
        const level = rms();
        const elapsed = now - startedAt;

        // 最初の0.3秒で周りの雑音の大きさを測る
        if (elapsed < 300) {
          noise += level; noiseSamples++;
          onLevel && onLevel(0, 'listening');
          return;
        }
        const floor = noiseSamples ? noise / noiseSamples : 0;
        const threshold = Math.max(floor * 2.5, 0.015);
        const loud = level > threshold;
        onLevel && onLevel(Math.min(1, level / (threshold * 4)), speaking ? 'speaking' : 'listening');

        if (loud) {
          voicedMs += dt;
          silentMs = 0;
          if (voicedMs > 250) speaking = true;
        } else {
          silentMs += dt;
          if (!speaking) voicedMs = Math.max(0, voicedMs - dt);
        }
        if (speaking && silentMs >= silenceSec * 1000) return finish('done');
        if (elapsed > maxWaitSec * 1000) return finish('timeout');
      }, 50);
    });
  }

  global.Speech = { voices, speak, cancel, unlock, cleanForSpeech, waitForSpeechEnd, supported: !!synth };
})(window);
