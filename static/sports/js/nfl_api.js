/**
 * nfl_api.js — NFL API Data Client (nfl-api-data.p.rapidapi.com)
 * Uses the proxy /sports/api/nfl/<endpoint>
 *
 * Fetches from /nfl-events endpoint which returns the standard ESPN NFL JSON shape.
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
        // Check for common error shapes returned by APIs
        if (data && !data.error && data.status !== 'error' && !data.message?.toLowerCase().includes('failed')) {
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
     * Map game object from NFL API Data (/nfl-events endpoint).
     * The API returns ESPN-styled JSON: events[] -> competitions[0] -> competitors[] -> team, score, etc.
     */
    _parseGame(event) {
      const comp = event.competitions?.[0] || {};
      const competitors = comp.competitors || [];
      const homeTeamObj = competitors.find(c => c.homeAway === 'home') || {};
      const awayTeamObj = competitors.find(c => c.homeAway === 'away') || {};

      const home = homeTeamObj.team?.displayName || homeTeamObj.team?.name || 'Local';
      const away = awayTeamObj.team?.displayName || awayTeamObj.team?.name || 'Visitante';
      const homeAbbrev = homeTeamObj.team?.abbreviation || '';
      const awayAbbrev = awayTeamObj.team?.abbreviation || '';
      
      const homeLogo = homeTeamObj.team?.logo || `https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/${homeAbbrev.toLowerCase() || 'nfl'}.png`;
      const awayLogo = awayTeamObj.team?.logo || `https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/${awayAbbrev.toLowerCase() || 'nfl'}.png`;

      const homeScore = homeTeamObj.score || '0';
      const awayScore = awayTeamObj.score || '0';

      const statusInfo = comp.status?.type || {};
      const isFinished = statusInfo.completed || statusInfo.state === 'post';
      const isLive = statusInfo.state === 'in';
      const isUpcoming = statusInfo.state === 'pre' || !statusInfo.state;

      let scoreStr = 'VS';
      if (isLive || isFinished) {
        scoreStr = `${awayScore} - ${homeScore}`;
      }

      const liveLabel = statusInfo.shortDetail || comp.status?.displayClock || '';

      let displayTime;
      if (isLive) {
        displayTime = `<span style="color:#ef4444;font-weight:bold;">🔴 EN VIVO${liveLabel ? ' — ' + liveLabel : ''}</span>`;
      } else if (isFinished) {
        displayTime = `<span style="color:rgba(255,255,255,0.5);">FINALIZADO${liveLabel ? ' (' + liveLabel + ')' : ''}</span>`;
      } else {
        const gameDate = event.date ? new Date(event.date) : null;
        displayTime = gameDate
          ? gameDate.toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
          : (statusInfo.shortDetail || 'Próximamente');
      }

      const dataStatus = isLive ? 'live' : (isFinished ? 'finished' : 'upcoming');
      const gameId = event.id || `${awayAbbrev}@${homeAbbrev}`;

      return { home, away, gameId, scoreStr, displayTime, dataStatus, isFinished, homeLogo, awayLogo };
    },

    async loadEvents() {
      const c = $('events-container');
      if (!c) return;

      this.showLoader('events-container');

      try {
        const currentYear = new Date().getFullYear();
        let data = await this.fetchProxy('nfl-events', { year: currentYear });

        // If the current year's data fails, it might be the offseason before the schedule drops.
        // Try the previous year's schedule as a fallback.
        if (!data || data.error) {
          data = await this.fetchProxy('nfl-events', { year: currentYear - 1 });
        }

        if (!data || data.error || !Array.isArray(data.events)) {
          throw new Error(data?.message || data?.error || 'No se recibió respuesta válida de la API de NFL.');
        }

        let matches = data.events;

        if (matches.length === 0) {
          this.showEmpty('events-container', 'No hay partidos de NFL disponibles en este momento. La temporada regular es de septiembre a enero.');
          return;
        }

        // Sort: Live/Upcoming first, Finished later
        matches.sort((a,b) => {
           let stateA = a.competitions?.[0]?.status?.type?.state === 'post' ? 1 : 0;
           let stateB = b.competitions?.[0]?.status?.type?.state === 'post' ? 1 : 0;
           if (stateA !== stateB) return stateA - stateB;
           return new Date(b.date || 0) - new Date(a.date || 0); // newest first among finished
        });

        let html = '';
        matches.slice(0, 30).forEach(m => {
          const { home, away, gameId, scoreStr, displayTime, dataStatus, isFinished, homeLogo, awayLogo } = this._parseGame(m);

          const homeImgHtml = `<img src="${homeLogo}" style="height:22px;width:22px;vertical-align:middle;margin-left:6px;object-fit:contain;" onerror="this.style.display='none'">`;
          const awayImgHtml = `<img src="${awayLogo}" style="height:22px;width:22px;vertical-align:middle;margin-right:6px;object-fit:contain;" onerror="this.style.display='none'">`;

          const odds = this.generateOdds();

          html += `
            <div class="sm-event" data-status="${dataStatus}">
              <div class="sm-event-meta">
                <span class="sm-event-league">NFL</span>
                <span class="sm-event-time">${displayTime}</span>
              </div>
              <div class="sm-event-matchup">
                <div class="sm-event-team" style="text-align:right;">${awayImgHtml}${away}</div>
                <div class="sm-event-vs">${scoreStr}</div>
                <div class="sm-event-team" style="text-align:left;">${home}${homeImgHtml}</div>
              </div>
              ${!isFinished ? `
              <div class="sm-odds">
                <button class="sm-odd-btn" onclick="openBetSlip('${gameId}', '${away}', '${away} vs ${home}', 1.75)">
                  <span class="sm-odd-label">VISITA (${away})</span>
                  <span class="sm-odd-value">1.75</span>
                </button>
                <button class="sm-odd-btn" onclick="openBetSlip('${gameId}', '${home}', '${away} vs ${home}', 1.75)">
                  <span class="sm-odd-label">LOCAL (${home})</span>
                  <span class="sm-odd-value">1.75</span>
                </button>
              </div>` : ''}
            </div>`;
        });

        c.innerHTML = html;
        const countEl = $('event-count');
        if (countEl) countEl.innerText = `${matches.length} eventos`;

      } catch (err) {
        console.warn('[NFLAPI] loadEvents error:', err);
        this.showEmpty('events-container', 'No se pudieron cargar los datos de NFL. Verifica tu suscripción a la API. ' + err.message);
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
