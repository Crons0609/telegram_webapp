(() => {
  "use strict";

  // =====================================================
  // CAPTURA DE USUARIO DESDE TELEGRAM WEBAPP
  // =====================================================
  const tg = window.Telegram?.WebApp;
  tg?.ready(); // Inform Telegram that WebApp is ready

  // Interceptar enlace de invitación (Deep Linking con startapp)
  const startParam = tg?.initDataUnsafe?.start_param;
  if (startParam && startParam.startsWith('room_')) {
    const roomId = startParam.replace('room_', '');
    window.location.replace(`/moche?room=${roomId}`);
    return; // Detener ejecución mientras redirige
  }

  const user = tg?.initDataUnsafe?.user;

  if (user) {
    console.log("Usuario conectado:", user.id, user.first_name, user.username);

    // 1. Registro Automático en Firebase Frontend (Garantiza inserción inmediata)
    if (window.Database) {
      const userIdStr = String(user.id);
      const userRef = window.Database.ref("usuarios/" + userIdStr);

      console.log("Verificando usuario en Firebase...");
      userRef.get().then((snapshot) => {
        if (!snapshot.exists()) {
          console.log("Guardando usuario nuevo en Firebase...");
          userRef.set({
            telegram_id: userIdStr,
            cliente_id: parseInt(userIdStr),
            nombre: user.first_name,
            username: user.username || "",
            photo_url: user.photo_url || "",
            bits: 0,
            xp: 0,
            nivel: 1,
            marco_actual: "none",
            avatar_frame: "none",
            tema_actual: "default",
            total_recargas: 0,
            total_ganados: 0,
            Estado: "activo",
            timestamp: new Date().toISOString()
          }).then(() => {
            console.log("Usuario registrado correctamente en Firebase.");
            // Generar stats base para que no haya errores
            window.Database.ref("user_stats/" + userIdStr).set({
              juegos_jugados: 0, bits_apostados: 0, wins_total: 0,
              jackpots_ganados: 0, moches_ganados: 0, ruletas_ganadas: 0
            });
          }).catch(err => console.error("Error guardando en Firebase:", err));
        } else {
          // Actualizar nombre o foto si ya existe
          userRef.update({
            nombre: user.first_name,
            username: user.username || "",
            photo_url: user.photo_url || ""
          });
        }
      }).catch(err => console.error("Error leyendo Firebase:", err));
    } else {
      console.warn("Firebase SDK no detectado en el frontend.");
    }

    // 2. Enviar datos al backend Flask (para mantener la session Cookie en el navegador)
    fetch("/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        telegram_id: user.id,
        nombre: user.first_name,
        username: user.username || "", // Enviar username
        photo_url: user.photo_url || "" // Enviar foto
      })
    })
    .then(res => res.json())
    .then(data => {
      // Si la página cargó sin sesión y ahora recibimos el perfil del server:
      if (data.status === 'ok' && data.profile) {
          
        // Si no existe el contenedor del menú élite (ej: carga inicial sin sesión)
        if (!document.querySelector('.elite-menu-container')) {
            window.location.reload();
            return;
        }

        // Actualizar BITS en la cabecera si estaba en 0 (típico cuando no había sesión pre-render)
        const bitsDisplay = document.querySelector(".header-user .user-info strong, .user-info strong.text-gold");
        if (bitsDisplay && (bitsDisplay.textContent.trim() === "0" || bitsDisplay.textContent.trim() === "")) {
          bitsDisplay.textContent = data.bits;
        }
        
        // Actualizar NOMBRE si estaba vacío
        const nameDisplay = document.querySelector(".header-user .user-info h3, .user-info h3");
        if (nameDisplay && nameDisplay.textContent.trim() === "") {
          nameDisplay.textContent = user.first_name;
        }

        // Emitir un evento custom por si algun otro script (ej: user_profile_manager.js) necesita reconectarse
        const evt = new CustomEvent("session-restored", { detail: data.profile });
        document.dispatchEvent(evt);
        
        // Refrescar el componente global Badge si está cargado (lobby index.html)
        if (window.UserProfileManager && typeof window.UserProfileManager.updateGlobalProfileBadge === "function") {
          window.UserProfileManager.updateGlobalProfileBadge(data.profile);
        }
      }
    })
    .catch(console.error);
  }

  /* =====================================================
     🎰 ZONA JACKPOT 777 — UI CORE ENGINE v3
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
    initBitsListener();
    loadTopRanking();
    initScrollReveal();
    initHeroParticles();
  }

  /* =====================================================
     NAVIGATE TO (used by game cards onclick)
  ===================================================== */
  window.navigateTo = function (url) {
    if (!url) return;
    // Haptic feedback on Telegram
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light');
    window.location.assign(url);
  };

  /* =====================================================
     SCROLL REVEAL — IntersectionObserver
  ===================================================== */
  function initScrollReveal() {
    const els = document.querySelectorAll('.reveal');
    if (!els.length) return;

    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('visible');
          obs.unobserve(e.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

    els.forEach(el => obs.observe(el));

    // Trigger hero elements immediately (above fold)
    document.querySelectorAll('.hero .reveal').forEach(el => el.classList.add('visible'));
  }

  /* =====================================================
     HERO PARTICLES — lightweight CSS animation
  ===================================================== */
  function initHeroParticles() {
    const container = document.getElementById('hero-particles');
    if (!container || prefersReducedMotion) return;

    const COUNT = 18;
    for (let i = 0; i < COUNT; i++) {
      const p = document.createElement('div');
      p.className = 'hero-particle';
      const size = Math.random() * 4 + 2; // 2-6px
      p.style.cssText = `
        width: ${size}px;
        height: ${size}px;
        left: ${Math.random() * 100}%;
        bottom: ${Math.random() * 30}%;
        --dur: ${(Math.random() * 6 + 6).toFixed(1)}s;
        --delay: ${(Math.random() * 6).toFixed(1)}s;
        opacity: 0;
      `;
      container.appendChild(p);
    }
  }

  /* =====================================================
     LOAD TOP 3 RANKING
  ===================================================== */
  async function loadTopRanking() {

    const container = document.getElementById('top3-container');
    if (!container) return;

    try {
      const res = await fetch('/api/ranking/top3');
      const data = await res.json();

      if (data.status === 'ok' && data.top3.length > 0) {
        container.innerHTML = data.top3.map((usr, index) => {
          let badge = '';
          if (index === 0) badge = '🥇';
          else if (index === 1) badge = '🥈';
          else if (index === 2) badge = '🥉';

          let avatarHTML = usr.photo_url
            ? `<img src="${usr.photo_url}" style="width:100%; height:100%; border-radius:50%; object-fit:cover; position:relative; z-index:2; border: 2px solid #c9a227;">`
            : `<div style="width:100%; height:100%; border-radius:50%; background:#333; display:flex; align-items:center; justify-content:center; font-size: 2rem; position:relative; z-index:2; border: 2px solid #555;">👤</div>`;

          // Using standard Global Wrapper logic for frames overlay
          return `
            <div class="top3-card" style="background: rgba(20,25,30,0.8); border: 1px solid rgba(201,162,39,0.3); border-radius: 12px; padding: 20px; text-align: center; width: 220px; cursor: pointer; transition: transform 0.2s;" onclick="UserProfileManager.openPublicProfile('${usr.telegram_id}')">
              
              <div style="font-size: 2rem; margin-bottom: 5px;">${badge}</div>
              
              <div class="avatar-wrapper" style="width: 80px; height: 80px; margin: 0 auto 10px auto;">
                  <div class="avatar-frame frame-${usr.avatar_frame || 'none'}"></div>
                  ${avatarHTML}
              </div>
              
              <h3 style="color: #fff; margin-bottom: 5px; font-size: 1.1rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${usr.nombre}</h3>
              <p style="color: #c9a227; font-size: 0.85rem; font-weight: bold; margin-bottom: 5px;">Nivel ${usr.nivel}</p>
              <p style="color: #aaa; font-size: 0.8rem;">${usr.xp} XP / ${usr.bits} Bits</p>
            </div>
          `;
        }).join('');
      } else {
        container.innerHTML = '<p class="muted">No hay jugadores en el ranking aún.</p>';
      }
    } catch (e) {
      console.error("Error cargando ranking", e);
      container.innerHTML = '<p style="color:red;">Error cargando el ranking.</p>';
    }
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
     ACTUALIZACIÓN DE BITS (EVENT-DRIVEN)
  ===================================================== */
  function initBitsListener() {
    const bitsDisplay = document.querySelector(".user-info strong");

    document.addEventListener("win-update", (e) => {
      if (bitsDisplay && e.detail?.bits !== undefined) {
        bitsDisplay.textContent = e.detail.bits;
      }
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
        const loginBotUsername = "Zona_Jackpot_777bot";
        const loginUrl = `https://t.me/${loginBotUsername}`;
        if (window.Telegram?.WebApp) {
          window.Telegram.WebApp.openTelegramLink(loginUrl);
        } else {
          window.open(loginUrl, "_blank");
        }
        break;

      case "recargar":
        // Redirect to P2P Bits page where user selects the amount
        window.location.href = '/p2p_bits';
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

  /* =====================================================
     MULTIPLAYER LOBBY (DROPDOWNS & MODALS)
  ===================================================== */
  window.toggleDropdown = function (id) {
    const d = document.getElementById(id);
    if (!d) return;
    d.classList.toggle('show');
  };

  // Close dropdown if clicked outside
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.dropdown')) {
      document.querySelectorAll('.dropdown-menu').forEach(d => d.classList.remove('show'));
    }
  });

  window.openRoomCreateModal = function () {
    document.getElementById('room-create-modal')?.classList.remove('hidden');
    document.getElementById('salas-dropdown')?.classList.remove('show');
  };

  window.openRoomBrowserModal = function () {
    document.getElementById('room-browser-modal')?.classList.remove('hidden');
    document.getElementById('salas-dropdown')?.classList.remove('show');
    window.fetchPublicRooms();
  };

  window.openRoomJoinModal = function () {
    const modal = document.getElementById('room-join-modal');
    if (modal) {
      modal.classList.remove('hidden');
      document.getElementById('room-join-code').value = '';
    }
    document.getElementById('salas-dropdown')?.classList.remove('show');
  };

  window.submitJoinPrivateRoom = function () {
    const code = document.getElementById('room-join-code').value.trim();
    if (!code) {
      if (window.Telegram?.WebApp) window.Telegram.WebApp.showAlert("Por favor, ingresa un código válido.");
      else alert("Añade un código");
      return;
    }
    window.closeModal('room-join-modal');
    window.location.href = `/moche?room=${code}`;
  };

  window.closeModal = function (id) {
    document.getElementById(id)?.classList.add('hidden');
  };

  window.toggleBetInput = function () {
    const isBet = document.getElementById('room-bet-type').value === 'bet';
    document.getElementById('room-bet-amount-group').classList.toggle('hidden', !isBet);
  };

  window.submitCreateRoom = async function () {
    const isPrivate = document.getElementById('room-is-private').value === 'true';
    const difficulty = document.getElementById('room-difficulty').value || 'easy';

    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_private: isPrivate,
          difficulty: difficulty,
          total_slots: 4
        })
      });
      const data = await res.json();
      if (data.status === 'ok') {
        window.closeModal('room-create-modal');
        // Redirect a Moche pasándole el Room ID
        window.location.href = `/moche?room=${data.room_id}`;
      } else {
        window.Telegram?.WebApp?.showAlert("Error al crear la sala: " + (data.message || ""));
      }
    } catch (e) {
      console.error(e);
      window.Telegram?.WebApp?.showAlert("Error de conexión con el servidor.");
    }
  };

  window.fetchPublicRooms = async function () {
    const container = document.getElementById('room-list-container');
    if (!container) return;
    container.innerHTML = '<p class="muted" style="text-align:center;">Buscando salas...</p>';

    try {
      const res = await fetch('/api/rooms');
      const data = await res.json();
      if (data.status === 'ok') {
        if (data.rooms.length === 0) {
          container.innerHTML = '<p class="muted" style="text-align:center;">No hay salas públicas disponibles en este momento.</p>';
        } else {
          container.innerHTML = data.rooms.map(r => `
            <div class="room-card">
              <div class="room-details">
                <strong>Sala de ${r.host_name}</strong>
                <div class="room-meta">
                  👤 ${r.players + r.bots}/${r.total_slots} jugadores (Bots: ${r.bots})<br>
                  ${r.bet_amount > 0 ? `💎 Apuesta: ${r.bet_amount} Bits` : '🎮 Amistosa'}
                </div>
              </div>
              <button class="btn-join" onclick="window.location.href='/moche?room=${r.id}'">Unirse</button>
            </div>
          `).join('');
        }
      }
    } catch (e) {
      container.innerHTML = '<p class="muted" style="color:red; text-align:center;">Error al cargar las salas.</p>';
    }
  };

})();