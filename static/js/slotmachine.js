(() => {
  "use strict";

  /* =====================================================
     🎰 ZONA JACKPOT 777 — LUXURY PREMIUM SLOT ENGINE
     5 Reels · PNG Graphics · Advanced Physics
  ===================================================== */

  /* =========================
     CONFIG (INMUTABLE)
  ========================= */
  const CONFIG = Object.freeze({
    symbols: [
      { id: "diamond", class: "symbol-diamond", weight: 5, multiplier: 100 },
      { id: "red7", class: "symbol-red7", weight: 12, multiplier: 50 },
      { id: "bar", class: "symbol-bar", weight: 20, multiplier: 25 },
      { id: "crown", class: "symbol-crown", weight: 25, multiplier: 15 },
      { id: "chip", class: "symbol-chip", weight: 35, multiplier: 5 },
      { id: "bell", class: "symbol-bell", weight: 40, multiplier: 2 }
    ],
    spin: {
      minDuration: 1000,
      maxDuration: 2000,
      settleThreshold: 0.08,
      resultDelay: 350,
      reelDelay: 150
    },
    physics: {
      maxVelocity: 5.5,
      acceleration: 0.35,
      friction: 0.94,
      snap: 0.40
    },
    casinoEdge: 0.70 // 30% win chance base (balanced for 5 reels)
  });

  const prefersReducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* =========================
     ELEMENTS
  ========================= */
  const reels = [...document.querySelectorAll(".reel")];
  const resultEl = document.querySelector(".result-message");
  const spinButton = document.querySelector("[data-action='spin']");
  const betInput = document.getElementById("bet-amount");

  if (!reels.length || !spinButton || !resultEl) return;

  /* =========================
     STATE
  ========================= */
  const state = {
    spinning: false,
    currentBet: 10,
    userBits: 0,
    pendingWin: 0, // Coins in tray
    collecting: false
  };

  /* =========================
     SYMBOL SYSTEM (WEIGHTED)
  ========================= */
  const SYMBOL_POOL = (() => {
    const pool = [];
    CONFIG.symbols.forEach(s =>
      pool.push(...Array(s.weight).fill(s))
    );
    return pool;
  })();

  const randomSymbol = () => SYMBOL_POOL[(Math.random() * SYMBOL_POOL.length) | 0];

  // Render initial symbols — centered via symbol-final class
  reels.forEach(reel => {
    const track = reel.querySelector(".reel-track");
    const s = randomSymbol();
    if (track) track.innerHTML = `<div class="symbol-final ${s.class}"></div>`;
  });

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  /* =====================================================
     BETTING CONTROLS
  ===================================================== */

  // Sync initial bits from UI
  const initialBitsEl = document.querySelector('#global-bits-display');
  if (initialBitsEl) state.userBits = parseInt(initialBitsEl.textContent.replace(/\D/g, ''), 10) || 0;

  document.querySelectorAll('.bet-btn-circle').forEach(btn => {
    btn.addEventListener('click', (e) => {
      if (state.spinning || state.collecting) return;
      const action = e.currentTarget.getAttribute('data-action');
      let currentVal = parseInt(betInput.value, 10) || 10;

      if (window.CasinoAudio) window.CasinoAudio.playSfx('chip_toss');

      if (action === 'decrease-bet') {
        currentVal = Math.max(10, currentVal - 10);
      } else if (action === 'increase-bet') {
        const maxVal = Math.floor(state.userBits / 10) * 10;
        currentVal = Math.min(maxVal, currentVal + 10);
        if (currentVal < 10 && maxVal >= 10) currentVal = 10;
      }

      betInput.value = currentVal;
      state.currentBet = currentVal;
      updateBetButtonsState();
    });
  });

  function updateBetButtonsState() {
    const decBtn = document.getElementById('btn-decrease');
    const incBtn = document.getElementById('btn-increase');
    const currentVal = parseInt(betInput.value, 10) || 10;
    const maxVal = Math.floor(state.userBits / 10) * 10;

    if (decBtn) decBtn.disabled = currentVal <= 10;
    if (incBtn) incBtn.disabled = currentVal >= maxVal || maxVal < 10;
  }

  updateBetButtonsState();

  // Keep track of bits dynamically
  document.addEventListener("win-update", e => {
    state.userBits = e.detail.bits;
    updateBetButtonsState();
  });

  /* =====================================================
     REEL PHYSICS ENGINE (v3 — Fixed & Premium)
  ===================================================== */
  function spinReel(reel, finalSymbolObj, index) {
    return new Promise(resolve => {
      const track = reel.querySelector('.reel-track');

      // Measure the reel's rendered height — fall back to 80px safety net
      const reelH = reel.clientHeight || reel.getBoundingClientRect().height || 80;

      // Reduced motion: instant swap, no animation
      if (prefersReducedMotion) {
        track.innerHTML = `<div class="symbol-final ${finalSymbolObj.class}"></div>`;
        return resolve(finalSymbolObj);
      }

      // Cancel any previous lingering animation
      track.getAnimations().forEach(a => a.cancel());
      reel.classList.add('is-spinning');

      // ── 1. BUILD SCROLL STRIP ────────────────────────────────────────────
      // More symbols = longer spin. Later reels get more symbols (stagger effect).
      const numRandom = 18 + index * 6;  // reel[0]=18, reel[4]=42 symbols
      const totalSymbols = numRandom + 1; // +1 for the final result symbol

      // FIX: Build HTML with single class attribute (no duplicate)
      let symbolsHTML = '';
      for (let i = 0; i < numRandom; i++) {
        const sym = randomSymbol();
        symbolsHTML += `<div class="symbol ${sym.class}" style="height:${reelH}px;flex-shrink:0;width:100%"></div>`;
      }
      // The result symbol goes at the bottom of the strip
      symbolsHTML += `<div class="symbol ${finalSymbolObj.class}" style="height:${reelH}px;flex-shrink:0;width:100%"></div>`;

      // ── 2. POSITION TRACK ────────────────────────────────────────────────
      // Set track to absolute so translateY math is predictable within overflow:hidden reel
      track.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: ${totalSymbols * reelH}px;
      `;
      track.innerHTML = symbolsHTML;

      // translateY target: shift track up so the last symbol (result) is visible
      const endY = -(numRandom * reelH);

      // ── 3. ANIMATE (3-phase easing: ease-in → linear → ease-out) ─────────
      const baseDuration = 1800;
      const duration = baseDuration + index * 400; // stagger stop times

      const anim = track.animate([
        { transform: 'translateY(0px)', easing: 'cubic-bezier(0.22, 0.03, 0.36, 1)', offset: 0 },
        { transform: `translateY(${endY * 0.4}px)`, easing: 'linear', offset: 0.2 },
        { transform: `translateY(${endY * 0.75}px)`, easing: 'linear', offset: 0.65 },
        { transform: `translateY(${endY}px)`, easing: 'cubic-bezier(0.0, 0.0, 0.2, 1)', offset: 1.0 }
      ], {
        duration,
        fill: 'forwards'
      });

      // ── 4. CLEANUP ────────────────────────────────────────────────────────
      anim.onfinish = () => {
        reel.classList.remove('is-spinning');
        if (window.CasinoAudio) window.CasinoAudio.playSfx('slot_reel');

        // Double rAF: ensures the frozen animation frame renders before DOM swap
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            anim.cancel();
            track.style.cssText = '';   // restore to natural CSS state
            track.innerHTML = `<div class="symbol-final ${finalSymbolObj.class}"></div>`;
            resolve(finalSymbolObj);
          });
        });
      };
    });
  }

  /* =====================================================
     PROGRESSIVE COUNTER
  ===================================================== */
  function countUpBits(startVal, endVal) {
    const bitsDisplays = document.querySelectorAll("#global-bits-display");
    if (!bitsDisplays.length) return;

    const duration = 1500;
    const startTime = performance.now();

    function update(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Easing out cubic
      const easeProgress = 1 - Math.pow(1 - progress, 3);
      const currentVal = Math.floor(startVal + (endVal - startVal) * easeProgress);

      bitsDisplays.forEach(el => el.textContent = currentVal);

      if (progress < 1) {
        requestAnimationFrame(update);
      } else {
        bitsDisplays.forEach(el => el.textContent = endVal);
      }
    }
    requestAnimationFrame(update);
  }

  /* =====================================================
     DEFERRED PAYOUT (COLLECTION PHASE)
  ===================================================== */
  async function collectPendingWins() {
    state.collecting = true;
    spinButton.disabled = true;
    spinButton.classList.add("is-loading");
    spinButton.innerHTML = `<span class="spin-icon">💰</span> Recogiendo...`;

    const payoutFactor = state.pendingWin / state.currentBet;

    // Calculate collection speed and impact dynamically based on tier
    let collectionDuration = 1500;
    let staggerDelay = 15;

    if (payoutFactor > 50) { // Jackpot / Huge win
      collectionDuration = 5500;
      staggerDelay = 35;
    } else if (payoutFactor >= 15) { // Large Win
      collectionDuration = 3500;
      staggerDelay = 25;
    } else if (payoutFactor >= 5) { // Medium Win
      collectionDuration = 2200;
      staggerDelay = 20;
    }

    if (window.CasinoAudio) {
      window.CasinoAudio.playSfx('absorb');
    }

    // Pulse glow on the bits counter
    const bitsCounterEl = document.getElementById('global-bits-display');
    if (bitsCounterEl) bitsCounterEl.closest('.elite-drop-bits, .slot-bits')?.classList.add('pulse-glow');

    // Convert physical coins to flying coins
    const tray = document.getElementById('coin-tray');
    if (tray) {
      const coins = tray.querySelectorAll('.physical-coin');
      // Target element: the bits balance display (Elite Menu or fallback center)
      const targetEl = document.getElementById('global-bits-display') || document.body;
      const targetRect = targetEl.getBoundingClientRect();
      const targetX = targetRect.left + (targetRect.width / 2);
      const targetY = targetRect.top + (targetRect.height / 2);

      coins.forEach((c, idx) => {
        const coinRect = c.getBoundingClientRect();
        // Detach from tray and append to body for absolute body tracking
        c.style.position = 'fixed';
        c.style.left = `${coinRect.left}px`;
        c.style.top = `${coinRect.top}px`;
        document.body.appendChild(c);

        // Force reflow so the transition animates from the old position
        void c.offsetWidth;

        c.classList.add('flying-coin');

        // Stagger their flight
        setTimeout(() => {
          c.style.left = `${targetX - 10}px`;
          c.style.top = `${targetY - 10}px`;
          c.classList.add('collected');

          // Tiny collection clink
          if (idx % 3 === 0 && window.CasinoAudio) {
            window.CasinoAudio.playSfx('slot_coin', { volume: 0.3 });
          }

          setTimeout(() => c.remove(), 800);
        }, idx * staggerDelay);
      });
      tray.classList.remove('active');
    }

    // Progressively update visually
    const currentVisBalance = state.userBits - state.pendingWin;
    countUpBits(currentVisBalance, state.userBits);

    // End Collection
    await sleep(collectionDuration);
    if (bitsCounterEl) bitsCounterEl.closest('.elite-drop-bits, .slot-bits')?.classList.remove('pulse-glow');

    state.collecting = false;
    state.pendingWin = 0;
    clearResult();
  }

  /* =====================================================
     GAME LOGIC
  ===================================================== */
  async function play() {
    if (state.spinning || state.collecting) return;

    // Check deferred payout phase
    if (state.pendingWin > 0) {
      await collectPendingWins();
      // Flow finishes here, we wait for the player to press Spin again
      spinButton.disabled = false;
      spinButton.classList.remove("is-loading");
      spinButton.innerHTML = `<span class="spin-icon">🎰</span> Girar`;
      return;
    }

    const bet = parseInt(betInput.value, 10);
    if (isNaN(bet) || bet <= 0 || bet > state.userBits) {
      showResult("⚠️ Apuesta no válida o saldo insuficiente", "lose");
      spinButton.disabled = false;
      spinButton.classList.remove("is-loading");
      spinButton.innerHTML = `<span class="spin-icon">🎰</span> Girar`;
      return;
    }

    state.spinning = true;
    state.currentBet = bet;
    spinButton.disabled = true;
    spinButton.classList.add("is-loading");
    spinButton.innerHTML = `<span class="spin-icon">🎰</span> Girando...`;

    clearResult();

    // Visual Tension State
    slotMachineEl.classList.add("machine-state-spin");
    slotMachineEl.classList.remove("machine-state-win");
    
    try {
      const resp = await fetch("/api/spin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cantidad: bet })
      });
      const spinData = await resp.json();

      if (spinData.status !== "ok") {
        showResult("⚠️ " + spinData.message, "lose");
        spinButton.disabled = false;
        spinButton.classList.remove("is-loading");
        state.spinning = false;
        return;
      }

      // Check for Level Ups
      if (spinData.profile_updates && window.UserProfileManager) {
        window.UserProfileManager.checkLevelUp(spinData.profile_updates);
      }

      // Animate bet deduction correctly (visually hide the win until collection)
      const visualBalanceAfterBet = spinData.bits - spinData.win_amount;
      countUpBits(state.userBits, visualBalanceAfterBet);

      // Real backend absolute truth
      state.userBits = spinData.bits;

      const results = spinData.reels;

      const formattedResults = results.map(r => {
        return CONFIG.symbols.find(s => s.id === r.id);
      });

      const spins = reels.map((reel, i) => spinReel(reel, formattedResults[i], i));
      await Promise.all(spins);

      await sleep(CONFIG.spin.resultDelay);
      evaluate({
        win_amount: spinData.win_amount,
        multiplier: spinData.multiplier,
        reels_data: results
      });
    } catch (err) {
      showResult("⚠️ Error de conexión o animación", "lose");
      console.error(err);
      spinButton.disabled = false;
      spinButton.classList.remove("is-loading");
      state.spinning = false;
      slotMachineEl.classList.remove("machine-state-spin");
    }

    // Re-enable controls only after coin shower is done (handled inside evaluate)
  }

  /* =====================================================
     COIN EMITTER — physics-based particle system
  ===================================================== */
  const coinTray = document.getElementById('coin-tray');
  const dispenserOutlet = document.querySelector('.dispenser-outlet');
  const slotMachineEl = document.querySelector('.slot-machine');

  class CoinParticle {
    constructor(tray, trayRect) {
      this.el = document.createElement('div');
      this.el.className = 'physical-coin';
      tray.appendChild(this.el);

      // Start position: top-center of the tray (matches the slot)
      this.x = trayRect.width / 2 + (Math.random() - 0.5) * 20;
      this.y = 0; // relative to tray top

      // Launch physics: arc upward, spread laterally
      this.vx = (Math.random() - 0.5) * 6; // horizontal spread
      this.vy = -(Math.random() * 8 + 4);  // upward burst

      this.gravity = 0.6;
      this.friction = 0.55;   // energy lost on floor bounce
      this.floor = trayRect.height - 22; // 22px = coin diameter + padding
      this.settled = false;
      this.bounceCount = 0;
      this.rotation = Math.random() * 360;
      this.rotSpeed = (Math.random() - 0.5) * 12;

      this._render();
    }

    step() {
      if (this.settled) return true; // particle is done

      this.vy += this.gravity;
      this.x += this.vx;
      this.y += this.vy;
      this.rotation += this.rotSpeed;

      // Floor collision
      if (this.y >= this.floor) {
        this.y = this.floor;
        this.vy *= -this.friction;
        this.vx *= 0.8;
        this.rotSpeed *= 0.7;
        this.bounceCount++;

        // Play a subtle clink on each bounce (not every frame)
        if (this.bounceCount <= 2 && window.CasinoAudio) {
          // Stagger slightly so they don't all fire at once
          setTimeout(() => {
            if (window.CasinoAudio) window.CasinoAudio.playSfx('slot_coin', { volume: 0.5 });
          }, Math.random() * 60);
        }

        // Settle check: almost no vertical velocity
        if (Math.abs(this.vy) < 0.8) {
          this.vy = 0;
          this.vx *= 0.9;
          if (Math.abs(this.vx) < 0.3) {
            this.vx = 0;
            this.settled = true;
          }
        }
      }

      this._render();
      return false;
    }

    _render() {
      this.el.style.left = `${this.x}px`;
      this.el.style.top = `${this.y}px`;
      this.el.style.transform = `rotate(${this.rotation}deg)`;
    }
  }

  function emitCoins(count, durationMs) {
    if (!coinTray) return;

    // Clear previous coins
    coinTray.querySelectorAll('.physical-coin').forEach(c => c.remove());
    coinTray.classList.add('active', 'dispenser-glow');
    if (dispenserOutlet) dispenserOutlet.classList.add('dispenser-glow');

    const trayRect = coinTray.getBoundingClientRect();
    // Use offsetWidth/offsetHeight as getBCR might be 0 if not in view
    const trayWidth = coinTray.offsetWidth || 400;
    const trayHeight = coinTray.offsetHeight || 80;
    const fakeTrayRect = { width: trayWidth, height: trayHeight };

    const particles = [];
    let spawned = 0;
    let spawnInterval;

    // Spacing between coin births (ms)
    const spawnGap = Math.max(30, durationMs / count);

    // Spawn coins at intervals
    spawnInterval = setInterval(() => {
      if (spawned >= count) {
        clearInterval(spawnInterval);
        return;
      }
      particles.push(new CoinParticle(coinTray, fakeTrayRect));
      spawned++;
    }, spawnGap);

    // Physics RAF loop — runs until all coins settle and spawn is done
    let lastTime = 0;
    function physicsLoop(time) {
      if (time - lastTime > 16) { // ~60fps
        lastTime = time;
        let allDone = spawned >= count;
        for (const p of particles) {
          if (!p.settled) {
            p.step();
            allDone = false;
          }
        }
        if (!allDone || spawned < count) {
          requestAnimationFrame(physicsLoop);
        } else {
          // Done: remove glow
          setTimeout(() => {
            coinTray.classList.remove('dispenser-glow');
            if (dispenserOutlet) dispenserOutlet.classList.remove('dispenser-glow');
          }, 800);
        }
      } else {
        requestAnimationFrame(physicsLoop);
      }
    }
    requestAnimationFrame(physicsLoop);
  }

  function triggerJackpotShake() {
    if (!slotMachineEl) return;
    slotMachineEl.classList.remove('jackpot-shake');
    // Reflow to restart animation
    void slotMachineEl.offsetWidth;
    slotMachineEl.classList.add('jackpot-shake');
    // Repeat shake for large wins
    let shakes = 0;
    const maxShakes = 4;
    const shakeInterval = setInterval(() => {
      shakes++;
      slotMachineEl.classList.remove('jackpot-shake');
      void slotMachineEl.offsetWidth;
      slotMachineEl.classList.add('jackpot-shake');
      if (shakes >= maxShakes) clearInterval(shakeInterval);
    }, 550);
  }

  /* =====================================================
     RESULT SYSTEM
  ===================================================== */
  function evaluate(spinData) {
    const { win_amount, multiplier, reels_data } = spinData;

    if (win_amount > 0) {
      let coinCount, coinDurationMs;

      // Classify visual intensity by multiplier size (backend driven)
      if (multiplier >= 1000) {
        coinCount = 120;
        coinDurationMs = 5000;
        showResult('💎 ¡¡MEGA JACKPOT!! 💎', 'jackpot');
        triggerJackpotShake();
        if (window.CasinoAudio) window.CasinoAudio.playSfx('win_big');
      } else if (multiplier >= 100) {
        coinCount = 70;
        coinDurationMs = 4000;
        showResult(`🔥 ¡GANANCIA ÉPICA DE ${win_amount}!`, 'win');
        triggerJackpotShake();
        if (window.CasinoAudio) window.CasinoAudio.playSfx('win_big');
      } else if (multiplier >= 25) {
        coinCount = 30;
        coinDurationMs = 2500;
        showResult(`🎉 ¡GANASTE ${win_amount} BITS!`, 'win');
        if (window.CasinoAudio) window.CasinoAudio.playSfx('win_normal');
      } else {
        coinCount = 10;
        coinDurationMs = 1500;
        showResult(`🎉 ¡GANASTE ${win_amount} BITS!`, 'win');
        if (window.CasinoAudio) window.CasinoAudio.playSfx('win_normal');
      }

      emitCoins(coinCount, coinDurationMs);
      
      // Stop spin tension, trigger win flash
      slotMachineEl.classList.remove("machine-state-spin");
      // Trigger reflow to restart animation if multiple wins in a row
      void slotMachineEl.offsetWidth;
      slotMachineEl.classList.add("machine-state-win");
      
      // Emit lightweight CSS particles over the machine
      spawnWinParticles(multiplier >= 100 ? 50 : 20);

      // Highlight winning reels visually (detect from left)
      let winSymbol = reels_data[0].id;
      let matchCount = 1;
      for (let i = 1; i < reels_data.length; i++) {
        if (reels_data[i].id === winSymbol) matchCount++;
        else break;
      }

      for (let i = 0; i < matchCount; i++) {
        reels[i].classList.add('is-win');
      }
      setTimeout(() => reels.forEach(r => r.classList.remove('is-win')), 2500);

      // Save deferred payout for collection phase
      state.pendingWin += win_amount;

      // Re-enable spin button dynamically
      setTimeout(() => {
        spinButton.disabled = false;
        spinButton.classList.remove('is-loading');
        spinButton.innerHTML = `<span class="spin-icon">💰</span> Recoger`;
        state.spinning = false;
        slotMachineEl.classList.remove("machine-state-win");
      }, coinDurationMs + 600);

    } else {
      showResult('😢 Intenta de nuevo', 'lose');
      if (window.CasinoAudio) window.CasinoAudio.playSfx('lose');
      spinButton.disabled = false;
      spinButton.classList.remove('is-loading');
      spinButton.innerHTML = `<span class="spin-icon">🎰</span> Girar`;
      state.spinning = false;
      slotMachineEl.classList.remove("machine-state-spin");
    }
  }

  function showResult(msg, status) {
    resultEl.textContent = msg;
    resultEl.dataset.state = status;
    resultEl.classList.add("is-visible");
  }

  function clearResult() {
    resultEl.textContent = "";
    resultEl.dataset.state = "";
    resultEl.classList.remove("is-visible");
  }

  /* =====================================================
     LIGHTWEIGHT DOM PARTICLES (NO JS PHYSICS)
  ===================================================== */
  function spawnWinParticles(amount) {
    const container = document.querySelector('.slot-machine');
    if (!container) return;
    
    const rect = container.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    for (let i = 0; i < amount; i++) {
      const p = document.createElement('div');
      p.className = 'win-sparkle';
      
      // Random start around center
      p.style.left = `${centerX + (Math.random() - 0.5) * 100}px`;
      p.style.top = `${centerY + (Math.random() - 0.5) * 50}px`;
      
      // Random throw distance for CSS animation var
      const tx = (Math.random() - 0.5) * 800; // px
      const ty = (Math.random() - 0.5) * 800 - 200; // favor upward burst
      p.style.setProperty('--tx', `${tx}px`);
      p.style.setProperty('--ty', `${ty}px`);
      
      // Small random duration delay variance
      p.style.animationDuration = `${1 + Math.random()}s`;

      container.appendChild(p);
      setTimeout(() => p.remove(), 2500); // cleanup after animation
    }
  }

  /* =====================================================
     EVENTS
  ===================================================== */
  document.addEventListener("click", e => {
    if (e.target.closest("[data-action='spin']")) play();
    if (e.target.closest("[data-action='test-win']")) {
      // Quick demo: emits a medium coin shower for testing
      triggerJackpotShake();
      emitCoins(30, 2500);

      // Force test pending state
      state.pendingWin += 500;
      state.userBits += 500;
      const spinBtn = document.querySelector("[data-action='spin']");
      if (spinBtn) spinBtn.innerHTML = `<span class="spin-icon">💰</span> Recoger`;
    }
  });

  // Expose for console testing
  window.emitCoins = emitCoins;
  window.triggerJackpotShake = triggerJackpotShake;
  window.collectPendingWins = collectPendingWins;
})();