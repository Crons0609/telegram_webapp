/**
 * espn_sports.js — Zona Jackpot 777
 * Client-side ESPN sports feed handler.
 * Fetches from /sports/api/espn/{source} (our backend proxy — API key stays server-side).
 * Handles rendering, filtering, session-caching and the bet slip.
 */
(function () {
  'use strict';

  const cfg      = window.SPORT_CONFIG || {};
  const SOURCE   = cfg.source  || 'soccer';
  const COLOR    = cfg.color   || '#10b981';
  const EMOJI    = cfg.emoji   || '🏅';
  const NAME     = cfg.name    || 'Deporte';
  const CACHE_KEY = `espn_events_${SOURCE}`;
  const CACHE_TTL = 180000; // 3 min

  let _allEvents = [];
  let _activeFilter = 'all';
  let _betSlip = null; // { eventId, choice, odd, headline }

  /* ─── Utility ────────────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }

  function showToast(msg, type = 'success') {
    const el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = `sm-toast show ${type}`;
    setTimeout(() => { el.className = 'sm-toast'; }, 3000);
  }

  function formatDate(isoStr) {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    } catch(_) { return isoStr.slice(0, 10); }
  }

  /* ─── Session cache ───────────────────────────────────────────── */
  function _readCache() {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (Date.now() - obj.ts > CACHE_TTL) { sessionStorage.removeItem(CACHE_KEY); return null; }
      return obj.data;
    } catch(_) { return null; }
  }

  function _writeCache(data) {
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() })); } catch(_) {}
  }

  /* ─── Fetch from backend proxy ────────────────────────────────── */
  async function fetchEvents() {
    const cached = _readCache();
    if (cached) {
      _allEvents = cached.events || [];
      renderEvents(_allEvents);
      return;
    }

    const proxyUrl = `/sports/api/espn/${SOURCE}`;
    console.log(`[ESPN] Fetching from proxy: ${proxyUrl}`);

    try {
      const res  = await fetch(proxyUrl);
      console.log(`[ESPN] HTTP response: ${res.status}`);
      const data = await res.json();

      // Backend surfaced a real API error
      if (data.error) {
        const code = data.error_code || 0;
        console.warn(`[ESPN] API error (code ${code}):`, data.error);

        if (code === 403) {
          showError(
            '🔒 Acceso denegado por la API deportiva.<br>' +
            '<small>La suscripción a ESPN en RapidAPI no está activa.</small>'
          );
        } else if (code === 429) {
          showError('⏱️ Límite de peticiones alcanzado. Espera un momento y reintenta.');
        } else {
          showError(data.error);
        }
        return;
      }

      _allEvents = data.events || [];
      if (_allEvents.length > 0) _writeCache(data);  // Only cache successful non-empty responses
      renderEvents(_allEvents);
    } catch(err) {
      console.error('[ESPN] Network error:', err);
      showError('No se pudo conectar al servidor. Verifica tu conexión.');
    }
  }

  /* Expose so retry button can call it */
  window._fetchEvents = fetchEvents;


  /* ─── Render helpers ──────────────────────────────────────────── */
  function renderEvents(events) {
    const container = $('events-container');
    if (!container) return;

    const filtered = _activeFilter === 'all'    ? events
                   : _activeFilter === 'live'     ? events.filter(e => e.status === 'live')
                   : /* upcoming */                 events.filter(e => e.status === 'upcoming');

    const countEl = $('event-count');
    if (countEl) countEl.textContent = `${filtered.length} eventos`;

    if (filtered.length === 0) {
      container.innerHTML = _emptyHTML();
      return;
    }

    container.innerHTML = filtered.map(ev => _eventCardHTML(ev)).join('');
  }

  function _eventCardHTML(ev) {
    const liveChip = ev.status === 'live'
      ? `<span class="sp-card-live">LIVE</span>` : '';
    const dateStr = formatDate(ev.published);
    const safeHeadline = ev.headline.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    return `
      <div class="sm-event" id="ev-${ev.id}">
        <div class="sm-event-meta">
          <span class="sm-event-league">${ev.league || NAME}</span>
          <span class="sm-event-time">${dateStr}${liveChip}</span>
        </div>
        <div class="sm-event-matchup">
          <div class="sm-event-team">${ev.team1}</div>
          <div class="sm-event-vs">VS</div>
          <div class="sm-event-team">${ev.team2}</div>
        </div>
        ${safeHeadline && safeHeadline !== ev.team1 + ' at ' + ev.team2
          ? `<p class="sm-event-headline">${safeHeadline}</p>` : ''}
        <div class="sm-odds">
          ${_oddBtn(ev, '1', `${ev.team1.split(' ').slice(-1)[0]}`, ev.odds['1'])}
          ${_oddBtn(ev, 'X', 'Empate', ev.odds['X'])}
          ${_oddBtn(ev, '2', `${ev.team2.split(' ').slice(-1)[0]}`, ev.odds['2'])}
        </div>
      </div>`;
  }

  function _oddBtn(ev, choice, label, odd) {
    const safeLabel = label.replace(/</g, '&lt;');
    return `
      <button class="sm-odd-btn"
              data-event-id="${ev.id}"
              data-choice="${choice}"
              data-odd="${odd}"
              data-headline="${ev.headline.replace(/"/g, '&quot;')}"
              data-team1="${ev.team1.replace(/"/g, '&quot;')}"
              data-team2="${ev.team2.replace(/"/g, '&quot;')}"
              onclick="window._selectOdd(this)">
        <span class="sm-odd-label">${safeLabel}</span>
        <span class="sm-odd-value">${parseFloat(odd).toFixed(2)}</span>
      </button>`;
  }

  function _emptyHTML() {
    return `
      <div class="sm-empty">
        <div class="sm-empty-icon">${EMOJI}</div>
        <h3>No hay eventos disponibles</h3>
        <p>El feed de ${NAME} no tiene eventos en este momento.<br>Intenta más tarde o revisa otro deporte.</p>
      </div>`;
  }

  function showError(msg) {
    const c = $('events-container');
    if (c) c.innerHTML = `
      <div class="sm-empty">
        <div class="sm-empty-icon">⚠️</div>
        <h3>Error al cargar eventos</h3>
        <p>${msg}</p>
        <button class="sm-filter" style="margin-top:16px;" onclick="window._fetchEvents && window._fetchEvents()">🔄 Reintentar</button>
      </div>`;
  }

  /* ─── Odd selection (global for onclick) ──────────────────────── */
  window._selectOdd = function(btn) {
    // Deselect all
    document.querySelectorAll('.sm-odd-btn.selected').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');

    _betSlip = {
      eventId:  btn.dataset.eventId,
      choice:   btn.dataset.choice,
      odd:      parseFloat(btn.dataset.odd),
      headline: btn.dataset.headline,
      team1:    btn.dataset.team1,
      team2:    btn.dataset.team2,
    };

    openBetSlip();
  };

  /* ─── Bet Slip ────────────────────────────────────────────────── */
  function openBetSlip() {
    const el = $('betslip');
    if (!el) return;
    const info = $('betslip-info');
    if (info && _betSlip) {
      const choiceLabel = _betSlip.choice === '1' ? _betSlip.team1
                        : _betSlip.choice === 'X' ? 'Empate'
                        : _betSlip.team2;
      info.innerHTML = `Apostando a: <strong>${choiceLabel}</strong> &nbsp;·&nbsp; Cuota: <strong>${_betSlip.odd.toFixed(2)}</strong>`;
    }
    el.classList.add('open');
    const amtEl = $('bet-amount');
    if (amtEl) amtEl.focus();
  }

  window.closeBetSlip = function() {
    const el = $('betslip');
    if (el) el.classList.remove('open');
    document.querySelectorAll('.sm-odd-btn.selected').forEach(b => b.classList.remove('selected'));
    _betSlip = null;
  };

  window.submitBet = async function() {
    if (!_betSlip) { showToast('Selecciona un resultado primero', 'error'); return; }

    const amtEl = $('bet-amount');
    const amount = parseInt(amtEl?.value, 10);
    if (!amount || amount < 10) { showToast('Mínimo 10 bits', 'error'); return; }

    // Get telegram_id from global session (injected by perfil.js or script.js)
    const telegramId = window.USER_DATA?.telegram_id || window.currentUser?.telegram_id;
    if (!telegramId) { showToast('Debes iniciar sesión primero', 'error'); return; }

    try {
      const res = await fetch('/sports/api/bet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegram_id: telegramId,
          match_id:    _betSlip.eventId,
          team_choice: _betSlip.choice,
          amount,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`✅ ¡Apuesta de ${amount} bits realizada!`, 'success');
        closeBetSlip();
        if (amtEl) amtEl.value = '';
      } else {
        showToast(data.error || 'Error al procesar la apuesta', 'error');
      }
    } catch(_) {
      showToast('Error de red. Intenta de nuevo.', 'error');
    }
  };

  /* ─── Filters ─────────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.sm-filter').forEach(btn => {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.sm-filter').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        _activeFilter = this.dataset.filter || 'all';
        renderEvents(_allEvents);
      });
    });

    fetchEvents();
  });

})();
