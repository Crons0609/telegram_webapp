(() => {
  "use strict";

  /* =====================================================
     🎰 CASINO ESTRELLA — UI CORE ENGINE v3
     Arquitectura empresarial optimizada
  ===================================================== */

  /* =========================
     CONFIG
  ========================= */
  const CONFIG = Object.freeze({
    tilt: {
      max: 12,
      perspective: 1200,
      scale: 1.04,
      easing: 0.12
    },
    navigationDelay: 120
  });

  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  /* =========================
     HELPERS
  ========================= */
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const raf = window.requestAnimationFrame.bind(window);

  const clamp = (n, min, max) =>
    n < min ? min : n > max ? max : n;

  /* =========================
     INIT
  ========================= */
  document.addEventListener("DOMContentLoaded", initApp);

  function initApp() {
    initReadyState();
    initDelegatedActions();
    initTiltSystem();
  }

  /* =====================================================
     READY STATE (CSS CONTROLLED)
  ===================================================== */
  function initReadyState() {
    if (prefersReducedMotion) return;

    raf(() => {
      document.documentElement.classList.add("is-ready");
    });
  }

  /* =====================================================
     GLOBAL ACTION DELEGATION
  ===================================================== */
  function initDelegatedActions() {
    document.addEventListener("click", handleClick);
  }

  function handleClick(e) {
    const el = e.target.closest("[data-url], [data-action]");
    if (!el) return;

    /* -------- Navigation -------- */
    if (el.dataset.url) {
      e.preventDefault();
      animatePress(el);
      setTimeout(() => {
        window.location.assign(el.dataset.url);
      }, CONFIG.navigationDelay);
      return;
    }

    /* -------- Custom Actions -------- */
    const action = el.dataset.action;

    if (!action) return;

    switch (action) {
      case "login":
        console.log("Login action");
        break;

      case "entrar":
        console.log("Entrar action");
        break;

      case "explorar":
        document
          .getElementById("games-title")
          ?.scrollIntoView({ behavior: "smooth" });
        break;
    }
  }

  function animatePress(el) {
    el.classList.add("is-pressed");
    setTimeout(() => el.classList.remove("is-pressed"), 180);
  }

  /* =====================================================
     ADVANCED 3D TILT SYSTEM
  ===================================================== */
  function initTiltSystem() {
    if (prefersReducedMotion) return;

    const elements = $$("[data-ui='tilt']");
    if (!elements.length) return;

    elements.forEach(setupTilt);
  }

  function setupTilt(element) {
    let rect;
    let currentX = 0;
    let currentY = 0;
    let targetX = 0;
    let targetY = 0;
    let rafId = null;

    function update() {
      currentX += (targetX - currentX) * CONFIG.tilt.easing;
      currentY += (targetY - currentY) * CONFIG.tilt.easing;

      element.style.transform = `
        perspective(${CONFIG.tilt.perspective}px)
        rotateX(${currentY}deg)
        rotateY(${currentX}deg)
        scale(${CONFIG.tilt.scale})
      `;

      if (
        Math.abs(targetX - currentX) > 0.01 ||
        Math.abs(targetY - currentY) > 0.01
      ) {
        rafId = raf(update);
      }
    }

    function handleMove(e) {
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;

      targetX = clamp(
        (x - 0.5) * CONFIG.tilt.max * 2,
        -CONFIG.tilt.max,
        CONFIG.tilt.max
      );

      targetY = clamp(
        (0.5 - y) * CONFIG.tilt.max * 2,
        -CONFIG.tilt.max,
        CONFIG.tilt.max
      );

      if (!rafId) rafId = raf(update);
    }

    function reset() {
      targetX = 0;
      targetY = 0;
      element.style.willChange = "auto";
      rafId = raf(update);
    }

    element.addEventListener("pointerenter", () => {
      rect = element.getBoundingClientRect();
      element.style.willChange = "transform";
    });

    element.addEventListener("pointermove", handleMove);
    element.addEventListener("pointerleave", reset);
  }

  /* =====================================================
     GLOBAL API
  ===================================================== */
  window.CasinoUI = Object.freeze({
    navigate(url) {
      if (!url) return;
      window.location.assign(url);
    }
  });

})();