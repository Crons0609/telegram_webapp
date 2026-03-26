/**
 * THEME MANAGER — Zona Jackpot 777
 * Fetches the active global theme from the server and applies it to the body.
 * Polls every 60s for live updates from the admin panel.
 * Also injects the global loading screen CSS + JS.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'casino_active_theme';
  const POLL_INTERVAL = 60000; // 1 minute
  const API_URL = '/api/themes/active';

  let _currentThemeStr = null;

  /* ─── Inject loading screen assets (CSS + JS) ──────────── */
  (function injectLoadingScreen() {
    // Only inject once, skip on admin panel pages
    if (document.getElementById('casino-ls-css') || window.location.pathname.startsWith('/admin')) return;

    const link = document.createElement('link');
    link.id   = 'casino-ls-css';
    link.rel  = 'stylesheet';
    link.href = '/static/css/loading-screen.css';
    document.head.appendChild(link);

    // IMPORTANT: load async (NOT defer) so the script executes as soon as
    // it downloads — not after DOMContentLoaded. This ensures click interception
    // is active before the user can press any navigation button.
    const script = document.createElement('script');
    script.src   = '/static/js/loading-screen.js';
    script.async = true;
    document.head.appendChild(script);
  })();

  /* ─── Apply theme ─────────────────────────────────────────────── */
  function applyTheme(theme) {
    if (!theme || !theme.slug) return;
    const themeStr = JSON.stringify(theme);
    if (_currentThemeStr === themeStr) return; // no change
    _currentThemeStr = themeStr;

    // Set the body attribute — themes.css handles the rest
    document.body.setAttribute('data-casino-theme', theme.slug);

    // Also apply CSS custom properties for instant color swap in new themes
    const root = document.documentElement;
    if (theme.primary_color)   root.style.setProperty('--theme-primary',   theme.primary_color);
    if (theme.secondary_color) root.style.setProperty('--theme-secondary',  theme.secondary_color);
    if (theme.bg_color)        root.style.setProperty('--theme-bg',         theme.bg_color);
    if (theme.accent_glow)     root.style.setProperty('--theme-glow',       theme.accent_glow);
    if (theme.particles_color) root.style.setProperty('--theme-particles',  theme.particles_color);

    // Advanced fields
    if (theme.background_image) {
        root.style.setProperty('--theme-bg-image', `url('${theme.background_image}')`);
    } else {
        root.style.removeProperty('--theme-bg-image');
    }
    
    if (theme.background_overlay) {
        root.style.setProperty('--theme-bg-overlay', theme.background_overlay);
    } else {
        root.style.removeProperty('--theme-bg-overlay');
    }
    
    if (theme.typography && theme.typography.family) {
        root.style.setProperty('--theme-font-family', theme.typography.family);
    } else {
        root.style.removeProperty('--theme-font-family');
    }
    
    // Animations
    if (theme.animations) {
        document.body.classList.toggle('anim-hearts-active', !!theme.animations.hearts);
        document.body.classList.toggle('anim-snow-active', !!theme.animations.snow);
    } else {
        document.body.classList.remove('anim-hearts-active', 'anim-snow-active');
    }

    // Persist in localStorage for fallback
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(theme)); } catch (_) {}
  }

  /* ─── Apply fallback from localStorage ───────────────────────── */
  function applyFallback() {
    try {
      const cached = localStorage.getItem(STORAGE_KEY);
      if (cached) applyTheme(JSON.parse(cached));
    } catch (_) {}
  }

  /* ─── Fetch active theme from server ─────────────────────────── */
  async function fetchTheme() {
    try {
      const res = await fetch(API_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      if (data.slug) applyTheme(data);
    } catch (_) {
      applyFallback();
    }
  }

  /* ─── Init ────────────────────────────────────────────────────── */
  // Apply stored/fallback theme immediately (before network fetch)
  applyFallback();

  // Then fetch the authoritative server value
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fetchTheme);
  } else {
    fetchTheme();
  }

  // Poll for live updates
  setInterval(fetchTheme, POLL_INTERVAL);

  /* ─── Public API for admin preview ───────────────────────────── */
  window.ThemeManager = {
    /** Force-apply a theme slug immediately (for admin live preview) */
    preview(theme) { _currentThemeStr = null; applyTheme(theme); },
    /** Re-fetch from server */
    refresh: fetchTheme,
    /** Currently active slug */
    get current() { return _currentThemeStr; }
  };

})();
