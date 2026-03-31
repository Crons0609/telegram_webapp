/**
 * baseball_api.js — Unified MLB Baseball API Client
 * Uses the proxy /sports/api/baseball/<endpoint>
 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  const CACHE_TTL = 300000; // 5 mins

  const BaseballAPI = {
    _readCache(key) {
      try {
        const raw = sessionStorage.getItem(`mlb_${key}`);
        if (!raw) return null;
        const obj = JSON.parse(raw);
        if (Date.now() - obj.ts > CACHE_TTL) return null;
        return obj.data;
      } catch(_) { return null; }
    },
    
    _writeCache(key, data) {
      try { sessionStorage.setItem(`mlb_${key}`, JSON.stringify({ data, ts: Date.now() })); } catch(_) {}
    },

    async fetchProxy(endpoint, params = {}) {
      const qs = new URLSearchParams(params).toString();
      const path = qs ? `${endpoint}?${qs}` : endpoint;

      const cached = this._readCache(path);
      if (cached) return cached;

      try {
        const res = await fetch(`/sports/api/baseball/${path}`);
        const data = await res.json();
        
        if (data && !data.error && data.status !== 'error') {
          this._writeCache(path, data);
        }
        return data;
      } catch (err) {
        console.warn('[BaseballAPI] Network error:', err);
        return { status: 'error', message: 'Error de conexión' };
      }
    },

    showEmpty(containerId, message) {
      const c = $(containerId);
      if (!c) return;
      c.innerHTML = `
        <div class="sm-empty">
          <div class="sm-empty-icon">⚾</div>
          <p>${message}</p>
        </div>`;
    },

    showLoader(containerId) {
      const c = $(containerId);
      if (!c) return;
      c.innerHTML = `
        <div class="sm-skeleton"><div class="sm-skel-line wide"></div><div class="sm-skel-line medium"></div></div>
        <div class="sm-skeleton"><div class="sm-skel-line wide"></div><div class="sm-skel-line short"></div></div>
      `;
    },

    generateOdds() {
      // Baseball is typically Moneyline (Home vs Away), no Draw.
      const home = (Math.random() * (2.80 - 1.50) + 1.50).toFixed(2);
      const away = (Math.random() * (2.80 - 1.50) + 1.50).toFixed(2);
      return {'1': home, '2': away};
    },

    async loadEvents() {
      const c = $('events-container');
      if (!c) return;
      
      this.showLoader('events-container');
      
      try {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        const gameDate = `${yyyy}${mm}${dd}`;

        let matches = [];
        try {
          const data = await this.fetchProxy('getMLBScoresOnly', { gameDate });
          if (data && data.statusCode === 200 && data.status !== 'error') {
            if (data.body && typeof data.body === 'object') {
              matches = Object.values(data.body);
            }
          } else {
            console.warn('External MLB API returned error status:', data);
          }
        } catch (apiErr) {
          console.warn('Error fetching from external MLB API:', apiErr);
        }

        try {
          const customRes = await fetch('/sports/api/custom_matches/mlb');
          const customData = await customRes.json();
          const finishedRes = await fetch('/sports/api/custom_matches_finished/mlb');
          const finishedData = await finishedRes.json();

          const allCustom = [
            ...(Array.isArray(customData)  ? customData  : []),
            ...(Array.isArray(finishedData) ? finishedData : [])
          ];

          allCustom.forEach(c => {
            const norm = CustomMatchTimer.normalizeCustomMatch(c, 'mlb');
            const effectiveStatus = norm.isFinished ? 'finished' : (norm.isLive ? 'live' : 'upcoming');
            matches.push({
              isCustom:    true,
              gameID:      norm.id,
              home:        norm.home_team,
              away:        norm.away_team,
              gameStatus:  norm.isFinished ? 'Final' : (norm.isLive ? 'Live' : 'Scheduled'),
              gameTime:    norm.buildTime,
              _norm:       norm,
              _effStatus:  effectiveStatus,
              lineScore: norm.score_home != null && norm.score_away != null ? {
                home: { R: norm.score_home },
                away: { R: norm.score_away }
              } : undefined
            });
          });
        } catch(e) { console.error('Error fetching custom baseball matches', e); }

        matches.sort((a,b) => (b.isCustom ? 1 : 0) - (a.isCustom ? 1 : 0));

        if (matches.length === 0) {
          this.showEmpty('events-container', 'No hay partidos de béisbol disponibles en este momento.');
          return;
        }

        let html = '';
        matches.slice(0, 15).forEach(m => {
          const home = m.home || 'Local';
          const away = m.away || 'Visitante';
          const matchId = m.gameID || `${away}_${home}`;
          const norm = m._norm || null;

          // Score formatting
          let gH = m.lineScore?.home?.R;
          let gA = m.lineScore?.away?.R;

          let scoreStr = norm ? norm.scoreStr : 'VS';
          if (!norm && m.gameStatus !== 'Scheduled' && m.gameStatus !== 'Pre-Game') {
            scoreStr = `${gA !== undefined ? gA : '0'} - ${gH !== undefined ? gH : '0'}`;
          }

          const isLive     = !norm && (String(m.gameStatus).toLowerCase().includes('live') || String(m.gameStatus).toLowerCase().includes('in progress'));
          const isFinished = norm ? norm.isFinished : (String(m.gameStatus).toLowerCase().includes('completed') || String(m.gameStatus).toLowerCase().includes('final'));
          // For custom matches, use the effective status computed by the timer
          const dataStatus = (m._effStatus) ? m._effStatus : (isLive ? 'live' : (isFinished ? 'finished' : 'upcoming'));

          let displayTime;
          if (norm) {
            displayTime = norm.timeDisplay;
          } else if (isLive) {
            const description = m.currentInning || m.gameStatus || '';
            displayTime = `<span style="color:#ef4444;font-weight:bold;">🔴 EN VIVO ${description}</span>`;
          } else if (isFinished) {
            displayTime = `<span style="color:rgba(255,255,255,0.5);">FINALIZADO</span>`;
          } else {
            const dateStr = m.gameTime_epoch ? new Date(parseFloat(m.gameTime_epoch) * 1000).toLocaleString('es-MX', {day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'}) : (m.gameTime || 'Próximamente');
            displayTime = dateStr;
          }

          const homeLogo  = (!m.isCustom) ? `https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/${home.toLowerCase()}.png` : '';
          const awayLogo  = (!m.isCustom) ? `https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/${away.toLowerCase()}.png` : '';
          const homeImgHtml = homeLogo ? `<img src="${homeLogo}" style="height:20px;width:20px;vertical-align:middle;margin-left:5px;" onerror="this.style.display='none'">` : '';
          const awayImgHtml = awayLogo ? `<img src="${awayLogo}" style="height:20px;width:20px;vertical-align:middle;margin-right:5px;" onerror="this.style.display='none'">` : '';
          const displayLeague = norm ? (norm.league || '🔥 EVENTO ESPECIAL') : 'MLB';

          html += `
            <div class="sm-event" data-status="${dataStatus}">
              <div class="sm-event-meta">
                <span class="sm-event-league">${displayLeague}</span>
                <span class="sm-event-time">${displayTime}</span>
              </div>
              <div class="sm-event-matchup">
                <div class="sm-event-team">${awayImgHtml}${away}</div>
                <div class="sm-event-vs">${scoreStr}</div>
                <div class="sm-event-team">${home}${homeImgHtml}</div>
              </div>
              ${!isFinished ? `
              <div class="sm-odds">
                <button class="sm-odd-btn" onclick="openBetSlip('${matchId}', '${away}', '${away} vs ${home}', 1.75)">
                  <span class="sm-odd-label">VISITA (${away})</span>
                  <span class="sm-odd-value">1.75</span>
                </button>
                <button class="sm-odd-btn" onclick="openBetSlip('${matchId}', '${home}', '${away} vs ${home}', 1.75)">
                  <span class="sm-odd-label">LOCAL (${home})</span>
                  <span class="sm-odd-value">1.75</span>
                </button>
              </div>` : ''}
            </div>`;
        });
        
        c.innerHTML = html;
        const countEl = $('event-count');
        if (countEl) countEl.innerText = `${matches.slice(0,15).length} eventos`;

      } catch(err) {
        console.warn('[BaseballAPI] loadEvents error:', err);
        if (window.Telegram && window.Telegram.WebApp) {
           window.Telegram.WebApp.showAlert('Error en Baseball API: ' + err.message);
        }
        this.showEmpty('events-container', 'No se pudieron cargar los datos.');
      }
    }
  };

  // Expose globally
  window.BaseballAPI = BaseballAPI;

  // Initialize
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      BaseballAPI.loadEvents();
    }, 100);
  });

})();
