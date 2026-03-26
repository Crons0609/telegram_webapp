(() => {
  "use strict";

  /* =====================================================
     🎰 ZONA JACKPOT 777 — LUXURY PREMIUM SLOT ENGINE
     5 Reels · Emoji Symbols · Advanced Physics
  ===================================================== */

  /* =========================
     CONFIG
  ========================= */
  const CONFIG = Object.freeze({
    symbols: [
      { id: "diamond", class: "symbol-diamond", weight: 5,  multiplier: 100 },
      { id: "red7",    class: "symbol-red7",    weight: 12, multiplier: 50  },
      { id: "bar",     class: "symbol-bar",     weight: 20, multiplier: 25  },
      { id: "crown",   class: "symbol-crown",   weight: 25, multiplier: 15  },
      { id: "chip",    class: "symbol-chip",    weight: 35, multiplier: 5   },
      { id: "bell",    class: "symbol-bell",    weight: 40, multiplier: 2   }
    ],
    spin: {
      resultDelay: 350,
    },
    betStep: 10,
    betMin: 10,
    casinoEdge: 0.70
  });

  const prefersReducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* =========================
     WAIT FOR DOM
  ========================= */
  function init() {
    /* ── Elements ── */
    const reels      = [...document.querySelectorAll(".reel")];
    const spinBtn    = document.getElementById("spin-btn");
    const spinLabel  = document.getElementById("spin-label");
    const resultMsg  = document.getElementById("result-msg");
    const betDisplay = document.getElementById("bet-amount-display");
    const decBtn     = document.getElementById("btn-decrease");
    const incBtn     = document.getElementById("btn-increase");
    const slotMachineEl = document.querySelector(".slot-machine");
    const coinTray   = document.getElementById("coin-tray");

    if (!reels.length || !spinBtn || !resultMsg) {
      console.warn("[SlotMachine] DOM elements not found — aborting init");
      return;
    }

    /* =========================
       STATE
    ========================= */
    const state = {
      spinning:    false,
      collecting:  false,
      currentBet:  CONFIG.betMin,
      userBits:    0,
      pendingWin:  0,
    };

    /* =========================
       SYMBOL SYSTEM (WEIGHTED)
    ========================= */
    const SYMBOL_POOL = (() => {
      const pool = [];
      CONFIG.symbols.forEach(s => pool.push(...Array(s.weight).fill(s)));
      return pool;
    })();

    const randomSymbol = () => SYMBOL_POOL[(Math.random() * SYMBOL_POOL.length) | 0];

    /* Render initial symbols */
    reels.forEach(reel => {
      const track = reel.querySelector(".reel-track");
      if (track) {
        const s = randomSymbol();
        track.innerHTML = `<div class="symbol-final ${s.class}"></div>`;
      }
    });

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    /* =========================
       BITS SYNC
    ========================= */
    function syncBits() {
      const el = document.getElementById("global-bits-display");
      if (el) {
        const raw = parseInt(el.textContent.replace(/\D/g, ""), 10);
        if (!isNaN(raw)) state.userBits = raw;
      }
      updateBetUI();
    }

    function getBitsFromDisplay() {
      const el = document.getElementById("global-bits-display");
      if (!el) return state.userBits;
      const raw = parseInt(el.textContent.replace(/\D/g, ""), 10);
      return isNaN(raw) ? state.userBits : raw;
    }

    /* =========================
       BET UI
    ========================= */
    function updateBetUI() {
      if (betDisplay) betDisplay.textContent = `${state.currentBet} bits`;
      const maxBet = Math.floor(getBitsFromDisplay() / CONFIG.betStep) * CONFIG.betStep;
      if (decBtn) decBtn.disabled = state.currentBet <= CONFIG.betMin || state.spinning || state.collecting;
      if (incBtn) incBtn.disabled = state.currentBet >= maxBet     || state.spinning || state.collecting || maxBet < CONFIG.betMin;
    }

    if (decBtn) decBtn.addEventListener("click", () => {
      if (state.spinning || state.collecting) return;
      state.currentBet = Math.max(CONFIG.betMin, state.currentBet - CONFIG.betStep);
      updateBetUI();
      if (window.CasinoAudio) window.CasinoAudio.playSfx("chip_toss");
    });

    if (incBtn) incBtn.addEventListener("click", () => {
      if (state.spinning || state.collecting) return;
      const maxBet = Math.floor(getBitsFromDisplay() / CONFIG.betStep) * CONFIG.betStep;
      state.currentBet = Math.min(maxBet, state.currentBet + CONFIG.betStep);
      updateBetUI();
      if (window.CasinoAudio) window.CasinoAudio.playSfx("chip_toss");
    });

    // Observe global-bits-display for external changes
    const bitsEl = document.getElementById("global-bits-display");
    if (bitsEl) {
      new MutationObserver(() => {
        state.userBits = getBitsFromDisplay();
        updateBetUI();
      }).observe(bitsEl, { childList: true, subtree: true, characterData: true });
    }

    // Initial sync — wait a moment for perfil.js to populate
    setTimeout(syncBits, 800);
    document.addEventListener("win-update", e => {
      state.userBits = e.detail?.bits || state.userBits;
      updateBetUI();
    });

    /* =========================
       SPIN BUTTON — EVENT
    ========================= */
    spinBtn.addEventListener("click", () => play());
    // Also handle legacy document-level click delegation
    document.addEventListener("click", e => {
      if (e.target !== spinBtn && e.target.closest("[data-action='spin']")) play();
    });

    /* =========================
       REEL ANIMATION ENGINE
    ========================= */
    function spinReel(reel, finalSymbolObj, index) {
      return new Promise(resolve => {
        const track = reel.querySelector(".reel-track");
        if (!track) return resolve(finalSymbolObj);

        const reelH = reel.clientHeight || 80;

        if (prefersReducedMotion) {
          track.innerHTML = `<div class="symbol-final ${finalSymbolObj.class}"></div>`;
          return resolve(finalSymbolObj);
        }

        // Cancel any previous animation
        track.getAnimations && track.getAnimations().forEach(a => a.cancel());
        reel.classList.add("is-spinning");

        // Build scroll strip (more symbols = longer spin; later reels stagger)
        const numRandom   = 18 + index * 6;
        const totalSymbols = numRandom + 1;

        let symbolsHTML = "";
        for (let i = 0; i < numRandom; i++) {
          const sym = randomSymbol();
          symbolsHTML += `<div class="symbol ${sym.class}" style="height:${reelH}px;flex-shrink:0;width:100%;display:flex;align-items:center;justify-content:center;"></div>`;
        }
        symbolsHTML += `<div class="symbol ${finalSymbolObj.class}" style="height:${reelH}px;flex-shrink:0;width:100%;display:flex;align-items:center;justify-content:center;"></div>`;

        track.style.cssText = `
          position: absolute;
          top: 0; left: 0;
          width: 100%;
          height: ${totalSymbols * reelH}px;
          display: flex;
          flex-direction: column;
          will-change: transform;
        `;
        track.innerHTML = symbolsHTML;

        const endY = -(numRandom * reelH);
        const duration = 1800 + index * 400;

        const anim = track.animate([
          { transform: "translateY(0px)",          easing: "cubic-bezier(0.22,0.03,0.36,1)", offset: 0    },
          { transform: `translateY(${endY * 0.4}px)`, easing: "linear",                      offset: 0.2  },
          { transform: `translateY(${endY * 0.75}px)`, easing: "linear",                     offset: 0.65 },
          { transform: `translateY(${endY}px)`,    easing: "cubic-bezier(0.0,0.0,0.2,1)",    offset: 1.0  }
        ], { duration, fill: "forwards" });

        anim.onfinish = () => {
          reel.classList.remove("is-spinning");
          if (window.CasinoAudio) window.CasinoAudio.playSfx("slot_reel");

          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              anim.cancel();
              track.style.cssText = "";
              track.innerHTML = `<div class="symbol-final ${finalSymbolObj.class}"></div>`;
              resolve(finalSymbolObj);
            });
          });
        };
      });
    }

    /* =========================
       BITS COUNTER ANIMATION
    ========================= */
    function countUpBits(startVal, endVal) {
      const displays = document.querySelectorAll("#global-bits-display");
      if (!displays.length) return;
      const duration  = 1500;
      const startTime = performance.now();

      function update(now) {
        const progress = Math.min((now - startTime) / duration, 1);
        const eased    = 1 - Math.pow(1 - progress, 3);
        const val      = Math.floor(startVal + (endVal - startVal) * eased);
        displays.forEach(el => el.textContent = val);
        if (progress < 1) requestAnimationFrame(update);
        else displays.forEach(el => el.textContent = endVal);
      }
      requestAnimationFrame(update);
    }

    /* =========================
       COIN EMITTER (physics)
    ========================= */
    class CoinParticle {
      constructor(tray) {
        this.el = document.createElement("div");
        this.el.className = "physical-coin";
        tray.appendChild(this.el);

        const w = tray.offsetWidth || 300;
        const h = tray.offsetHeight || 36;

        this.x  = w / 2 + (Math.random() - 0.5) * 20;
        this.y  = 0;
        this.vx = (Math.random() - 0.5) * 6;
        this.vy = -(Math.random() * 5 + 2);
        this.gravity  = 0.5;
        this.friction = 0.55;
        this.floor    = h - 18;
        this.settled  = false;
        this.bounceCount = 0;
        this.rot = Math.random() * 360;
        this.rotSpeed = (Math.random() - 0.5) * 12;
        this._render();
      }

      step() {
        if (this.settled) return true;
        this.vy += this.gravity;
        this.x  += this.vx;
        this.y  += this.vy;
        this.rot += this.rotSpeed;

        if (this.y >= this.floor) {
          this.y = this.floor;
          this.vy *= -this.friction;
          this.vx *= 0.8;
          this.rotSpeed *= 0.7;
          this.bounceCount++;
          if (this.bounceCount <= 2 && window.CasinoAudio) {
            setTimeout(() => window.CasinoAudio.playSfx("slot_coin", { volume: 0.4 }), Math.random() * 60);
          }
          if (Math.abs(this.vy) < 0.8) {
            this.vy = 0;
            this.vx *= 0.9;
            if (Math.abs(this.vx) < 0.3) { this.vx = 0; this.settled = true; }
          }
        }
        this._render();
        return false;
      }

      _render() {
        this.el.style.cssText = `left:${this.x}px;top:${this.y}px;transform:rotate(${this.rot}deg);`;
      }
    }

    function emitCoins(count, durationMs) {
      if (!coinTray) return;
      coinTray.querySelectorAll(".physical-coin").forEach(c => c.remove());
      coinTray.classList.add("active");

      const particles = [];
      let spawned = 0;
      const spawnGap = Math.max(30, durationMs / count);

      const spawnInterval = setInterval(() => {
        if (spawned >= count) { clearInterval(spawnInterval); return; }
        particles.push(new CoinParticle(coinTray));
        spawned++;
      }, spawnGap);

      let last = 0;
      function loop(t) {
        if (t - last > 16) {
          last = t;
          let allDone = spawned >= count;
          particles.forEach(p => { if (!p.settled) { p.step(); allDone = false; } });
          if (!allDone || spawned < count) { requestAnimationFrame(loop); }
        } else { requestAnimationFrame(loop); }
      }
      requestAnimationFrame(loop);
    }

    /* =========================
       JACKPOT SHAKE
    ========================= */
    function triggerJackpotShake() {
      if (!slotMachineEl) return;
      slotMachineEl.classList.remove("jackpot-shake");
      void slotMachineEl.offsetWidth;
      slotMachineEl.classList.add("jackpot-shake");
      let n = 0;
      const iv = setInterval(() => {
        n++;
        slotMachineEl.classList.remove("jackpot-shake");
        void slotMachineEl.offsetWidth;
        slotMachineEl.classList.add("jackpot-shake");
        if (n >= 4) clearInterval(iv);
      }, 550);
    }

    /* =========================
       SPARKLE PARTICLES
    ========================= */
    function spawnWinParticles(amount) {
      const container = slotMachineEl;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const cx = rect.width / 2, cy = rect.height / 2;
      for (let i = 0; i < amount; i++) {
        const p = document.createElement("div");
        p.className = "win-sparkle";
        p.style.left = `${cx + (Math.random() - 0.5) * 80}px`;
        p.style.top  = `${cy + (Math.random() - 0.5) * 40}px`;
        p.style.setProperty("--tx", `${(Math.random() - 0.5) * 400}px`);
        p.style.setProperty("--ty", `${(Math.random() - 0.5) * 400 - 100}px`);
        p.style.animationDuration = `${0.8 + Math.random() * 0.6}s`;
        container.appendChild(p);
        setTimeout(() => p.remove(), 1800);
      }
    }

    /* =========================
       SHOW / CLEAR RESULT
    ========================= */
    function showResult(msg, status) {
      resultMsg.textContent = msg;
      resultMsg.dataset.state = status;
      resultMsg.classList.add("visible");
    }

    function clearResult() {
      resultMsg.textContent = "";
      resultMsg.dataset.state = "";
      resultMsg.classList.remove("visible");
    }

    function setSpinBtn(mode, labelText) {
      spinBtn.disabled = (mode !== "ready");
      spinBtn.classList.toggle("is-spinning", mode === "spinning");
      if (spinLabel) spinLabel.textContent = labelText;
    }

    /* =========================
       COLLECT PENDING WINS
    ========================= */
    async function collectPendingWins() {
      state.collecting = true;
      setSpinBtn("spinning", "RECOGIENDO...");

      const factor = state.pendingWin / state.currentBet;
      const collectionDuration = factor >= 50 ? 4000 : factor >= 15 ? 2500 : 1500;

      if (window.CasinoAudio) window.CasinoAudio.playSfx("absorb");

      const prevBits = getBitsFromDisplay() - state.pendingWin;
      countUpBits(prevBits < 0 ? 0 : prevBits, state.userBits);

      await sleep(collectionDuration);

      if (coinTray) {
        coinTray.classList.remove("active");
        coinTray.querySelectorAll(".physical-coin").forEach(c => c.remove());
      }

      state.collecting = false;
      state.pendingWin = 0;
      clearResult();
    }

    /* =========================
       EVALUATE RESULT
    ========================= */
    function evaluate({ win_amount, multiplier, reels_data }) {
      if (win_amount > 0) {
        let coinCount, coinDuration;

        if (multiplier >= 1000) {
          coinCount = 60; coinDuration = 4000;
          showResult("💎 ¡¡MEGA JACKPOT!!", "jackpot");
          triggerJackpotShake();
          if (window.CasinoAudio) window.CasinoAudio.playSfx("win_big");
        } else if (multiplier >= 100) {
          coinCount = 40; coinDuration = 3000;
          showResult(`🔥 ¡GANANCIA ÉPICA DE ${win_amount}!`, "win");
          triggerJackpotShake();
          if (window.CasinoAudio) window.CasinoAudio.playSfx("win_big");
        } else if (multiplier >= 25) {
          coinCount = 20; coinDuration = 2000;
          showResult(`🎉 ¡GANASTE ${win_amount} BITS!`, "win");
          if (window.CasinoAudio) window.CasinoAudio.playSfx("win_normal");
        } else {
          coinCount = 8; coinDuration = 1200;
          showResult(`🎉 ¡GANASTE ${win_amount} BITS!`, "win");
          if (window.CasinoAudio) window.CasinoAudio.playSfx("win_normal");
        }

        emitCoins(coinCount, coinDuration);
        spawnWinParticles(multiplier >= 100 ? 30 : 12);

        if (slotMachineEl) {
          void slotMachineEl.offsetWidth;
          slotMachineEl.classList.add("machine-state-win");
        }

        // Highlight winning reels
        let winSymId = reels_data[0].id, matchCount = 1;
        for (let i = 1; i < reels_data.length; i++) {
          if (reels_data[i].id === winSymId) matchCount++; else break;
        }
        reels.slice(0, matchCount).forEach(r => r.classList.add("is-win"));
        setTimeout(() => reels.forEach(r => r.classList.remove("is-win")), 2500);

        state.pendingWin += win_amount;

        setTimeout(() => {
          setSpinBtn("ready", "RECOGER 💰");
          state.spinning = false;
          if (slotMachineEl) slotMachineEl.classList.remove("machine-state-win");
        }, coinDuration + 500);

      } else {
        showResult("😢 Sin suerte, intenta de nuevo", "lose");
        if (window.CasinoAudio) window.CasinoAudio.playSfx("lose");
        setSpinBtn("ready", "GIRAR");
        state.spinning = false;
        if (slotMachineEl) slotMachineEl.classList.remove("machine-state-spin");
      }
    }

    /* =========================
       MAIN PLAY FUNCTION
    ========================= */
    async function play() {
      if (state.spinning || state.collecting) return;

      // Collect pending win first
      if (state.pendingWin > 0) {
        await collectPendingWins();
        setSpinBtn("ready", "GIRAR");
        return;
      }

      // Validate bet
      const bits = getBitsFromDisplay();
      state.userBits = bits;

      if (state.currentBet < CONFIG.betMin || state.currentBet > bits) {
        showResult("⚠️ Apuesta no válida o saldo insuficiente", "lose");
        return;
      }

      state.spinning = true;
      setSpinBtn("spinning", "GIRANDO...");
      clearResult();

      if (slotMachineEl) {
        slotMachineEl.classList.add("machine-state-spin");
        slotMachineEl.classList.remove("machine-state-win");
      }

      try {
        const resp = await fetch("/api/spin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cantidad: state.currentBet })
        });
        const spinData = await resp.json();

        if (spinData.status !== "ok") {
          showResult("⚠️ " + (spinData.message || "Error al girar"), "lose");
          setSpinBtn("ready", "GIRAR");
          state.spinning = false;
          if (slotMachineEl) slotMachineEl.classList.remove("machine-state-spin");
          return;
        }

        // Profile level-up check
        if (spinData.profile_updates && window.UserProfileManager) {
          window.UserProfileManager.checkLevelUp?.(spinData.profile_updates);
        }

        // Animate bet deduction
        const visBalanceAfterBet = spinData.bits - spinData.win_amount;
        countUpBits(state.userBits, visBalanceAfterBet);
        state.userBits = spinData.bits;

        // Map result symbols
        const formattedResults = spinData.reels.map(r =>
          CONFIG.symbols.find(s => s.id === r.id) || CONFIG.symbols[5]
        );

        // Spin all reels in parallel
        await Promise.all(reels.map((reel, i) => spinReel(reel, formattedResults[i], i)));

        await sleep(CONFIG.spin.resultDelay);
        evaluate({
          win_amount: spinData.win_amount,
          multiplier: spinData.multiplier,
          reels_data: spinData.reels
        });

      } catch (err) {
        console.error("[SlotMachine] Error:", err);
        showResult("⚠️ Error de conexión", "lose");
        setSpinBtn("ready", "GIRAR");
        state.spinning = false;
        if (slotMachineEl) slotMachineEl.classList.remove("machine-state-spin");
      }
    }

    // Expose for console testing
    window._slotPlay          = play;
    window._slotEmitCoins     = emitCoins;
    window._slotTriggerJackpot = triggerJackpotShake;

    // Initial UI state
    updateBetUI();
    console.log("[SlotMachine] Engine initialized ✅");
  } // end init()

  /* =========================
     BOOT
  ========================= */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})();