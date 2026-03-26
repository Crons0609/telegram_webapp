(() => {
  "use strict";

  /* =====================================================
     🎰 GHOST PLAGUE CASINO — SLOT ENGINE v4
     5 Reels · PNG Symbols · 3D Cylinder Physics
  ===================================================== */

  const CONFIG = Object.freeze({
    symbols: [
      { id: "diamond", cssClass: "sym-diamond", flatClass: "symbol-diamond", weight: 5,  multiplier: 100 },
      { id: "red7",    cssClass: "sym-red7",    flatClass: "symbol-red7",    weight: 12, multiplier: 50  },
      { id: "bar",     cssClass: "sym-bar",      flatClass: "symbol-bar",     weight: 20, multiplier: 25  },
      { id: "crown",   cssClass: "sym-crown",    flatClass: "symbol-crown",   weight: 25, multiplier: 15  },
      { id: "chip",    cssClass: "sym-chip",     flatClass: "symbol-chip",    weight: 35, multiplier: 5   },
      { id: "bell",    cssClass: "sym-bell",     flatClass: "symbol-bell",    weight: 40, multiplier: 2   }
    ],
    /* 3D cylinder settings */
    cylinder: {
      facesVisible: 5,   // how many faces fit in 360°; more = smoother cylinder
      faces: 12,         // total faces on the drum (must be >= facesVisible)
    },
    betStep: 10,
    betMin:  10,
    casinoEdge: 0.70,
    resultDelay: 300,
  });

  /* ── Precompute weighted pool ── */
  const SYMBOL_POOL = (() => {
    const p = [];
    CONFIG.symbols.forEach(s => p.push(...Array(s.weight).fill(s)));
    return p;
  })();
  const randomSymbol = () => SYMBOL_POOL[(Math.random() * SYMBOL_POOL.length) | 0];

  const prefersReducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* =====================================================
     INIT — waits for DOM
  ===================================================== */
  function init() {
    const reels         = [...document.querySelectorAll(".reel")];
    const spinBtnEl     = document.querySelector("[data-action='spin']");
    const spinLabelEl   = document.getElementById("spin-label");
    const resultEl      = document.querySelector(".result-message");
    const betInputEl    = document.getElementById("bet-amount");
    const coinTrayEl    = document.getElementById("coin-tray");
    const dispenserEl   = document.querySelector(".dispenser-outlet");
    const slotMachineEl = document.querySelector(".slot-machine");

    if (!reels.length || !spinBtnEl || !resultEl || !betInputEl) {
      console.warn("[SlotEngine] Missing DOM elements — aborting");
      return;
    }

    /* ── State ── */
    const state = {
      spinning:   false,
      collecting: false,
      currentBet: CONFIG.betMin,
      // Seed immediately from Flask-injected global (set in slotmachine.html)
      userBits:   (window.INITIAL_BITS || 0),
      pendingWin: 0,
    };

    /* ──────────────────────────────────────────────────
       3-D CYLINDER BUILD
       Each reel gets a set of <div class="symbol-face">
       arranged as a prism with rotateX / translateZ.
    ────────────────────────────────────────────────── */
    const FACES = CONFIG.cylinder.faces;
    const anglePerFace = 360 / FACES; // degrees between adjacent faces

    /**
     * Builds (or rebuilds) a cylinder drum inside a reel's .reel-track.
     * @param {HTMLElement} reel
     * @param {Object[]} symbolSequence  — array of symbol objects for each face (length == FACES)
     */
    function buildDrum(reel, symbolSequence) {
      const track  = reel.querySelector(".reel-track");
      const reelH  = reel.clientHeight || 90;
      const radius = Math.round(reelH / (2 * Math.tan(Math.PI / FACES))); // r so face fits reelH

      track.style.cssText = `
        position: absolute;
        top: 0; left: 0;
        width: 100%;
        height: ${reelH}px;
        transform-style: preserve-3d;
        transform-origin: center ${reelH / 2}px;
        will-change: transform;
      `;

      track.innerHTML = "";
      symbolSequence.forEach((sym, i) => {
        const face = document.createElement("div");
        face.className = `symbol-face ${sym.cssClass}`;
        const angle = anglePerFace * i;
        // Depth shading: darker for faces rotated away from viewer
        const cosAngle = Math.cos((angle * Math.PI) / 180);
        const shade    = Math.round(35 + cosAngle * 35); // 0–70 brightness overlay
        face.style.cssText = `
          position: absolute;
          top: 0; left: 0;
          width: 100%;
          height: ${reelH}px;
          transform: rotateX(${-angle}deg) translateZ(${radius}px);
          background-image: url('/static/img/slot/${sym.id === "chip" ? "gold_chip" : sym.id === "bell" ? "gold_bell" : sym.id}.png');
          background-size: 76%;
          background-repeat: no-repeat;
          background-position: center;
          box-shadow: inset 0 0 0 9999px rgba(0,0,0,${Math.max(0, -cosAngle * 0.65).toFixed(2)});
          backface-visibility: hidden;
        `;
        track.appendChild(face);
      });

      return { track, radius, reelH };
    }

    /* ── Initialize each reel with a random drum ── */
    reels.forEach(reel => {
      const seq = Array.from({ length: FACES }, () => randomSymbol());
      buildDrum(reel, seq);
      reel.querySelector(".reel-track").style.transform = "rotateX(0deg)";
    });

    /* ──────────────────────────────────────────────────
       3-D SPIN ANIMATION
       Physics:
         1. Accelerate to max RPM
         2. Coast at top speed
         3. Decelerate with ease-out to final angle
         4. Tiny bounce back (mechanical overshoot)
    ────────────────────────────────────────────────── */
    function spinReel(reel, finalSymbolObj, reelIndex) {
      return new Promise(resolve => {
        const track = reel.querySelector(".reel-track");
        const reelH = reel.clientHeight || 90;

        if (prefersReducedMotion) {
          // Just snap to final symbol
          const seq = Array.from({ length: FACES }, (_, i) => i === 0 ? finalSymbolObj : randomSymbol());
          buildDrum(reel, seq);
          track.style.transform = "rotateX(0deg)";
          reel.classList.remove("is-spinning");
          return resolve(finalSymbolObj);
        }

        reel.classList.add("is-spinning");

        /* Build a fresh random drum (only face 0 = final symbol) */
        const seq = Array.from({ length: FACES }, (_, i) =>
          i === 0 ? finalSymbolObj : randomSymbol()
        );
        const { radius } = buildDrum(reel, seq);

        /*
          We want face[0] centred in the viewport at the end.
          Face[0] is at rotateX(0deg). "Centred" means track rotateX = 0.
          We'll spin N full rotations PLUS land at 0.
          Full spins: 4 + reelIndex extra rotations (stagger stop)
        */
        const totalRotations = 5 + reelIndex * 1.2;
        const endAngle       = totalRotations * 360; // track will end at 0 mod 360
        const duration       = 1600 + reelIndex * 420; // ms, later reels stop later

        /* Keyframes — pure rotate on X, all in degrees */
        const overShoot  = endAngle + anglePerFace * 0.55;
        const bounceBack = endAngle - anglePerFace * 0.18;

        const anim = track.animate([
          { transform: "rotateX(0deg)",             easing: "cubic-bezier(0.4,0,1,1)",       offset: 0    },
          { transform: `rotateX(${endAngle*0.30}deg)`, easing: "linear",                      offset: 0.25 },
          { transform: `rotateX(${endAngle*0.70}deg)`, easing: "linear",                      offset: 0.65 },
          { transform: `rotateX(${overShoot}deg)`,   easing: "cubic-bezier(0.2,0.8,0.5,1)",  offset: 0.90 },
          { transform: `rotateX(${bounceBack}deg)`,  easing: "ease-in-out",                   offset: 0.96 },
          { transform: `rotateX(${endAngle}deg)`,    easing: "ease-out",                      offset: 1.0  },
        ], { duration, fill: "forwards" });

        anim.onfinish = () => {
          reel.classList.remove("is-spinning");
          if (window.CasinoAudio) window.CasinoAudio.playSfx("slot_reel");

          // Commit final position — land exactly on face 0
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              anim.cancel();
              track.style.transform = "rotateX(0deg)";
              resolve(finalSymbolObj);
            });
          });
        };
      });
    }

    /* ──────────────────────────────────────────────────
       BITS SYNC
    ────────────────────────────────────────────────── */
    function getBitsFromDisplay() {
      const el = document.getElementById("global-bits-display");
      if (el) {
        const v = parseInt(el.textContent.replace(/\D/g, ""), 10);
        if (!isNaN(v) && v > 0) return v;
      }
      // Fall back to Flask-seeded value or last known state
      return state.userBits || (window.INITIAL_BITS || 0);
    }

    function syncBits() {
      state.userBits = getBitsFromDisplay();
      updateBetUI();
    }

    /* Observe global bits display for real-time updates */
    const globalBitsEl = document.getElementById("global-bits-display");
    if (globalBitsEl) {
      new MutationObserver(() => { state.userBits = getBitsFromDisplay(); updateBetUI(); })
        .observe(globalBitsEl, { childList: true, subtree: true, characterData: true });
    }
    document.addEventListener("win-update", e => {
      state.userBits = e.detail?.bits || state.userBits;
      updateBetUI();
    });
    setTimeout(syncBits, 200);

    /* ──────────────────────────────────────────────────
       BET UI
    ────────────────────────────────────────────────── */
    function updateBetUI() {
      betInputEl.value = state.currentBet;
      const maxBet = Math.floor(getBitsFromDisplay() / CONFIG.betStep) * CONFIG.betStep;
      const decBtn = document.getElementById("btn-decrease");
      const incBtn = document.getElementById("btn-increase");
      if (decBtn) decBtn.disabled = state.currentBet <= CONFIG.betMin || state.spinning || state.collecting;
      if (incBtn) incBtn.disabled = state.currentBet >= maxBet    || state.spinning || state.collecting || maxBet < CONFIG.betMin;
    }

    document.getElementById("btn-decrease")?.addEventListener("click", () => {
      if (state.spinning || state.collecting) return;
      state.currentBet = Math.max(CONFIG.betMin, state.currentBet - CONFIG.betStep);
      updateBetUI();
      if (window.CasinoAudio) window.CasinoAudio.playSfx("chip_toss");
    });

    document.getElementById("btn-increase")?.addEventListener("click", () => {
      if (state.spinning || state.collecting) return;
      const maxBet = Math.floor(getBitsFromDisplay() / CONFIG.betStep) * CONFIG.betStep;
      state.currentBet = Math.min(maxBet, state.currentBet + CONFIG.betStep);
      updateBetUI();
      if (window.CasinoAudio) window.CasinoAudio.playSfx("chip_toss");
    });

    updateBetUI();

    /* ──────────────────────────────────────────────────
       COIN PHYSICS SYSTEM
    ────────────────────────────────────────────────── */
    class CoinParticle {
      constructor(tray) {
        this.el = document.createElement("div");
        this.el.className = "physical-coin";
        tray.appendChild(this.el);

        const w = tray.offsetWidth  || 300;
        const h = tray.offsetHeight || 42;

        this.x  = w / 2 + (Math.random() - 0.5) * 22;
        this.y  = 0;
        this.vx = (Math.random() - 0.5) * 7;
        this.vy = -(Math.random() * 8 + 4);
        this.gravity    = 0.6;
        this.friction   = 0.52;
        this.floor      = h - 20;
        this.settled    = false;
        this.bounceCount = 0;
        this.rot        = Math.random() * 360;
        this.rotSpeed   = (Math.random() - 0.5) * 14;
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
            setTimeout(() => window.CasinoAudio.playSfx("slot_coin", { volume: 0.45 }), Math.random() * 60);
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
      if (!coinTrayEl) return;
      coinTrayEl.querySelectorAll(".physical-coin").forEach(c => c.remove());
      coinTrayEl.classList.add("active", "dispenser-glow");
      if (dispenserEl) dispenserEl.classList.add("dispenser-glow");

      const particles = [];
      let spawned = 0;
      const gap = Math.max(30, durationMs / count);

      const spawnIv = setInterval(() => {
        if (spawned >= count) { clearInterval(spawnIv); return; }
        particles.push(new CoinParticle(coinTrayEl));
        spawned++;
      }, gap);

      let last = 0;
      function loop(t) {
        if (t - last > 16) {
          last = t;
          let allDone = spawned >= count;
          particles.forEach(p => { if (!p.settled) { p.step(); allDone = false; } });
          if (!allDone || spawned < count) requestAnimationFrame(loop);
          else {
            setTimeout(() => {
              coinTrayEl.classList.remove("dispenser-glow");
              if (dispenserEl) dispenserEl.classList.remove("dispenser-glow");
            }, 800);
          }
        } else requestAnimationFrame(loop);
      }
      requestAnimationFrame(loop);
    }

    /* ──────────────────────────────────────────────────
       COLLECT PENDING WINS
    ────────────────────────────────────────────────── */
    async function collectPendingWins() {
      state.collecting = true;
      setSpinBtn("loading", "RECOGIENDO...");

      const factor          = state.pendingWin / state.currentBet;
      const collectionMs    = factor >= 50 ? 5000 : factor >= 15 ? 3000 : 1500;
      const staggerDelay    = factor >= 50 ? 35   : factor >= 15 ? 25   : 15;

      if (window.CasinoAudio) window.CasinoAudio.playSfx("absorb");

      /* Fly coins from tray to bits display */
      const tray = coinTrayEl;
      if (tray) {
        const coins    = [...tray.querySelectorAll(".physical-coin")];
        const targetEl = document.getElementById("global-bits-display") || document.body;
        const tRect    = targetEl.getBoundingClientRect();
        const tx = tRect.left + tRect.width  / 2;
        const ty = tRect.top  + tRect.height / 2;

        coins.forEach((c, idx) => {
          const cRect = c.getBoundingClientRect();
          c.style.position = "fixed";
          c.style.left     = `${cRect.left}px`;
          c.style.top      = `${cRect.top}px`;
          document.body.appendChild(c);
          void c.offsetWidth;
          c.classList.add("flying-coin");
          setTimeout(() => {
            c.style.left = `${tx - 9}px`;
            c.style.top  = `${ty - 9}px`;
            c.classList.add("collected");
            if (idx % 3 === 0 && window.CasinoAudio) window.CasinoAudio.playSfx("slot_coin", { volume: 0.3 });
            setTimeout(() => c.remove(), 800);
          }, idx * staggerDelay);
        });
        tray.classList.remove("active");
      }

      /* Animate counter up */
      countUpBits(getBitsFromDisplay() - state.pendingWin, getBitsFromDisplay());

      await sleep(collectionMs);
      state.collecting = false;
      state.pendingWin = 0;
      clearResult();
    }

    /* ──────────────────────────────────────────────────
       BITS COUNTER ANIMATION
    ────────────────────────────────────────────────── */
    function countUpBits(from, to) {
      const displays = document.querySelectorAll("#global-bits-display");
      if (!displays.length) return;
      const dur = 1500;
      const t0  = performance.now();
      const update = now => {
        const p   = Math.min((now - t0) / dur, 1);
        const e   = 1 - Math.pow(1 - p, 3);
        const val = Math.floor(from + (to - from) * e);
        displays.forEach(el => el.textContent = val);
        if (p < 1) requestAnimationFrame(update);
        else displays.forEach(el => el.textContent = to);
      };
      requestAnimationFrame(update);
    }

    /* ──────────────────────────────────────────────────
       SPARKLE PARTICLES
    ────────────────────────────────────────────────── */
    function spawnWinParticles(count) {
      const container = slotMachineEl;
      if (!container) return;
      const r  = container.getBoundingClientRect();
      const cx = r.width / 2, cy = r.height / 2;
      for (let i = 0; i < count; i++) {
        const p = document.createElement("div");
        p.className = "win-sparkle";
        p.style.left = `${cx + (Math.random() - 0.5) * 100}px`;
        p.style.top  = `${cy + (Math.random() - 0.5) * 55}px`;
        p.style.setProperty("--tx", `${(Math.random() - 0.5) * 700}px`);
        p.style.setProperty("--ty", `${(Math.random() - 0.5) * 700 - 200}px`);
        p.style.animationDuration = `${0.9 + Math.random() * 0.7}s`;
        container.appendChild(p);
        setTimeout(() => p.remove(), 2200);
      }
    }

    /* ──────────────────────────────────────────────────
       JACKPOT SHAKE
    ────────────────────────────────────────────────── */
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

    /* ──────────────────────────────────────────────────
       RESULT HELPERS
    ────────────────────────────────────────────────── */
    function showResult(msg, state) {
      resultEl.textContent    = msg;
      resultEl.dataset.state  = state;
      resultEl.classList.add("is-visible");
    }
    function clearResult() {
      resultEl.textContent   = "";
      resultEl.dataset.state = "";
      resultEl.classList.remove("is-visible");
    }

    function setSpinBtn(mode, label) {
      spinBtnEl.disabled = (mode !== "ready");
      spinBtnEl.classList.toggle("is-loading", mode === "loading");
      if (spinLabelEl) spinLabelEl.textContent = label;
    }

    /* ──────────────────────────────────────────────────
       EVALUATE RESULT
    ────────────────────────────────────────────────── */
    function evaluate({ win_amount, multiplier, reels_data }) {
      if (win_amount > 0) {
        let coinCount, coinMs;

        if (multiplier >= 1000) {
          coinCount = 100; coinMs = 5000;
          showResult("💎 ¡¡MEGA JACKPOT!! 💎", "jackpot");
          triggerJackpotShake();
          if (window.CasinoAudio) window.CasinoAudio.playSfx("win_big");
        } else if (multiplier >= 100) {
          coinCount = 60;  coinMs = 4000;
          showResult(`🔥 ¡GANANCIA ÉPICA DE ${win_amount}!`, "jackpot");
          triggerJackpotShake();
          if (window.CasinoAudio) window.CasinoAudio.playSfx("win_big");
        } else if (multiplier >= 25) {
          coinCount = 28;  coinMs = 2500;
          showResult(`🎉 ¡GANASTE ${win_amount} BITS!`, "win");
          if (window.CasinoAudio) window.CasinoAudio.playSfx("win_normal");
        } else {
          coinCount = 10;  coinMs = 1500;
          showResult(`🎉 ¡GANASTE ${win_amount} BITS!`, "win");
          if (window.CasinoAudio) window.CasinoAudio.playSfx("win_normal");
        }

        emitCoins(coinCount, coinMs);
        spawnWinParticles(multiplier >= 100 ? 50 : 20);

        if (slotMachineEl) {
          void slotMachineEl.offsetWidth;
          slotMachineEl.classList.add("machine-state-win");
        }

        /* Highlight winning reels */
        let winId = reels_data[0].id, matchCount = 1;
        for (let i = 1; i < reels_data.length; i++) {
          if (reels_data[i].id === winId) matchCount++;
          else break;
        }
        reels.slice(0, matchCount).forEach(r => r.classList.add("is-win"));
        setTimeout(() => reels.forEach(r => r.classList.remove("is-win")), 2800);

        state.pendingWin += win_amount;

        setTimeout(() => {
          setSpinBtn("ready", "RECOGER 💰");
          state.spinning = false;
          if (slotMachineEl) slotMachineEl.classList.remove("machine-state-win");
          updateBetUI();
        }, coinMs + 600);

      } else {
        showResult("😢 Sin suerte… intenta de nuevo", "lose");
        if (window.CasinoAudio) window.CasinoAudio.playSfx("lose");
        setSpinBtn("ready", "GIRAR");
        state.spinning = false;
        updateBetUI();
      }
    }

    /* ──────────────────────────────────────────────────
       MAIN PLAY FUNCTION
    ────────────────────────────────────────────────── */
    async function play() {
      if (state.spinning || state.collecting) return;

      /* Collect pending win first */
      if (state.pendingWin > 0) {
        await collectPendingWins();
        setSpinBtn("ready", "GIRAR");
        updateBetUI();
        return;
      }

      const bits = getBitsFromDisplay();
      state.userBits = bits;

      if (state.currentBet < CONFIG.betMin || state.currentBet > bits) {
        showResult("⚠️ Apuesta no válida o saldo insuficiente", "lose");
        return;
      }

      state.spinning = true;
      setSpinBtn("loading", "GIRANDO...");
      clearResult();

      if (slotMachineEl) {
        slotMachineEl.classList.add("machine-state-spin");
        slotMachineEl.classList.remove("machine-state-win");
      }

      try {
        const resp     = await fetch("/api/spin", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ cantidad: state.currentBet })
        });
        const spinData = await resp.json();

        if (spinData.status !== "ok") {
          showResult("⚠️ " + (spinData.message || "Error al girar"), "lose");
          setSpinBtn("ready", "GIRAR");
          state.spinning = false;
          if (slotMachineEl) slotMachineEl.classList.remove("machine-state-spin");
          updateBetUI();
          return;
        }

        /* Level-up hook */
        if (spinData.profile_updates && window.UserProfileManager) {
          window.UserProfileManager.checkLevelUp?.(spinData.profile_updates);
        }

        /* Animate deduction */
        const visBal = spinData.bits - spinData.win_amount;
        countUpBits(state.userBits, visBal);
        state.userBits = spinData.bits;

        /* Map backend symbols to config objects */
        const finalSymbols = spinData.reels.map(r =>
          CONFIG.symbols.find(s => s.id === r.id) || CONFIG.symbols[5]
        );

        /* Spin all reels (parallel — later reels stop later) */
        await Promise.all(reels.map((reel, i) => spinReel(reel, finalSymbols[i], i)));

        if (slotMachineEl) slotMachineEl.classList.remove("machine-state-spin");
        await sleep(CONFIG.resultDelay);

        evaluate({
          win_amount: spinData.win_amount,
          multiplier: spinData.multiplier,
          reels_data: spinData.reels
        });

      } catch (err) {
        console.error("[SlotEngine]", err);
        showResult("⚠️ Error de conexión", "lose");
        setSpinBtn("ready", "GIRAR");
        state.spinning = false;
        if (slotMachineEl) slotMachineEl.classList.remove("machine-state-spin");
        updateBetUI();
      }
    }

    /* ── Events ── */
    spinBtnEl.addEventListener("click", play);
    document.addEventListener("click", e => {
      if (e.target !== spinBtnEl && e.target.closest("[data-action='spin']")) play();
    });

    /* Expose for console testing */
    window._slotPlay          = play;
    window._slotEmitCoins     = emitCoins;
    window._slotTriggerJackpot = triggerJackpotShake;

    console.log("[SlotEngine] 3D Cylinder Engine initialized ✅");
  } // end init()

  /* ── Boot ── */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})();