/**
 * loading-screen.js — Zona Jackpot 777
 * Global loading screen module loaded on every page.
 * Reads config from /api/loading-screen/config and shows
 * an animated overlay on page navigation.
 */
(function () {
  'use strict';

  const LS_KEY    = 'casino_ls_config';
  const API_URL   = '/api/loading-screen/config';
  const HIDE_DELAY = 350; // ms before removing overlay after page loads

  /* ─── Build the 10 icon HTML templates ──────────────────── */
  const ICONS = {
    1:  `<div class="ls-ring"></div>`,
    2:  `<div class="ls-dot"></div><div class="ls-dot"></div><div class="ls-dot"></div>`,
    3:  ``,   // entire wrap IS the bar (::after pseudo)
    4:  `<div class="ls-ring-a"></div><div class="ls-ring-b"></div>`,
    5:  `<div class="ls-glow"></div>`,
    6:  `<span class="ls-emoji">🎰</span>`,
    7:  `<div class="ls-card">♠</div><div class="ls-card">♥</div><div class="ls-card">♣</div>`,
    8:  `<span class="ls-dice">🎲</span>`,
    9:  `<div class="ls-bar"></div><div class="ls-bar"></div><div class="ls-bar"></div><div class="ls-bar"></div><div class="ls-bar"></div>`,
    10: `<div class="ls-square"></div><div class="ls-square"></div><div class="ls-square"></div><div class="ls-square"></div><div class="ls-square"></div>`,
  };

  /* ─── State ──────────────────────────────────────────────── */
  let _config = null;
  let _el    = null;
  let _hideTimer = null;

  /* ─── Build DOM element ──────────────────────────────────── */
  function _buildEl(cfg) {
    const div = document.createElement('div');
    div.id = 'casino-loading-screen';

    // CSS vars for colours
    div.style.setProperty('--ls-bg',          cfg.bg_color    || '#0a0a1a');
    div.style.setProperty('--ls-icon-color',  cfg.icon_color  || '#f59e0b');
    div.style.setProperty('--ls-text-color',  cfg.text_color  || 'rgba(255,255,255,0.7)');

    const iconId = parseInt(cfg.icon_id, 10) || 1;
    const text   = cfg.text || 'Cargando...';
    const logo   = cfg.logo_url ? `<img src="${cfg.logo_url}" class="ls-logo-img" alt="Logo">` : `<div class="ls-logo">🎰 ZONA JACKPOT 777</div>`;

    div.innerHTML = `
      ${logo}
      <div class="ls-icon-wrap ls-icon-${iconId}">
        ${ICONS[iconId] || ICONS[1]}
      </div>
      <div class="ls-text">${text}</div>
    `;
    return div;
  }

  /* ─── Show loading screen ────────────────────────────────── */
  function show(text) {
    if (!_config || !_config.is_active) return;
    if (!_el || !document.body.contains(_el)) {
      _el = _buildEl(_config);
      document.body.appendChild(_el);
    }

    // Override text if provided
    if (text) {
      const t = _el.querySelector('.ls-text');
      if (t) t.textContent = text;
    }

    _el.classList.remove('ls-hidden', 'ls-gone');
    clearTimeout(_hideTimer);
  }

  /* ─── Hide loading screen ────────────────────────────────── */
  function hide() {
    if (!_el) return;
    _el.classList.add('ls-hidden');
    _hideTimer = setTimeout(() => {
      if (_el) _el.classList.add('ls-gone');
    }, HIDE_DELAY);
  }

  /* ─── Link interception ──────────────────────────────────── */
  function _interceptLinks() {
    document.addEventListener('click', function (e) {
      if (!_config || !_config.is_active) return;

      const anchor = e.target.closest('a[href]');
      if (!anchor) return;

      const href = anchor.getAttribute('href');
      if (!href) return;

      // Ignore: external, hash-only, javascript:, admin panel links
      const isExternal   = /^https?:\/\//.test(href) && !href.includes(window.location.hostname);
      const isHash       = href.startsWith('#');
      const isJS         = href.startsWith('javascript:');
      const isAdmin      = href.startsWith('/admin');
      const isDownload   = anchor.hasAttribute('download');
      const opensBlank   = anchor.target === '_blank';

      if (isExternal || isHash || isJS || isAdmin || isDownload || opensBlank) return;

      // Show loading and let the browser navigate normally
      show();
    }, true);
  }

  /* ─── Apply config and (re)build element ─────────────────── */
  function _applyConfig(cfg) {
    _config = cfg;
    if (_el && document.body.contains(_el)) {
      const fresh = _buildEl(cfg);
      _el.replaceWith(fresh);
      _el = fresh;
      if (!cfg.is_active) _el.classList.add('ls-gone');
    }
    try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch(_) {}
  }

  /* ─── Fetch config from server ───────────────────────────── */
  async function _fetchConfig() {
    try {
      const res  = await fetch(API_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      if (data.config) _applyConfig(data.config);
    } catch(_) {
      // Use localStorage fallback
      try {
        const cached = localStorage.getItem(LS_KEY);
        if (cached && !_config) _config = JSON.parse(cached);
      } catch(__) {}
    }
  }

  /* ─── Init ───────────────────────────────────────────────── */
  function _init() {
    // Apply cached config immediately
    try {
      const cached = localStorage.getItem(LS_KEY);
      if (cached) _config = JSON.parse(cached);
    } catch(_) {}

    _interceptLinks();

    // Fetch authoritative config from server
    _fetchConfig();

    // Hide on DOMContentLoaded (this page is done loading)
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', hide);
    } else {
      // Already loaded
      hide();
    }
  }

  _init();

  /* ─── Public API ─────────────────────────────────────────── */
  window.LoadingScreen = {
    show,
    hide,
    refresh: _fetchConfig,
    /**
     * Apply a config object directly (for admin live preview).
     */
    preview(cfg) { _applyConfig(cfg); },
  };

})();
