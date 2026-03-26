/**
 * football_data.js — Football Data API Client
 * Uses the proxy /sports/api/football/<endpoint>
 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  const CACHE_TTL = 300_000; // 5 mins frontend cache

  const FootballAPI = {
    // Basic cache logic
    _readCache(key) {
      try {
        const raw = sessionStorage.getItem(`fb_${key}`);
        if (!raw) return null;
        const obj = JSON.parse(raw);
        if (Date.now() - obj.ts > CACHE_TTL) return null;
        return obj.data;
      } catch(_) { return null; }
    },
    _writeCache(key, data) {
      try { sessionStorage.setItem(`fb_${key}`, JSON.stringify({ data, ts: Date.now() })); } catch(_) {}
    },

    async fetchProxy(endpoint, params = {}) {
      const qs = new URLSearchParams(params).toString();
      const path = qs ? `${endpoint}?${qs}` : endpoint;
      
      const cached = this._readCache(path);
      if (cached) return cached;

      try {
        const res = await fetch(`/sports/api/football/${path}`);
        if (!res.ok) throw new Error('Proxy error');
        const data = await res.json();
        
        if (data && !data.error && data.status !== 'error') {
           this._writeCache(path, data);
        }
        return data;
      } catch (err) {
        console.warn('Football API Error:', err);
        return { error: 'Error de conexión' };
      }
    },

    // UI Renders
    showEmpty(containerId, message) {
      const c = $(containerId);
      if(c) c.innerHTML = `<div class="sm-empty"><div class="sm-empty-icon">⚽</div><p>${message}</p></div>`;
    },

    // ─── 1. FIXTURES ──────────────────────────────────────────────
    async loadFixtures() {
      const c = $('fb-matches-container');
      const loader = $('fb-matches-loader');
      if(c.dataset.loaded) return; // Prevent double load
      
      loader.style.display = 'block';
      c.innerHTML = '';

      // Try fetching matches
      // Assuming a generic endpoint like football-matches-today or football-fixtures.
      // If the API structure differs, this will degrade gracefully or we can parse it.
      const today = new Date().toISOString().split('T')[0];
      const data = await this.fetchProxy('football-get-matches-by-date', { date: today });
      
      loader.style.display = 'none';
      if (data.error || !data.response || data.response.length === 0) {
        // Fallback or empty state
        this.showEmpty('fb-matches-container', 'No hay partidos programados para mostrar ahora mismo.');
      } else {
        // Render fixtures (Assuming a generic structure)
        const matches = data.response.slice(0, 10); // Limit to top 10
        let html = '';
        matches.forEach(m => {
           html += `
             <div class="sm-event">
               <div class="sm-event-meta">
                 <span class="sm-event-league">${m.league?.name || 'Liga'}</span>
                 <span class="sm-event-time">${m.fixture?.status?.short || m.time || 'Próximo'}</span>
               </div>
               <div class="sm-event-matchup">
                 <div class="sm-event-team">${m.teams?.home?.name || 'Local'}</div>
                 <div class="sm-event-vs">${m.goals?.home ?? '-'} : ${m.goals?.away ?? '-'}</div>
                 <div class="sm-event-team">${m.teams?.away?.name || 'Visitante'}</div>
               </div>
             </div>
           `;
        });
        c.innerHTML = html;
        c.dataset.loaded = 'true';
      }
    },

    // ─── 2. STANDINGS ──────────────────────────────────────────────
    async loadStandings() {
      const c = $('fb-standings-body');
      const loader = $('fb-standings-loader');
      if(c.dataset.loaded) return;
      
      loader.style.display = 'block';
      c.innerHTML = '';

      // Popular league ID: 39 (Premier League) or similar depending on the exact API provider
      const data = await this.fetchProxy('football-get-standings', { leagueid: 47 }); // fallback example ID
      
      loader.style.display = 'none';
      if (data.error || !data.response || data.response.length === 0) {
         c.innerHTML = '<tr><td colspan="7" class="sm-empty" style="border:none;">Datos de clasificación no disponibles en este momento.</td></tr>';
      } else {
         try {
           const standings = data.response[0].league.standings[0];
           let html = '';
           standings.slice(0, 10).forEach(row => {
             html += `
               <tr>
                 <td><strong>${row.rank}</strong></td>
                 <td>
                   <div class="fb-team-row">
                     ${row.team.logo ? `<img src="${row.team.logo}" class="fb-team-logo" loading="lazy">` : ''}
                     ${row.team.name}
                   </div>
                 </td>
                 <td>${row.all.played}</td>
                 <td>${row.all.win}</td>
                 <td>${row.all.draw}</td>
                 <td>${row.all.lose}</td>
                 <td><strong>${row.points}</strong></td>
               </tr>
             `;
           });
           c.innerHTML = html;
           c.dataset.loaded = 'true';
         } catch(e) {
           c.innerHTML = '<tr><td colspan="7" class="sm-empty" style="border:none;">Error al procesar la clasificación.</td></tr>';
         }
      }
    },

    // ─── 3. PLAYERS SEARCH ─────────────────────────────────────────
    async searchPlayers() {
      const input = $('fb-search-input');
      const term = input.value.trim();
      if (!term) return;

      const c = $('fb-players-container');
      const loader = $('fb-players-loader');
      
      loader.style.display = 'block';
      c.innerHTML = '';

      // Endpoint from the image: football-players-search?search=m
      const data = await this.fetchProxy('football-players-search', { search: term });
      
      loader.style.display = 'none';
      if (data.error || !data.response || data.response.length === 0) {
         this.showEmpty('fb-players-container', `No se encontraron jugadores para "${term}".`);
      } else {
         let html = '';
         const players = Array.isArray(data.response) ? data.response.slice(0, 10) : [];
         players.forEach(pData => {
            const p = pData.player;
            const s = pData.statistics?.[0] || {};
            html += `
              <div class="sm-event" style="display:flex; gap:16px; align-items:center;">
                ${p.photo ? `<img src="${p.photo}" style="width:50px; height:50px; border-radius:50%; object-fit:cover;">` : '<div style="width:50px; height:50px; border-radius:50%; background:rgba(255,255,255,.1);"></div>'}
                <div style="flex:1;">
                  <div style="font-weight:700; font-size:.9rem; margin-bottom:4px;">${p.name}</div>
                  <div style="font-size:.75rem; color:rgba(255,255,255,.5);">
                    ${p.age ? p.age + ' años ' : ''}· ${p.nationality} <br>
                    <strong>Equipo:</strong> ${s.team?.name || 'N/A'}
                  </div>
                </div>
              </div>
            `;
         });
         c.innerHTML = html;
      }
    }
  };

  // Expose globally
  window.FootballAPI = FootballAPI;

})();
