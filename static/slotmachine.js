// ======================================================
// 🎰 CASINO ESTRELLA — SLOT ENGINE v5 (ENTERPRISE)
// ======================================================

(() => {
  "use strict";

  /* =====================================================
     CONFIG
  ===================================================== */
  const CONFIG = Object.freeze({
    symbols: [
      { icon: "🍒", weight: 40 },
      { icon: "🍋", weight: 30 },
      { icon: "🍊", weight: 15 },
      { icon: "⭐", weight: 10 },
      { icon: "🔔", weight: 5 }
    ],
    spin: {
      duration: 1400,
      settleThreshold: 0.12,
      resultDelay: 250
    },
    physics: {
      maxVelocity: 4.8,
      acceleration: 0.28,
      friction: 0.93
    },
    casinoEdge: 0.75
  });

  const prefersReducedMotion = matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  /* =====================================================
     ELEMENTS
  ===================================================== */
  const reels = [...document.querySelectorAll(".reel")];
  const resultEl = document.querySelector(".result-message");
  const spinButton = document.querySelector("[data-action='spin']");
  const lever = document.querySelector(".lever");

  if (!reels.length || !spinButton || !resultEl) return;

  /* =====================================================
     STATE
  ===================================================== */
  const state = {
    spinning: false
  };

  /* =====================================================
     SYMBOL SYSTEM (OPTIMIZED)
  ===================================================== */
  const SYMBOL_POOL = (() => {
    const pool = [];
    CONFIG.symbols.forEach(s =>
      pool.push(...Array(s.weight).fill(s.icon))
    );
    return pool;
  })();

  const randomSymbol = () =>
    SYMBOL_POOL[(Math.random() * SYMBOL_POOL.length) | 0];

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  /* =====================================================
     LEVER FEEDBACK
  ===================================================== */
  function animateLever() {
    if (!lever) return;
    lever.classList.remove("is-pulled");
    lever.offsetHeight; // force reflow intentionally
    lever.classList.add("is-pulled");
  }

  /* =====================================================
     REEL PHYSICS ENGINE
  ===================================================== */
  function spinReel(reel, finalSymbol) {
    return new Promise(resolve => {

      const symbolEl = reel.querySelector(".symbol");
      const symbols = CONFIG.symbols.map(s => s.icon);
      const total = symbols.length;

      if (prefersReducedMotion) {
        symbolEl.textContent = finalSymbol;
        return resolve(finalSymbol);
      }

      reel.classList.add("is-spinning");

      let velocity = 0;
      let position = 0;
      const start = performance.now();

      function frame(now) {
        const elapsed = now - start;

        if (elapsed < 260) {
          velocity = Math.min(
            velocity + CONFIG.physics.acceleration,
            CONFIG.physics.maxVelocity
          );
        }

        if (elapsed > CONFIG.spin.duration * 0.6) {
          velocity *= CONFIG.physics.friction;
        }

        position += velocity;
        symbolEl.textContent =
          symbols[(position | 0) % total];

        if (
          elapsed < CONFIG.spin.duration ||
          velocity > CONFIG.spin.settleThreshold
        ) {
          requestAnimationFrame(frame);
          return;
        }

        symbolEl.textContent = finalSymbol;
        reel.classList.remove("is-spinning");

        reel.animate(
          [
            { transform: "translateY(0)" },
            { transform: "translateY(6px)" },
            { transform: "translateY(0)" }
          ],
          { duration: 150, easing: "cubic-bezier(.22,1,.36,1)" }
        );

        resolve(finalSymbol);
      }

      requestAnimationFrame(frame);
    });
  }

  /* =====================================================
     GAME LOGIC
  ===================================================== */
  async function play() {
    if (state.spinning) return;
    state.spinning = true;

    spinButton.disabled = true;
    spinButton.classList.add("is-loading");

    clearResult();
    animateLever();

    const shouldLose = Math.random() < CONFIG.casinoEdge;
    let results;

    if (shouldLose) {
      results = [randomSymbol(), randomSymbol(), randomSymbol()];
      while (results[0] === results[1] && results[1] === results[2]) {
        results[2] = randomSymbol();
      }
    } else {
      const win = randomSymbol();
      results = [win, win, win];
    }

    const spins = reels.map((reel, i) =>
      spinReel(reel, results[i])
    );

    const final = await Promise.all(spins);

    await sleep(CONFIG.spin.resultDelay);
    evaluate(final);

    spinButton.disabled = false;
    spinButton.classList.remove("is-loading");
    state.spinning = false;
  }

  /* =====================================================
     RESULT SYSTEM
  ===================================================== */
  function evaluate(results) {
    const win = results.every(s => s === results[0]);

    if (win) {
      showResult("🎉 ¡GANASTE!", "win");
      reels.forEach(r => r.classList.add("is-win"));
      setTimeout(
        () => reels.forEach(r => r.classList.remove("is-win")),
        1400
      );
    } else {
      showResult("😢 Intenta de nuevo", "lose");
    }
  }

  function showResult(msg, state) {
    resultEl.textContent = msg;
    resultEl.dataset.state = state;
    resultEl.classList.add("is-visible");
  }

  function clearResult() {
    resultEl.textContent = "";
    resultEl.dataset.state = "";
    resultEl.classList.remove("is-visible");
  }

  /* =====================================================
     EVENTS
  ===================================================== */
  document.addEventListener("click", e => {
    if (e.target.closest("[data-action='spin']")) play();
  });

})();