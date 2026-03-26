/**
 * soccer_api.js — Unified Football Data API Client
 * Uses the proxy /sports/api/football/<endpoint>
 * Replaces ESPN and all previous RapidAPI integrations.
 */
(function () {
  'use strict';

  window.addEventListener('error', function(e) {
    if (window.Telegram && window.Telegram.WebApp) {
      window.Telegram.WebApp.showAlert('JS Error: ' + e.message + ' at ' + e.filename + ':' + e.lineno);
    }
  });
  window.addEventListener('unhandledrejection', function(e) {
    if (window.Telegram && window.Telegram.WebApp) {
      window.Telegram.WebApp.showAlert('Unhandled Promise: ' + e.reason);
    }
  });

  function $(id) { return document.getElementById(id); }

  const CACHE_TTL = 300000; // 5 mins frontend cache
  const POPULAR_LEAGUE_ID = 47; // La Liga (frequently available in free tier)

  const SoccerAPI = {

    // ── Cache ──────────────────────────────────────────────────────
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

    // ── Generic proxy fetch ────────────────────────────────────────
    async fetchProxy(endpoint, params = {}) {
      const qs = new URLSearchParams(params).toString();
      const path = qs ? `${endpoint}?${qs}` : endpoint;

      const cached = this._readCache(path);
      if (cached) return cached;

      try {
        const res = await fetch(`/sports/api/football/${path}`);
        const data = await res.json();
        console.log(`[SoccerAPI] ${endpoint}:`, data);

        // Save only if successful
        if (data && !data.error && data.status !== 'error') {
          this._writeCache(path, data);
        }
        return data;
      } catch (err) {
        console.warn('[SoccerAPI] Network error:', err);
        return { status: 'error', message: 'Error de conexión' };
      }
    },

    // ── UI helpers ─────────────────────────────────────────────────
    showEmpty(containerId, message) {
      const c = $(containerId);
      if (!c) return;
      c.innerHTML = `
        <div class="sm-empty">
          <div class="sm-empty-icon">⚽</div>
          <p>${message}</p>
        </div>`;
    },

    showLoader(containerId) {
      const c = $(containerId);
      if (!c) return;
      c.innerHTML = `
        <div class="sm-skeleton">
          <div class="sm-skel-line medium"></div>
          <div class="sm-skel-line wide"></div>
          <div class="sm-skel-line short"></div>
        </div>
        <div class="sm-skeleton">
          <div class="sm-skel-line wide"></div>
          <div class="sm-skel-line medium"></div>
        </div>`;
    },

    generateOdds() {
      const home = (Math.random() * (3.80 - 1.50) + 1.50).toFixed(2);
      const draw = (Math.random() * (4.50 - 2.90) + 2.90).toFixed(2);
      const away = (Math.random() * (3.80 - 1.50) + 1.50).toFixed(2);
      return {'1': home, 'X': draw, '2': away};
    },

    extractMatches(data) {
      if (!data) return [];
      const m = data.response || data.data || data.matches || data.result || [];
      return Array.isArray(m) ? m : [];
    },

    safeTeamName(teams, side) {
      try { return teams[side].name || teams[side].shortName || side; }
      catch(_) { return side === 'home' ? 'Local' : 'Visitante'; }
    },

    safeLeagueName(m) {
      try { return m.league?.name || m.competition?.name || 'Liga'; }
      catch(_) { return 'Liga'; }
    },

    safeStatus(m) {
      try {
        return m.fixture?.status?.short || m.status?.short || m.matchStatus || 'NS';
      } catch(_) { return 'NS'; }
    },

    // ── 1. NOTICIAS Y CUOTAS (Previously ESPN) ─────────────────────
    async loadNewsAndOdds() {
      const c = $('events-container');
      if (!c) return;
      if (c.dataset.loaded === 'true') return;
      
      this.showLoader('events-container');
      
      try {
        // Try live first, if empty, try upcoming matches
        let data = await this.fetchProxy('football-get-all-live-matches-by-competition-id', { compId: POPULAR_LEAGUE_ID });
        if (!data || data.status === 'error') throw new Error(data?.message || 'API error');
        
        let matches = this.extractMatches(data);
        if (matches.length === 0) {
          data = await this.fetchProxy('football-get-upcoming-matches-by-competition', { leagueid: POPULAR_LEAGUE_ID, limit: 10 });
          matches = this.extractMatches(data);
        }

        if (matches.length === 0) {
          this.showEmpty('events-container', 'No se pudieron cargar los datos (No hay eventos activos).');
          return;
        }

        let html = '';
        matches.slice(0, 10).forEach(m => {
          const home = this.safeTeamName(m.teams || m, 'home');
          const away = this.safeTeamName(m.teams || m, 'away');
          const league = this.safeLeagueName(m);
          const status = this.safeStatus(m);
          
          const gH = m.goals?.home ?? m.score?.home ?? m.homeScore ?? null;
          const gA = m.goals?.away ?? m.score?.away ?? m.awayScore ?? null;
          const scoreStr = (gH !== null && gA !== null) ? `${gH} - ${gA}` : 'VS';
          
          const isLive = ['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE', 'IN_PLAY'].includes(status);
          const dateStr = m.fixture?.date || m.date || m.matchDate || '';
          
          const displayTime = isLive ? `<span style="color:#ef4444;font-weight:bold;">🔴 EN VIVO ${status}</span>` : 
                                       (dateStr ? new Date(dateStr).toLocaleDateString('es-MX', {day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'}) : 'Próximamente');
          
          const odds = this.generateOdds();

          html += `
            <div class="sm-event" data-status="${isLive ? 'live' : 'upcoming'}">
              <div class="sm-event-meta">
                <span class="sm-event-league">${league}</span>
                <span class="sm-event-time">${displayTime}</span>
              </div>
              <div class="sm-event-headline" style="display:none;"></div>
              <div class="sm-event-matchup">
                <div class="sm-event-team">${home}</div>
                <div class="sm-event-vs">${scoreStr}</div>
                <div class="sm-event-team">${away}</div>
              </div>
              <div class="sm-odds">
                <button class="sm-odd-btn" onclick="openBetSlip('${m.fixture?.id || m.id || Math.random()}', '${home}', '${home} vs ${away}', ${odds['1']})">
                  <span class="sm-odd-label">LOCAL</span>
                  <span class="sm-odd-value">${odds['1']}</span>
                </button>
                <button class="sm-odd-btn" onclick="openBetSlip('${m.fixture?.id || m.id || Math.random()}', 'Empate', '${home} vs ${away}', ${odds['X']})">
                  <span class="sm-odd-label">EMPATE</span>
                  <span class="sm-odd-value">${odds['X']}</span>
                </button>
                <button class="sm-odd-btn" onclick="openBetSlip('${m.fixture?.id || m.id || Math.random()}', '${away}', '${home} vs ${away}', ${odds['2']})">
                  <span class="sm-odd-label">VISITA</span>
                  <span class="sm-odd-value">${odds['2']}</span>
                </button>
              </div>
            </div>`;
        });
        
        c.innerHTML = html;
        c.dataset.loaded = 'true';
        
        const countEl = $('event-count');
        if (countEl) countEl.innerText = `${matches.slice(0,10).length} eventos`;

      } catch(err) {
        console.warn('[SoccerAPI] loadNewsAndOdds error:', err);
        if (window.Telegram && window.Telegram.WebApp) {
           window.Telegram.WebApp.showAlert('Error en Noticias: ' + err.message);
        }
        this.showEmpty('events-container', 'No se pudieron cargar los datos. ' + err.message);
      }
    },

    // ── 2. FIXTURES ────────────────────────────────────────────────
    async loadFixtures() {
      const c = $('fb-matches-container');
      if (!c) return;
      if (c.dataset.loaded === 'true') return;

      this.showLoader('fb-matches-container');

      try {
        let data = await this.fetchProxy('football-get-all-live-matches-by-competition-id', { compId: POPULAR_LEAGUE_ID });
        let matches = this.extractMatches(data);

        if (matches.length === 0) {
          data = await this.fetchProxy('football-get-upcoming-matches-by-competition', { leagueid: POPULAR_LEAGUE_ID, limit: 12 });
          matches = this.extractMatches(data);
        }

        if (matches.length === 0) {
          this.showEmpty('fb-matches-container', 'No se pudieron cargar los datos (No hay fixtures disponibles).');
          return;
        }

        let html = '';
        matches.slice(0, 12).forEach(m => {
          const home = this.safeTeamName(m.teams || m, 'home');
          const away = this.safeTeamName(m.teams || m, 'away');
          const league = this.safeLeagueName(m);
          const status = this.safeStatus(m);
          const gH = m.goals?.home ?? m.score?.home ?? m.homeScore ?? null;
          const gA = m.goals?.away ?? m.score?.away ?? m.awayScore ?? null;
          const scoreStr = (gH !== null && gA !== null) ? `${gH} : ${gA}` : 'VS';
          const isLive = ['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE', 'IN_PLAY'].includes(status);
          const dateStr = m.fixture?.date || m.date || m.matchDate || '';

          html += `
            <div class="sm-event ${isLive ? 'sm-event-live' : ''}">
              <div class="sm-event-meta">
                <span class="sm-event-league">${league}</span>
                <span class="sm-event-time" style="font-size:.7rem;color:rgba(255,255,255,.4);">
                  ${isLive ? '<span class="sp-card-live">🔴 EN VIVO · ' + status + '</span>' : (dateStr ? new Date(dateStr).toLocaleDateString('es-MX', {day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'}) : status)}
                </span>
              </div>
              <div class="sm-event-matchup">
                <div class="sm-event-team">${home}</div>
                <div class="sm-event-vs" style="${isLive ? 'color:#fff;font-size:.9rem;' : ''}">${scoreStr}</div>
                <div class="sm-event-team">${away}</div>
              </div>
            </div>`;
        });

        c.innerHTML = html;
        c.dataset.loaded = 'true';

      } catch(err) {
        console.warn('[SoccerAPI] loadFixtures error:', err);
        this.showEmpty('fb-matches-container', 'No se pudieron cargar los datos.');
      }
    },

    // ── 3. STANDINGS ────────────────────────────────────────────────
    async loadStandings() {
      const c = $('fb-standings-body');
      if (!c) return;
      if (c.dataset.loaded === 'true') return;

      c.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;color:rgba(255,255,255,.4);">Cargando clasificación...</td></tr>';

      try {
        const data = await this.fetchProxy('football-get-standings', { leagueid: POPULAR_LEAGUE_ID });
        
        if (!data || data.status === 'error') throw new Error(data?.message || 'API error');

        let standings = null;
        if (data.response && data.response[0]) {
          const leagueData = data.response[0].league || data.response[0];
          standings = leagueData.standings?.[0] || leagueData.standings || data.response;
        } else {
          standings = data.data || data.standings || data.result || data.response;
        }

        if (!Array.isArray(standings) || standings.length === 0) {
          throw new Error('Datos de clasificación vacíos');
        }

        let html = '';
        standings.slice(0, 15).forEach(row => {
          const team = row.team || row;
          const all  = row.all  || row;
          const rank = row.rank || row.position || '—';
          const name = team.name || row.teamName || 'Equipo';
          const logo = team.logo || team.crest || '';
          const played = all.played ?? row.played ?? row.matchesPlayed ?? '—';
          const won    = all.win   ?? row.won    ?? row.wins  ?? '—';
          const drawn  = all.draw  ?? row.drawn  ?? row.draws ?? '—';
          const lost   = all.lose  ?? row.lost   ?? row.losses ?? '—';
          const pts    = row.points ?? row.pts ?? '—';

          html += `
            <tr>
              <td><strong>${rank}</strong></td>
              <td>
                <div class="fb-team-row">
                  ${logo ? `<img src="${logo}" class="fb-team-logo" loading="lazy" onerror="this.style.display='none'">` : ''}
                  <span>${name}</span>
                </div>
              </td>
              <td>${played}</td>
              <td>${won}</td>
              <td>${drawn}</td>
              <td>${lost}</td>
              <td><strong>${pts}</strong></td>
            </tr>`;
        });

        c.innerHTML = html;
        c.dataset.loaded = 'true';

      } catch(err) {
        console.warn('[SoccerAPI] loadStandings error:', err);
        c.innerHTML = `<tr><td colspan="7" class="sm-empty" style="border:none;">No se pudieron cargar los datos.</td></tr>`;
      }
    },

    // ── 4. PLAYERS SEARCH ───────────────────────────────────────────
    async searchPlayers() {
      const input = $('fb-search-input');
      if (!input) return;
      const term = input.value.trim();
      if (!term) return;

      const c = $('fb-players-container');
      if (!c) return;

      this.showLoader('fb-players-container');

      try {
        const data = await this.fetchProxy('football-players-search', { search: term });
        
        if (!data || data.status === 'error') throw new Error(data?.message || 'API error');

        const players = data.response || data.data || data.players || data.result || [];

        if (!Array.isArray(players) || players.length === 0) {
          this.showEmpty('fb-players-container', `No se pudieron cargar los datos. (No se encontró "${term}")`);
          return;
        }

        let html = '';
        players.slice(0, 10).forEach(pData => {
          const p = pData.player || pData;
          const stats = Array.isArray(pData.statistics) && pData.statistics.length > 0 ? pData.statistics[0] : {};

          const name   = p.name || p.firstname + ' ' + (p.lastname || '') || 'Jugador';
          const photo  = p.photo || p.image || '';
          const age    = p.age   || '';
          const nat    = p.nationality || p.country || '';
          const team   = stats.team?.name || p.club || p.team || 'N/A';
          const pos    = stats.games?.position || p.position || '';

          html += `
            <div class="sm-event" style="display:flex; gap:16px; align-items:center;">
              ${photo
                ? `<img src="${photo}" style="width:52px; height:52px; border-radius:50%; object-fit:cover; flex-shrink:0;" onerror="this.src=''">`
                : `<div style="width:52px; height:52px; border-radius:50%; background:rgba(255,255,255,.1); flex-shrink:0; display:flex; align-items:center; justify-content:center; font-size:1.4rem;">👤</div>`}
              <div style="flex:1; min-width:0;">
                <div style="font-weight:700; font-size:.9rem; margin-bottom:4px;">${name}</div>
                <div style="font-size:.75rem; color:rgba(255,255,255,.5); line-height:1.6;">
                  ${age ? age + ' años' : ''}${age && nat ? ' · ' : ''}${nat}
                  ${pos ? '<br><span style="color:var(--sport-clr,#10b981);">' + pos + '</span>' : ''}
                  <br><strong>Equipo:</strong> ${team}
                </div>
              </div>
            </div>`;
        });

        c.innerHTML = html;

      } catch(err) {
        console.warn('[SoccerAPI] searchPlayers error:', err);
        this.showEmpty('fb-players-container', 'No se pudieron cargar los datos.');
      }
    }
  };

  // Expose globally
  window.FootballAPI = SoccerAPI; 
  window.SoccerAPI = SoccerAPI;

  // Initialize first tab
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      SoccerAPI.loadNewsAndOdds();
    }, 100);
  });

})();
