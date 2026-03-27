/**
 * nfl_api.js — NFL API Data Client
 * Uses the proxy /sports/api/nfl/<endpoint>
 * API: nfl-api-data.p.rapidapi.com
 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  const CACHE_TTL = 300000; // 5 mins

  const NFLAPI = {
    _readCache(key) {
      try {
        const raw = sessionStorage.getItem(`nfl_${key}`);
        if (!raw) return null;
        const obj = JSON.parse(raw);
        if (Date.now() - obj.ts > CACHE_TTL) return null;
        return obj.data;
      } catch(_) { return null; }
    },

    _writeCache(key, data) {
      try { sessionStorage.setItem(`nfl_${key}`, JSON.stringify({ data, ts: Date.now() })); } catch(_) {}
    },

    async fetchProxy(endpoint, params = {}) {
      const qs = new URLSearchParams(params).toString();
      const path = qs ? `${endpoint}?${qs}` : endpoint;

      const cached = this._readCache(path);
      if (cached) return cached;

      try {
        const res = await fetch(`/sports/api/nfl/${path}`);
        const data = await res.json();
        if (data && !data.error && data.status !== 'error') {
          this._writeCache(path, data);
        }
        return data;
      } catch (err) {
        console.warn('[NFLAPI] Network error:', err);
        return { status: 'error', message: 'Error de conexión' };
      }
    },

    showEmpty(containerId, message) {
      const c = $(containerId);
      if (!c) return;
      c.innerHTML = `
        <div class="sm-empty">
          <div class="sm-empty-icon">🏈</div>
          <p>${message}</p>
        </div>`;
    },

    showLoader(containerId) {
      const c = $(containerId);
      if (!c) return;
      c.innerHTML = `
        <div class="sm-skeleton"><div class="sm-skel-line wide"></div><div class="sm-skel-line medium"></div></div>
        <div class="sm-skeleton"><div class="sm-skel-line wide"></div><div class="sm-skel-line short"></div></div>
        <div class="sm-skeleton"><div class="sm-skel-line wide"></div><div class="sm-skel-line medium"></div></div>
      `;
    },

    generateOdds() {
      const home = (Math.random() * (2.80 - 1.50) + 1.50).toFixed(2);
      const away = (Math.random() * (2.80 - 1.50) + 1.50).toFixed(2);
      return { '1': home, '2': away };
    },

    /**
     * Map game object from NFL API Data.
     * The API returns a list under `body` or `events`, each game having:
     *   gameID, away, home, gameStatus, currentQuarter, lineScore, gameTime_epoch
     * We handle multiple possible shapes gracefully.
     */
    _parseGame(m) {
      const home = m.home || m.homeTeam?.abbrev || m.homeTeam?.name || 'Local';
      const away = m.away || m.awayTeam?.abbrev || m.awayTeam?.name || 'Visitante';
      const gameId = m.gameID || m.id || `${away}@${home}`;

      // Scores
      const homeR = m.lineScore?.home?.score ?? m.homeScore ?? m.score?.home ?? null;
      const awayR = m.lineScore?.away?.score ?? m.awayScore ?? m.score?.away ?? null;

      const status = String(m.gameStatus || m.status || '').toLowerCase();
      const isLive = status.includes('live') || status.includes('progress') || status.includes('q1') ||
                     status.includes('q2') || status.includes('q3') || status.includes('q4') || status.includes('ot');
      const isFinished = status.includes('completed') || status.includes('final') || status.includes('finished');

      let scoreStr = 'VS';
      if ((isLive || isFinished) && homeR !== null && awayR !== null) {
        scoreStr = `${awayR} - ${homeR}`;
      }

      const quarter = m.currentQuarter || m.quarter || '';
      const clock   = m.gameClock || m.clock || '';
      const liveLabel = [quarter, clock].filter(Boolean).join(' ');

      let displayTime;
      if (isLive) {
        displayTime = `<span style="color:#ef4444;font-weight:bold;">🔴 EN VIVO${liveLabel ? ' — ' + liveLabel : ''}</span>`;
      } else if (isFinished) {
        displayTime = `<span style="color:rgba(255,255,255,0.5);">FINALIZADO</span>`;
      } else {
        // Scheduled
        const epoch = m.gameTime_epoch ? parseFloat(m.gameTime_epoch) * 1000 : null;
        const gameTime = m.gameTime || '';
        displayTime = epoch
          ? new Date(epoch).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
          : (gameTime || 'Próximamente');
      }

      return { home, away, gameId, scoreStr, displayTime, isFinished };
    },

    async loadEvents() {
      const c = $('events-container');
      if (!c) return;

      this.showLoader('events-container');

      try {
        // Try scoreboard first; fall back to live-scores
        let data = await this.fetchProxy('getNFLScoreboard');

        // If we get a not-subscribed or error, try alternate endpoint
        if (!data || data.status === 'error' || data.statusCode === 401 || data.statusCode === 403) {
          data = await this.fetchProxy('getLiveScores');
        }

        if (!data || data.status === 'error') {
          throw new Error(data?.message || 'No se recibió respuesta de la API de NFL.');
        }

        // Accept body as array OR object
        let matches = [];
        if (Array.isArray(data.body)) {
          matches = data.body;
        } else if (data.body && typeof data.body === 'object') {
          matches = Object.values(data.body);
        } else if (Array.isArray(data.events)) {
          matches = data.events;
        } else if (Array.isArray(data.games)) {
          matches = data.games;
        }

        if (matches.length === 0) {
          this.showEmpty('events-container', 'No hay partidos de NFL disponibles en este momento. La temporada regular es de septiembre a enero.');
          return;
        }

        let html = '';
        matches.slice(0, 15).forEach(m => {
          const { home, away, gameId, scoreStr, displayTime, isFinished } = this._parseGame(m);

          const homeLogo = `https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/${home.toLowerCase()}.png`;
          const awayLogo = `https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/${away.toLowerCase()}.png`;

          const homeImgHtml = `<img src="${homeLogo}" style="height:20px;width:20px;vertical-align:middle;margin-left:5px;" onerror="this.style.display='none'">`;
          const awayImgHtml = `<img src="${awayLogo}" style="height:20px;width:20px;vertical-align:middle;margin-right:5px;" onerror="this.style.display='none'">`;

          const odds = this.generateOdds();

          html += `
            <div class="sm-event" data-status="${isFinished ? 'finished' : (String(m.gameStatus || '').toLowerCase().includes('live') ? 'live' : 'upcoming')}">
              <div class="sm-event-meta">
                <span class="sm-event-league">NFL</span>
                <span class="sm-event-time">${displayTime}</span>
              </div>
              <div class="sm-event-matchup">
                <div class="sm-event-team">${awayImgHtml}${away}</div>
                <div class="sm-event-vs">${scoreStr}</div>
                <div class="sm-event-team">${home}${homeImgHtml}</div>
              </div>
              ${!isFinished ? `
              <div class="sm-odds">
                <button class="sm-odd-btn" onclick="openBetSlip('${gameId}', '${away}', '${away} vs ${home}', ${odds['2']})">
                  <span class="sm-odd-label">VISITA (${away})</span>
                  <span class="sm-odd-value">${odds['2']}</span>
                </button>
                <button class="sm-odd-btn" onclick="openBetSlip('${gameId}', '${home}', '${away} vs ${home}', ${odds['1']})">
                  <span class="sm-odd-label">LOCAL (${home})</span>
                  <span class="sm-odd-value">${odds['1']}</span>
                </button>
              </div>` : ''}
            </div>`;
        });

        c.innerHTML = html;
        const countEl = $('event-count');
        if (countEl) countEl.innerText = `${matches.slice(0, 15).length} eventos`;

      } catch (err) {
        console.warn('[NFLAPI] loadEvents error:', err);
        this.showEmpty('events-container', 'No se pudieron cargar los datos de NFL. Verifica la suscripción a la API.');
      }
    }
  };

  window.NFLAPI = NFLAPI;

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => NFLAPI.loadEvents(), 100);
  });

  // Filter support (mirrors baseball/soccer)
  document.addEventListener('DOMContentLoaded', () => {
    document.addEventListener('click', e => {
      const btn = e.target.closest('[data-filter]');
      if (!btn) return;
      document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const filter = btn.dataset.filter;
      document.querySelectorAll('.sm-event').forEach(ev => {
        const status = ev.dataset.status || 'upcoming';
        ev.style.display = (filter === 'all' || filter === status) ? '' : 'none';
      });
    });
  });

})();
