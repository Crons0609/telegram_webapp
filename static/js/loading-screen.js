/**
 * loading-screen.js — Zona Jackpot 777
 * v2 — Instant-show, button-aware, defer-safe.
 *
 * KEY FIXES vs v1:
 *  1. Shows overlay IMMEDIATELY on click using a plain DOM overlay, before
 *     config is even fetched (fails-open instead of fails-closed).
 *  2. Intercepts BOTH <a href> AND <button>/<div> elements that trigger
 *     window.location / navigateTo() via onclick attributes.
 *  3. Config fetch uses localStorage as a synchronous first-read so the
 *     element is fully styled before the first click occurs.
 *  4. The script is loaded WITHOUT defer so it fires as soon as it's parsed.
 */
(function () {
  'use strict';

  const LS_KEY     = 'casino_ls_config';
  const API_URL    = '/api/loading-screen/config';
  const HIDE_DELAY = 400; // ms fade-out after page loads

  /* ── Default config (used before server response arrives) ─── */
  const DEFAULT_CONFIG = {
    is_active:  true,
    icon_id:    1,
    bg_color:   '#0a0a1a',
    icon_color: '#f59e0b',
    text_color: 'rgba(255,255,255,0.7)',
    text:       'Cargando...',
    logo_url:   null,
  };

  /* ── Icon HTML map ─────────────────────────────────────────── */
  const ICONS = {
    1:  `<div class="ls-ring"></div>`,
    2:  `<div class="ls-dot"></div><div class="ls-dot"></div><div class="ls-dot"></div>`,
    3:  ``,
    4:  `<div class="ls-ring-a"></div><div class="ls-ring-b"></div>`,
    5:  `<div class="ls-glow"></div>`,
    6:  `<span class="ls-emoji">🎰</span>`,
    7:  `<div class="ls-card">♠</div><div class="ls-card">♥</div><div class="ls-card">♣</div>`,
    8:  `<span class="ls-dice">🎲</span>`,
    9:  `<div class="ls-bar"></div><div class="ls-bar"></div><div class="ls-bar"></div><div class="ls-bar"></div><div class="ls-bar"></div>`,
    10: `<div class="ls-square"></div><div class="ls-square"></div><div class="ls-square"></div><div class="ls-square"></div><div class="ls-square"></div>`,
  };

  /* ── State ──────────────────────────────────────────────────── */
  let _config    = null;   // null until loaded
  let _el        = null;
  let _hideTimer = null;
  let _navPending = false; // prevent double-show

  /* ── Helpers ────────────────────────────────────────────────── */
  function _readCache() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return null;
  }

  function _effectiveConfig() {
    // Returns the best available config, always non-null
    return _config || _readCache() || DEFAULT_CONFIG;
  }

  /* ── Build overlay element ───────────────────────────────────── */
  function _buildEl(cfg) {
    const div = document.createElement('div');
    div.id = 'casino-loading-screen';

    div.style.setProperty('--ls-bg',         cfg.bg_color    || DEFAULT_CONFIG.bg_color);
    div.style.setProperty('--ls-icon-color',  cfg.icon_color  || DEFAULT_CONFIG.icon_color);
    div.style.setProperty('--ls-text-color',  cfg.text_color  || DEFAULT_CONFIG.text_color);

    const iconId = parseInt(cfg.icon_id, 10) || 1;
    const text   = cfg.text || DEFAULT_CONFIG.text;
    const logo   = cfg.logo_url
      ? `<img src="${cfg.logo_url}" class="ls-logo-img" alt="Logo">`
      : `<div class="ls-logo">🎰 ZONA JACKPOT 777</div>`;

    div.innerHTML = `
      ${logo}
      <div class="ls-icon-wrap ls-icon-${iconId}">
        ${ICONS[iconId] || ICONS[1]}
      </div>
      <div class="ls-text">${text}</div>
    `;
    return div;
  }

  /* ── Show: INSTANT, no config guard ─────────────────────────── */
  function show(text) {
    const cfg = _effectiveConfig();
    if (!cfg.is_active) return; // only honour if explicitly disabled

    _navPending = true;
    clearTimeout(_hideTimer);

    if (!_el || !document.body.contains(_el)) {
      _el = _buildEl(cfg);
      document.body.appendChild(_el);
    }

    if (text) {
      const t = _el.querySelector('.ls-text');
      if (t) t.textContent = text;
    }

    // Force a style recalculation before removing the class so the
    // browser actually paints the overlay before doing anything else.
    _el.classList.remove('ls-hidden', 'ls-gone');
    // eslint-disable-next-line no-unused-expressions
    _el.offsetHeight; // <-- trigger reflow / immediate paint
  }

  /* ── Hide ────────────────────────────────────────────────────── */
  function hide() {
    _navPending = false;
    if (!_el) return;
    _el.classList.add('ls-hidden');
    _hideTimer = setTimeout(() => {
      if (_el) _el.classList.add('ls-gone');
    }, HIDE_DELAY);
  }

  /* ── Navigation URL helpers ─────────────────────────────────── */
  function _isInternalUrl(url) {
    if (!url) return false;
    if (url.startsWith('#') || url.startsWith('javascript:')) return false;
    if (url.startsWith('/admin')) return false;
    if (/^https?:\/\//.test(url) && !url.includes(window.location.hostname)) return false;
    return true;
  }

  /* ── navigateTo() shim — overrides the global function ─────── */
  function _patchNavigateTo() {
    // Wrap any existing navigateTo so loading shows first
    const _orig = window.navigateTo;
    window.navigateTo = function (url) {
      if (_isInternalUrl(url)) show();
      if (typeof _orig === 'function') {
        _orig.call(window, url);
      } else {
        window.location.href = url;
      }
    };
  }

  /* ── Intercept ALL clicks (capture phase, highest priority) ── */
  function _interceptClicks() {
    document.addEventListener('click', function (e) {
      const cfg = _effectiveConfig();
      if (!cfg.is_active) return;

      // ── Case 1: <a href> navigation ──────────────────────────
      const anchor = e.target.closest('a[href]');
      if (anchor) {
        const href = anchor.getAttribute('href');
        if (_isInternalUrl(href) && !anchor.target && !anchor.hasAttribute('download')) {
          show();
        }
        return; // handled
      }

      // ── Case 2: button / div with onclick that navigates ─────
      // Check the element and its parents up to 4 levels for onclick
      let el = e.target;
      for (let i = 0; i < 5 && el && el !== document.body; i++) {
        const onclick = el.getAttribute('onclick') || '';
        if (
          onclick.includes('window.location') ||
          onclick.includes('navigateTo') ||
          onclick.includes('location.href') ||
          onclick.includes('location.assign') ||
          onclick.includes('location.replace')
        ) {
          // Validate the destination is internal
          // Extract URL from common patterns
          const urlMatch = onclick.match(/['"`](\/?[^'"`]+)['"`]/);
          const dest = urlMatch ? urlMatch[1] : '/';
          if (_isInternalUrl(dest)) {
            show();
          }
          return;
        }
        el = el.parentElement;
      }
    }, true); // capture phase = fires before onclick handlers
  }

  /* ── Apply config and rebuild element ───────────────────────── */
  function _applyConfig(cfg) {
    _config = cfg;
    if (_el && document.body.contains(_el)) {
      const fresh = _buildEl(cfg);
      _el.replaceWith(fresh);
      _el = fresh;
      if (!cfg.is_active) _el.classList.add('ls-gone');
    }
    try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch (_) {}
  }

  /* ── Fetch config from server (async, non-blocking) ─────────── */
  async function _fetchConfig() {
    try {
      const res  = await fetch(API_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      if (data.config) _applyConfig(data.config);
    } catch (_) {
      // Already using localStorage / DEFAULT_CONFIG — nothing to do
    }
  }

  /* ── Init ────────────────────────────────────────────────────── */
  function _init() {
    // 1. Load cached config synchronously so show() works on first click
    const cached = _readCache();
    if (cached) _config = cached;

    // 2. Patch navigateTo BEFORE any other script might call it
    _patchNavigateTo();

    // 3. Intercept all clicks
    _interceptClicks();

    // 4. Fetch authoritative config in background
    _fetchConfig();

    // 5. Hide overlay when THIS page finishes loading
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', hide);
    } else {
      // Page is already loaded (e.g., script runs late)
      // Short timeout gives the browser a frame to paint first
      setTimeout(hide, 50);
    }

    // Safety net: always hide after 8 seconds (handles stuck states)
    window.addEventListener('load', function () {
      setTimeout(hide, 200);
    });
  }

  _init();

  /* ── Public API ──────────────────────────────────────────────── */
  window.LoadingScreen = {
    show,
    hide,
    refresh: _fetchConfig,
    preview(cfg) { _applyConfig(cfg); },
  };

})();
