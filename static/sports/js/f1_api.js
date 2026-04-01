/**
 * f1_api.js — Formula 1 via Hyprace API (hyprace-api.p.rapidapi.com)
 * Proxy: /sports/api/f1/<endpoint>
 *
 * Key Hyprace v2 endpoints:
 *   GET /v2/grands-prix?isCurrent=true           → current/next GP calendar
 *   GET /v2/grands-prix?season=YYYY               → full season calendar
 *   GET /v2/drivers?season=YYYY                   → driver list
 *   GET /v2/circuits                              → circuit info
 *
 * Response shape (pagination):
 *   { items: [...], currentPage, totalPages, totalCount }
 *
 * GrandPrix item shape:
 *   { id, round, name, officialName, startDate, endDate, status,
 *     schedule:[{ type, startDate, endDate }], podium:[] }
 *
 * schedule.type values:
 *   FirstPractice, SecondPractice, ThirdPractice,
 *   StandardQualifying, SprintQualifying, SprintRace, MainRace
 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  const CACHE_TTL = 300000; // 5 min

  const SEASON = new Date().getFullYear();

  // ── Country flag helper ──────────────────────────────────
  function countryFlag(alpha2) {
    if (!alpha2) return '';
    return alpha2.toUpperCase().split('').map(c =>
      String.fromCodePoint(c.charCodeAt(0) + 127397)
    ).join('');
  }

  // ── Status labels ────────────────────────────────────────
  const SESSION_LABELS = {
    FirstPractice:     '🔧 P1',
    SecondPractice:    '🔧 P2',
    ThirdPractice:     '🔧 P3',
    StandardQualifying:'⚡ Quali',
    SprintQualifying:  '⚡ Sprint Quali',
    SprintRace:        '🏁 Sprint',
    MainRace:          '🏆 Carrera',
  };

  const F1API = {

    // ── Cache ─────────────────────────────────────────────
    _readCache(key) {
      try {
        const raw = sessionStorage.getItem(`f1_${key}`);
        if (!raw) return null;
        const obj = JSON.parse(raw);
        return Date.now() - obj.ts > CACHE_TTL ? null : obj.data;
      } catch(_) { return null; }
    },
    _writeCache(key, data) {
      try { sessionStorage.setItem(`f1_${key}`, JSON.stringify({ data, ts: Date.now() })); } catch(_) {}
    },

    // ── Proxy fetch ───────────────────────────────────────
    async fetchProxy(endpoint, params = {}) {
      const qs = new URLSearchParams(params).toString();
      const path = qs ? `${endpoint}?${qs}` : endpoint;
      const cached = this._readCache(path);
      if (cached) return cached;
      try {
        const res = await fetch(`/sports/api/f1/${path}`);
        const data = await res.json();
        if (data && data.status !== 'error') this._writeCache(path, data);
        return data;
      } catch(err) {
        console.warn('[F1API] Network error:', err);
        return { status: 'error', message: 'Error de conexión' };
      }
    },

    // ── UI helpers ────────────────────────────────────────
    showEmpty(id, msg) {
      const c = $(id);
      if (c) c.innerHTML = `<div class="sm-empty"><div class="sm-empty-icon">🏎️</div><p>${msg}</p></div>`;
    },
    showLoader(id) {
      const c = $(id);
      if (!c) return;
      c.innerHTML = [1,2,3].map(() => `
        <div class="sm-skeleton">
          <div class="sm-skel-line medium"></div>
          <div class="sm-skel-line wide"></div>
          <div class="sm-skel-line short"></div>
        </div>`).join('');
    },

    // ── Format date string ────────────────────────────────
    _fmtDate(iso) {
      if (!iso) return '—';
      return new Date(iso).toLocaleString('es-MX', {
        weekday: 'short', day: 'numeric', month: 'short',
        hour: '2-digit', minute: '2-digit', timeZone: 'America/Mexico_City'
      });
    },
    _fmtDateShort(iso) {
      if (!iso) return '—';
      return new Date(iso).toLocaleString('es-MX', {
        day: 'numeric', month: 'short', timeZone: 'America/Mexico_City'
      });
    },

    // ── Determine GP status label ─────────────────────────
    _gpStatus(gp) {
      const now = Date.now();
      const start = new Date(gp.startDate).getTime();
      const end   = new Date(gp.endDate).getTime();
      if (now >= start && now <= end)  return { label: '🔴 EN CURSO', cls: 'live' };
      if (now < start)                 return { label: `📅 ${this._fmtDateShort(gp.startDate)}`, cls: 'upcoming' };
      return { label: '✅ Finalizado', cls: 'finished' };
    },

    // ── Render next GP sessions ───────────────────────────
    _renderSchedule(schedule) {
      if (!Array.isArray(schedule) || schedule.length === 0) return '';
      const sorted = [...schedule].sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
      return `
        <div class="f1-schedule">
          ${sorted.map(s => {
            const label = SESSION_LABELS[s.type] || s.type;
            return `<div class="f1-session">
              <span class="f1-session-type">${label}</span>
              <span class="f1-session-time">${this._fmtDate(s.startDate)}</span>
            </div>`;
          }).join('')}
        </div>`;
    },

    // ── 1. MAIN VIEW: Full season calendar ───────────────
    async loadEvents() {
      const c = $('events-container');
      if (!c) return;
      this.showLoader('events-container');

      try {
        // Always fetch full season so all GPs are visible
        let data = await this.fetchProxy('v2/grands-prix', { season: SEASON, pageSize: 30 });
        let items = data?.items || [];

        if (items.length === 0) {
          data = await this.fetchProxy('v2/grands-prix', { season: SEASON - 1, pageSize: 30 });
          items = data?.items || [];
        }

        if (items.length === 0) {
          this.showEmpty('events-container', 'No hay Grandes Premios disponibles en este momento.');
          return;
        }

        let html = '';
        items.forEach(gp => {
          const { label, cls } = this._gpStatus(gp);
          const scheduleHtml = this._renderSchedule(gp.schedule);

          // Podium display
          let podiumHtml = '';
          if (Array.isArray(gp.podium) && gp.podium.length > 0) {
            const medals = ['🥇', '🥈', '🥉'];
            podiumHtml = `<div class="f1-podium">
              ${gp.podium.slice(0,3).map((p,i) => `
                <div class="f1-podium-item">
                  <span class="f1-podium-medal">${medals[i]}</span>
                  <span>${p.driver?.lastName || p.driverName || p.name || '—'}</span>
                </div>`).join('')}
            </div>`;
          }

          html += `
            <div class="sm-event f1-gp-card" data-status="${cls}">
              <div class="sm-event-meta">
                <span class="sm-event-league">🏎️ FÓRMULA 1</span>
                <span class="sm-event-time">${label}</span>
              </div>
              <div class="f1-gp-header">
                <div class="f1-gp-round">Ronda ${gp.round || '—'}</div>
                <div class="f1-gp-name">${gp.name || gp.officialName || 'Grand Prix'}</div>
                ${gp.officialName && gp.name !== gp.officialName
                  ? `<div class="f1-gp-official">${gp.officialName}</div>` : ''}
              </div>
              ${podiumHtml}
              ${scheduleHtml}
              ${cls !== 'finished' ? `
              <div class="sm-odds" style="margin-top:14px;">
                <button class="sm-odd-btn" onclick="openBetSlip('${gp.id || gp.round}','Top 3 (Podio)','GP ${gp.name || gp.officialName}', 1.75)">
                  <span class="sm-odd-label">🌟 Mi Piloto al Podio</span><span class="sm-odd-value">1.75</span>
                </button>
                <button class="sm-odd-btn" onclick="openBetSlip('${gp.id || gp.round}','Ganador (P1)','GP ${gp.name || gp.officialName}', 1.75)">
                  <span class="sm-odd-label">🏆 Mi Piloto Ganador</span><span class="sm-odd-value">1.75</span>
                </button>
              </div>` : ''}
            </div>`;
        });

        c.innerHTML = html;
        const countEl = $('event-count');
        if (countEl) countEl.innerText = `${items.length} GPs`;

      } catch(err) {
        console.warn('[F1API] loadEvents error:', err);
        this.showEmpty('events-container', 'Error cargando el calendario de F1: ' + err.message);
      }
    },

    // ── 2 & 3: Removed (API endpoints deprecated by provider) ──
    async loadStandings() {
      const c = $('fb-standings-body');
      if (!c) return;
      c.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:rgba(255,255,255,.4);">Cargando clasificación...</td></tr>';

      try {
        // Try driver standings via Hyprace
        const data = await this.fetchProxy('v2/standings', { season: SEASON, type: 'driver' });
        const items = data?.items || [];

        if (items.length === 0) {
          c.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:rgba(255,255,255,.3);">No hay datos de clasificación disponibles.</td></tr>';
          return;
        }

        let html = '';
        items.slice(0, 20).forEach((row, i) => {
          const pos    = row.position ?? (i + 1);
          const driver = row.driver || row;
          const name   = `${driver.firstName || ''} ${driver.lastName || driver.name || ''}`.trim() || 'Piloto';
          const flag   = countryFlag(driver.country?.alphaTwoCode || '');
          const team   = row.constructorName || row.team?.name || row.constructor?.name || '—';
          const pts    = row.points ?? '—';
          const wins   = row.wins ?? '—';

          html += `
            <tr>
              <td><strong>${pos}</strong></td>
              <td>${flag} ${name}</td>
              <td>${team}</td>
              <td>${wins}</td>
              <td><strong>${pts}</strong></td>
            </tr>`;
        });

        c.innerHTML = html;

      } catch(err) {
        console.warn('[F1API] loadStandings error:', err);
        c.innerHTML = `<tr><td colspan="5" style="text-align:center;color:rgba(255,255,255,.3);">No se pudo cargar la clasificación.</td></tr>`;
      }
    },

    // ── 3. DRIVER SEARCH ─────────────────────────────────
    async searchDrivers() {
      const input = $('fb-search-input');
      if (!input) return;
      const term = input.value.trim().toLowerCase();
      if (!term) return;
      const c = $('fb-players-container');
      if (!c) return;
      this.showLoader('fb-players-container');

      try {
        const data = await this.fetchProxy('v2/drivers', { pageSize: 50 });
        const all  = data?.items || [];

        const filtered = all.filter(d => {
          const full = `${d.firstName} ${d.lastName}`.toLowerCase();
          return full.includes(term) || (d.tla && d.tla.toLowerCase().includes(term));
        });

        if (filtered.length === 0) {
          this.showEmpty('fb-players-container', `No se encontraron pilotos para "${term}"`);
          return;
        }

        let html = '';
        filtered.slice(0, 10).forEach(d => {
          const name  = `${d.firstName || ''} ${d.lastName || ''}`.trim();
          const flag  = countryFlag(d.country?.alphaTwoCode || '');
          const num   = d.number ? `<span class="f1-driver-num">#${d.number}</span>` : '';
          const tla   = d.tla ? `<span class="f1-driver-tla">${d.tla}</span>` : '';

          html += `
            <div class="sm-event" style="display:flex;gap:16px;align-items:center;">
              <div class="f1-driver-avatar">${flag || '🏎️'}</div>
              <div style="flex:1;">
                <div style="font-weight:700;font-size:.9rem;margin-bottom:4px;">${name} ${num} ${tla}</div>
                <div style="font-size:.75rem;color:rgba(255,255,255,.5);">${d.country?.name || ''}</div>
              </div>
            </div>`;
        });

        c.innerHTML = html;

      } catch(err) {
        console.warn('[F1API] searchDrivers error:', err);
        this.showEmpty('fb-players-container', 'No se pudo realizar la búsqueda.');
      }
    },

    // ── Filter support ────────────────────────────────────
    initFilters() {
      document.addEventListener('click', e => {
        const btn = e.target.closest('[data-filter]');
        if (!btn) return;
        document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const filter = btn.dataset.filter;
        document.querySelectorAll('#events-container .sm-event').forEach(ev => {
          const s = ev.dataset.status || 'upcoming';
          ev.style.display = (filter === 'all' || filter === s) ? '' : 'none';
        });
      });
    }
  };

  window.F1API = F1API;

  document.addEventListener('DOMContentLoaded', () => {
    F1API.initFilters();
    setTimeout(() => F1API.loadEvents(), 100);
  });

})();
