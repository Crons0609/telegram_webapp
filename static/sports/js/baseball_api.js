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

        const data = await this.fetchProxy('getMLBScoresOnly', { gameDate });
        
        if (!data || data.statusCode !== 200 || data.status === 'error') throw new Error(data?.message || 'API error');
        
        let matches = [];
        if (data.body && typeof data.body === 'object') {
          matches = Object.values(data.body);
        }

        if (matches.length === 0) {
          this.showEmpty('events-container', 'No hay partidos de béisbol disponibles en este momento.');
          return;
        }

        let html = '';
        matches.slice(0, 15).forEach(m => {
          const home = m.home || 'Local';
          const away = m.away || 'Visitante';
          const homeLogo = `https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/${home.toLowerCase()}.png`;
          const awayLogo = `https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/${away.toLowerCase()}.png`;
          const matchId = m.gameID || `${away}_${home}`;

          // Score formatting
          let gH = m.lineScore?.home?.R;
          let gA = m.lineScore?.away?.R;

          let scoreStr = 'VS';
          if (m.gameStatus !== 'Scheduled' && m.gameStatus !== 'Pre-Game') {
            scoreStr = `${gA !== undefined ? gA : '0'} - ${gH !== undefined ? gH : '0'}`;
          }

          const description = m.currentInning || m.gameStatus || 'Próximamente';
          const isLive = String(m.gameStatus).toLowerCase().includes('live') || String(m.gameStatus).toLowerCase().includes('in progress');
          const isFinished = String(m.gameStatus).toLowerCase().includes('completed') || String(m.gameStatus).toLowerCase().includes('final');

          const dateStr = m.gameTime_epoch ? new Date(parseFloat(m.gameTime_epoch) * 1000).toLocaleString('es-MX', {day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'}) : m.gameTime;

          const displayTime = isLive 
              ? `<span style="color:#ef4444;font-weight:bold;">🔴 EN VIVO ${description}</span>` 
              : (isFinished ? `<span style="color:rgba(255,255,255,0.5);">FINALIZADO</span>` : (dateStr ? dateStr : description));
          
          const odds = this.generateOdds();
          
          const homeImgHtml = homeLogo ? `<img src="${homeLogo}" style="height:20px;width:20px;vertical-align:middle;margin-left:5px;" onerror="this.style.display='none'">` : '';
          const awayImgHtml = awayLogo ? `<img src="${awayLogo}" style="height:20px;width:20px;vertical-align:middle;margin-right:5px;" onerror="this.style.display='none'">` : '';

          html += `
            <div class="sm-event" data-status="${isLive ? 'live' : (isFinished ? 'finished' : 'upcoming')}">
              <div class="sm-event-meta">
                <span class="sm-event-league">MLB</span>
                <span class="sm-event-time">${displayTime}</span>
              </div>
              <div class="sm-event-matchup">
                <div class="sm-event-team">${awayImgHtml}${away}</div>
                <div class="sm-event-vs">${scoreStr}</div>
                <div class="sm-event-team">${home}${homeImgHtml}</div>
              </div>
              ${!isFinished ? `
              <div class="sm-odds">
                <button class="sm-odd-btn" onclick="openBetSlip('${matchId}', '${away}', '${away} vs ${home}', ${odds['2']})">
                  <span class="sm-odd-label">VISITA (${away})</span>
                  <span class="sm-odd-value">${odds['2']}</span>
                </button>
                <button class="sm-odd-btn" onclick="openBetSlip('${matchId}', '${home}', '${away} vs ${home}', ${odds['1']})">
                  <span class="sm-odd-label">LOCAL (${home})</span>
                  <span class="sm-odd-value">${odds['1']}</span>
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
