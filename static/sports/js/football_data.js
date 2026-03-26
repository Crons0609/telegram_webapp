/**
 * football_data.js — Football Data API Client (Zona Jackpot 777)
 * Uses the proxy /sports/api/football/<endpoint>
 * 
 * Endpoints used (free-api-live-football-data.p.rapidapi.com):
 *   football-get-all-live-matches-by-competition-id  → fixtures (live)
 *   football-get-all-upcoming-matches-by-competition  → fixtures (upcoming)
 *   football-get-standings                            → standings
 *   football-players-search                           → player search
 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  const CACHE_TTL = 300000; // 5 mins frontend cache
  const POPULAR_LEAGUE_ID = 47; // La Liga (common in free tier)

  const FootballAPI = {

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
        console.log(`[FootballAPI] ${endpoint}:`, data);

        if (data && !data.error && data.status !== 'error') {
          this._writeCache(path, data);
        }
        return data;
      } catch (err) {
        console.warn('[FootballAPI] Network error:', err);
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

    _safeTeamName(teams, side) {
      try { return teams[side].name || teams[side].shortName || side; }
      catch(_) { return side === 'home' ? 'Local' : 'Visitante'; }
    },

    _safeLeagueName(item) {
      try { return item.league?.name || item.competition?.name || 'Liga'; }
      catch(_) { return 'Liga'; }
    },

    _safeStatus(item) {
      try {
        return item.fixture?.status?.short
          || item.status?.short
          || item.matchStatus
          || 'NS';
      } catch(_) { return 'NS'; }
    },

    // ── 1. FIXTURES ────────────────────────────────────────────────
    async loadFixtures() {
      const c = $('fb-matches-container');
      if (!c) return;
      if (c.dataset.loaded === 'true') return; // Prevent double-load

      this.showLoader('fb-matches-container');

      let data = null;
      let html = '';

      try {
        // Primary: try live matches endpoint
        data = await this.fetchProxy('football-get-all-live-matches-by-competition-id', {
          compId: POPULAR_LEAGUE_ID
        });

        // Check for subscription/API error
        if (!data || data.status === 'error' || data.error_code) {
          throw new Error(data?.message || 'API error');
        }

        // Normalize response — try multiple possible keys
        const matches = data.response || data.data || data.matches || data.result || [];

        if (!Array.isArray(matches) || matches.length === 0) {
          // Try upcoming matches instead
          data = await this.fetchProxy('football-get-upcoming-matches-by-competition', {
            leagueid: POPULAR_LEAGUE_ID,
            limit: 10
          });
          const upcoming = data?.response || data?.data || data?.matches || data?.result || [];

          if (!Array.isArray(upcoming) || upcoming.length === 0) {
            this.showEmpty('fb-matches-container', 'No hay partidos programados para mostrar ahora mismo.');
            return;
          }

          this._renderMatchCards(upcoming, c);
          c.dataset.loaded = 'true';
          return;
        }

        this._renderMatchCards(matches.slice(0, 12), c);
        c.dataset.loaded = 'true';

      } catch(err) {
        console.warn('[FootballAPI] loadFixtures error:', err);
        this.showEmpty('fb-matches-container', 'No se pudieron cargar los partidos. ' + (err.message || ''));
      }
    },

    _renderMatchCards(matches, container) {
      if (!container) return;
      let html = '';
      matches.forEach(m => {
        try {
          // Support both API-Football format and free-football-api format
          const home = this._safeTeamName(m.teams || m, 'home');
          const away = this._safeTeamName(m.teams || m, 'away');
          const league = this._safeLeagueName(m);
          const status = this._safeStatus(m);
          const goalHome = m.goals?.home ?? m.score?.home ?? m.homeScore ?? null;
          const goalAway = m.goals?.away ?? m.score?.away ?? m.awayScore ?? null;
          const scoreStr = (goalHome !== null && goalAway !== null) ? `${goalHome} : ${goalAway}` : 'VS';
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
        } catch(e) {
          console.warn('[FootballAPI] Error rendering match card:', e, m);
        }
      });

      container.innerHTML = html || '<div class="sm-empty"><p>No se encontraron partidos.</p></div>';
    },

    // ── 2. STANDINGS ────────────────────────────────────────────────
    async loadStandings() {
      const c = $('fb-standings-body');
      if (!c) return;
      if (c.dataset.loaded === 'true') return;

      c.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;color:rgba(255,255,255,.4);">Cargando clasificación...</td></tr>';

      let data = null;

      try {
        data = await this.fetchProxy('football-get-standings', { leagueid: POPULAR_LEAGUE_ID });

        console.log('[FootballAPI] Standings raw:', data);

        if (!data || data.status === 'error' || data.error_code) {
          throw new Error(data?.message || 'API unavailable');
        }

        // Normalize — API-Football wraps in response[0].league.standings[0]
        let standings = null;
        if (data.response && data.response[0]) {
          const leagueData = data.response[0].league || data.response[0];
          standings = leagueData.standings?.[0] || leagueData.standings || data.response;
        } else {
          // Try flat structure
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
        console.warn('[FootballAPI] loadStandings error:', err);
        c.innerHTML = `<tr><td colspan="7" class="sm-empty" style="border:none;">
          No se pudieron cargar los datos de clasificación.<br>
          <small style="opacity:.6;">${err.message || ''}</small>
        </td></tr>`;
      }
    },

    // ── 3. PLAYERS SEARCH ───────────────────────────────────────────
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

        console.log('[FootballAPI] Players search raw:', data);

        if (!data || data.status === 'error' || data.error_code) {
          throw new Error(data?.message || 'API unavailable');
        }

        const players = data.response || data.data || data.players || data.result || [];

        if (!Array.isArray(players) || players.length === 0) {
          this.showEmpty('fb-players-container', `No se encontraron jugadores para "<strong>${term}</strong>".`);
          return;
        }

        let html = '';
        players.slice(0, 10).forEach(pData => {
          try {
            // API-Football wraps player + statistics
            const p = pData.player || pData;
            const stats = Array.isArray(pData.statistics) && pData.statistics.length > 0
              ? pData.statistics[0] : {};

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
          } catch(e) {
            console.warn('[FootballAPI] Error rendering player:', e, pData);
          }
        });

        c.innerHTML = html || `<div class="sm-empty"><p>No se encontraron resultados para "${term}".</p></div>`;

      } catch(err) {
        console.warn('[FootballAPI] searchPlayers error:', err);
        this.showEmpty('fb-players-container',
          `No se pudieron cargar los jugadores. ${err.message || ''}`
        );
      }
    }
  };

  // Expose globally so soccer.html tabs and search button can call it
  window.FootballAPI = FootballAPI;

})();
