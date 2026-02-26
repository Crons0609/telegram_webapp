(() => {
  "use strict";

  const symbols = ["🍒", "🍋", "💎", "7️⃣", "⭐", "🔔"];
  const reels = [...document.querySelectorAll(".reel")];
  const spinBtn = document.getElementById("spinBtn");
  const musicBtn = document.getElementById("musicBtn");
  const resultEl = document.querySelector(".result-message");
  const tg = window.Telegram?.WebApp;

  let spinning = false;
  let audioCtx;
  let musicInterval;

  const pick = () => symbols[(Math.random() * symbols.length) | 0];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function beep(freq = 520, duration = 0.1, type = "triangle", gain = 0.03) {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const vol = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    vol.gain.value = gain;
    osc.connect(vol);
    vol.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  }

  function spinSound() {
    let i = 0;
    const timer = setInterval(() => {
      beep(320 + i * 25, 0.04, "square", 0.02);
      i += 1;
      if (i > 16) clearInterval(timer);
    }, 65);
  }

  function winSound() {
    [523, 659, 784, 1046].forEach((f, idx) => setTimeout(() => beep(f, 0.16, "triangle", 0.05), idx * 100));
  }

  function startMusic() {
    const melody = [220, 262, 330, 294, 392, 330];
    let idx = 0;
    musicInterval = setInterval(() => {
      beep(melody[idx % melody.length], 0.18, "sine", 0.015);
      idx += 1;
    }, 220);
    musicBtn.textContent = "Música: ON";
  }

  function stopMusic() {
    clearInterval(musicInterval);
    musicInterval = null;
    musicBtn.textContent = "Música: OFF";
  }

  async function animateReel(reel, target, delay = 0) {
    await sleep(delay);
    reel.classList.add("spinning");
    for (let i = 0; i < 15; i++) {
      reel.querySelector(".symbol").textContent = pick();
      await sleep(70);
    }
    reel.querySelector(".symbol").textContent = target;
    reel.classList.remove("spinning");
  }

  async function playSpin() {
    if (spinning) return;
    spinning = true;
    spinBtn.disabled = true;
    resultEl.textContent = "Girando...";
    spinSound();

    const guaranteedWin = Math.random() > 0.7;
    const results = guaranteedWin ? [pick(), pick(), pick()] : [pick(), pick(), pick()];
    if (guaranteedWin) results[1] = results[0], results[2] = results[0];

    await Promise.all(reels.map((reel, i) => animateReel(reel, results[i], i * 120)));

    const isWin = results.every((s) => s === results[0]);
    if (isWin) {
      resultEl.textContent = "🎉 ¡JACKPOT! Ganaste monedas doradas";
      winSound();
      window.CasinoFX?.confetti();
      tg?.HapticFeedback?.notificationOccurred("success");
      navigator.vibrate?.([50, 30, 70]);
      spinBtn.animate([{ filter: "brightness(1)" }, { filter: "brightness(1.5)" }, { filter: "brightness(1)" }], { duration: 420 });
    } else {
      resultEl.textContent = "Sigue intentando...";
      beep(180, 0.15, "sawtooth", 0.03);
    }

    spinning = false;
    spinBtn.disabled = false;
  }

  spinBtn?.addEventListener("click", () => {
    tg?.HapticFeedback?.impactOccurred("light");
    playSpin();
  });

  musicBtn?.addEventListener("click", () => {
    tg?.HapticFeedback?.impactOccurred("soft");
    if (musicInterval) stopMusic();
    else startMusic();
  });
})();
