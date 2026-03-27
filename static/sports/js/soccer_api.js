/**
 * soccer_api.js — FootApi Client (footapi7.p.rapidapi.com)
 * Uses the backend proxy /sports/api/football/<endpoint>
 *
 * FootApi response shape:
 *   events[]:
 *     m.id                  — eventId
 *     m.homeTeam.id/name    — home team
 *     m.awayTeam.id/name    — away team
 *     m.homeScore.current   — home goals
 *     m.awayScore.current   — away goals
 *     m.status.type         — "notstarted" | "inprogress" | "finished"
 *     m.status.description  — "Not started" | "1st half" | "2nd half" | "Ended" etc.
 *     m.startTimestamp      — Unix epoch
 *     m.tournament.name     — league/tournament name
 *
 * Logo: https://footapi7.p.rapidapi.com/api/team/{teamId}/image
 *   → proxied via /sports/api/football/team/<id>/image
 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  const CACHE_TTL = 300000; // 5 min

  // FootApi unique tournament IDs for popular competitions
  const LEAGUES = [
    { id: 17, seasonId: 61627, name: 'Premier League' },  // 2024/25
    { id: 8,  seasonId: 61643, name: 'La Liga'         },
    { id: 35, seasonId: 61737, name: 'Bundesliga'      },
    { id: 23, seasonId: 61643, name: 'Serie A'         },
    { id: 34, seasonId: 61643, name: 'Ligue 1'         },
  ];

  // ── Team logo helper ─────────────────────────────────────
  function teamLogo(teamId) {
    return teamId ? `/sports/api/football/team/${teamId}/image` : '';
  }

  // ── FootApi logo img tag ─────────────────────────────────
  function logoTag(teamId, side) {
    const style = side === 'home'
      ? 'height:22px;width:22px;vertical-align:middle;margin-left:6px;'
      : 'height:22px;width:22px;vertical-align:middle;margin-right:6px;';
    return teamId
      ? `<img src="${teamLogo(teamId)}" style="${style}border-radius:50%;object-fit:contain;" onerror="this.style.display='none'">`
      : '';
  }

  const SoccerAPI = {

    // ── Cache ─────────────────────────────────────────────
    _readCache(key) {
      try {
        const raw = sessionStorage.getItem(`footapi_${key}`);
        if (!raw) return null;
        const obj = JSON.parse(raw);
        if (Date.now() - obj.ts > CACHE_TTL) return null;
        return obj.data;
      } catch(_) { return null; }
    },
    _writeCache(key, data) {
      try { sessionStorage.setItem(`footapi_${key}`, JSON.stringify({ data, ts: Date.now() })); } catch(_) {}
    },

    // ── Proxy fetch ───────────────────────────────────────
    async fetchProxy(endpoint, params = {}) {
      const qs = new URLSearchParams(params).toString();
      const path = qs ? `${endpoint}?${qs}` : endpoint;
      const cached = this._readCache(path);
      if (cached) return cached;
      try {
        const res = await fetch(`/sports/api/football/${path}`);
        const data = await res.json();
        if (data && data.status !== 'error') this._writeCache(path, data);
        return data;
      } catch(err) {
        console.warn('[FootAPI] Network error:', err);
        return { status: 'error', message: 'Error de conexión' };
      }
    },

    // ── UI helpers ────────────────────────────────────────
    showEmpty(id, msg) {
      const c = $(id);
      if (!c) return;
      c.innerHTML = `<div class="sm-empty"><div class="sm-empty-icon">⚽</div><p>${msg}</p></div>`;
    },
    showLoader(id) {
      const c = $(id);
      if (!c) return;
      c.innerHTML = `
        <div class="sm-skeleton"><div class="sm-skel-line medium"></div><div class="sm-skel-line wide"></div><div class="sm-skel-line short"></div></div>
        <div class="sm-skeleton"><div class="sm-skel-line wide"></div><div class="sm-skel-line medium"></div></div>`;
    },
    generateOdds() {
      return {
        '1': (Math.random() * (3.80 - 1.50) + 1.50).toFixed(2),
        'X': (Math.random() * (4.50 - 2.90) + 2.90).toFixed(2),
        '2': (Math.random() * (3.80 - 1.50) + 1.50).toFixed(2),
      };
    },

    // ── Parse event from FootApi ─────────────────────────
    _parse(m) {
      const home     = m.homeTeam?.name || m.homeTeam?.shortName || 'Local';
      const away     = m.awayTeam?.name || m.awayTeam?.shortName || 'Visitante';
      const homeId   = m.homeTeam?.id;
      const awayId   = m.awayTeam?.id;
      const league   = m.tournament?.name || m.tournament?.uniqueTournament?.name || 'Liga';
      const statusT  = String(m.status?.type || '').toLowerCase();
      const statusD  = m.status?.description || '';
      const isLive   = statusT === 'inprogress';
      const isFinish = statusT === 'finished';
      const gH = m.homeScore?.current ?? null;
      const gA = m.awayScore?.current ?? null;
      const scoreStr = (isLive || isFinish) && gH !== null && gA !== null
        ? `${gH} - ${gA}` : 'VS';

      let displayTime;
      if (isLive) {
        displayTime = `<span style="color:#ef4444;font-weight:bold;">🔴 EN VIVO${statusD ? ' · ' + statusD : ''}</span>`;
      } else if (isFinish) {
        displayTime = `<span style="color:rgba(255,255,255,0.4);">FINALIZADO</span>`;
      } else {
        const ts = m.startTimestamp;
        displayTime = ts
          ? new Date(ts * 1000).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
          : 'Próximamente';
      }
      return { home, away, homeId, awayId, league, scoreStr, displayTime, isLive, isFinish, statusT };
    },

    // ── Render a list of events ───────────────────────────
    _renderEvents(matches, containerId, showOdds = true) {
      const c = $(containerId);
      if (!c) return;
      if (matches.length === 0) { this.showEmpty(containerId, 'No hay eventos disponibles en este momento.'); return; }

      let html = '';
      matches.slice(0, 15).forEach(m => {
        const { home, away, homeId, awayId, league, scoreStr, displayTime, isLive, isFinish, statusT } = this._parse(m);
        const odds = this.generateOdds();
        const matchId = m.id || `${home}_${away}`;
        const dataStatus = isLive ? 'live' : (isFinish ? 'finished' : 'upcoming');

        html += `
          <div class="sm-event" data-status="${dataStatus}">
            <div class="sm-event-meta">
              <span class="sm-event-league">${league}</span>
              <span class="sm-event-time">${displayTime}</span>
            </div>
            <div class="sm-event-matchup">
              <div class="sm-event-team">${logoTag(awayId, 'away')}${away}</div>
              <div class="sm-event-vs">${scoreStr}</div>
              <div class="sm-event-team">${home}${logoTag(homeId, 'home')}</div>
            </div>
            ${showOdds && !isFinish ? `
            <div class="sm-odds">
              <button class="sm-odd-btn" onclick="openBetSlip('${matchId}','${home}','${home} vs ${away}',${odds['1']})">
                <span class="sm-odd-label">LOCAL</span><span class="sm-odd-value">${odds['1']}</span>
              </button>
              <button class="sm-odd-btn" onclick="openBetSlip('${matchId}','Empate','${home} vs ${away}',${odds['X']})">
                <span class="sm-odd-label">EMPATE</span><span class="sm-odd-value">${odds['X']}</span>
              </button>
              <button class="sm-odd-btn" onclick="openBetSlip('${matchId}','${away}','${home} vs ${away}',${odds['2']})">
                <span class="sm-odd-label">VISITA</span><span class="sm-odd-value">${odds['2']}</span>
              </button>
            </div>` : ''}
          </div>`;
      });

      c.innerHTML = html;
      c.dataset.loaded = 'true';
    },

    // ── 1. MAIN EVENTS (live + today's schedule) ─────────
    async loadNewsAndOdds() {
      const c = $('events-container');
      if (!c) return;
      if (c.dataset.loaded === 'true') return;
      this.showLoader('events-container');

      try {
        // 1. Try live matches across all sports
        let data = await this.fetchProxy('api/matches/live');
        let matches = Array.isArray(data?.events) ? data.events : [];

        // 2. If no live matches, fetch today's scheduled matches for top leagues
        if (matches.length === 0) {
          const today = new Date();
          const d = `${today.getFullYear()}/${String(today.getMonth()+1).padStart(2,'0')}/${String(today.getDate()).padStart(2,'0')}`;
          data = await this.fetchProxy(`api/matches/${d}`);
          matches = Array.isArray(data?.events) ? data.events : [];
        }

        // 3. Fallback: last matches from Premier League
        if (matches.length === 0) {
          data = await this.fetchProxy(`api/tournament/${LEAGUES[0].id}/season/${LEAGUES[0].seasonId}/matches/last/0`);
          matches = Array.isArray(data?.events) ? data.events : [];
        }

        if (matches.length === 0) {
          this.showEmpty('events-container', 'No hay partidos disponibles en este momento.');
          return;
        }

        this._renderEvents(matches, 'events-container', true);
        const countEl = $('event-count');
        if (countEl) countEl.innerText = `${Math.min(matches.length, 15)} eventos`;

      } catch(err) {
        console.warn('[FootAPI] loadNewsAndOdds error:', err);
        this.showEmpty('events-container', 'No se pudieron cargar los partidos. ' + err.message);
      }
    },

    // ── 2. FIXTURES ───────────────────────────────────────
    async loadFixtures() {
      const c = $('fb-matches-container');
      if (!c) return;
      if (c.dataset.loaded === 'true') return;
      this.showLoader('fb-matches-container');

      try {
        const today = new Date();
        const d = `${today.getFullYear()}/${String(today.getMonth()+1).padStart(2,'0')}/${String(today.getDate()).padStart(2,'0')}`;
        let data = await this.fetchProxy(`api/matches/${d}`);
        let matches = Array.isArray(data?.events) ? data.events : [];

        if (matches.length === 0) {
          data = await this.fetchProxy(`api/tournament/${LEAGUES[0].id}/season/${LEAGUES[0].seasonId}/matches/last/0`);
          matches = Array.isArray(data?.events) ? data.events : [];
        }

        this._renderEvents(matches, 'fb-matches-container', false);
      } catch(err) {
        console.warn('[FootAPI] loadFixtures error:', err);
        this.showEmpty('fb-matches-container', 'No se pudieron cargar los fixtures.');
      }
    },

    // ── 3. STANDINGS ─────────────────────────────────────
    async loadStandings() {
      const c = $('fb-standings-body');
      if (!c) return;
      if (c.dataset.loaded === 'true') return;
      c.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;color:rgba(255,255,255,.4);">Cargando clasificación...</td></tr>';

      try {
        const lg = LEAGUES[0]; // Premier League default
        const data = await this.fetchProxy(`api/tournament/${lg.id}/season/${lg.seasonId}/standings/total`);

        // FootApi shape: data.standings[0].rows[] with team, points, matches, wins, losses, draws
        const rows = data?.standings?.[0]?.rows || data?.standings || [];

        if (!Array.isArray(rows) || rows.length === 0) throw new Error('Sin datos de clasificación');

        let html = '';
        rows.slice(0, 20).forEach(row => {
          const pos    = row.position ?? '—';
          const team   = row.team;
          const name   = team?.name || team?.shortName || 'Equipo';
          const logo   = team?.id ? teamLogo(team.id) : '';
          const played = row.matches ?? '—';
          const won    = row.wins    ?? '—';
          const drawn  = row.draws   ?? '—';
          const lost   = row.losses  ?? '—';
          const pts    = row.points  ?? '—';

          html += `
            <tr>
              <td><strong>${pos}</strong></td>
              <td>
                <div class="fb-team-row">
                  ${logo ? `<img src="${logo}" class="fb-team-logo" loading="lazy" onerror="this.style.display='none'">` : ''}
                  <span>${name}</span>
                </div>
              </td>
              <td>${played}</td><td>${won}</td><td>${drawn}</td><td>${lost}</td>
              <td><strong>${pts}</strong></td>
            </tr>`;
        });

        c.innerHTML = html;
        c.dataset.loaded = 'true';

      } catch(err) {
        console.warn('[FootAPI] loadStandings error:', err);
        c.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:20px;color:rgba(255,255,255,.3);">No se pudo cargar la clasificación.</td></tr>`;
      }
    },

    // ── 4. PLAYER SEARCH ─────────────────────────────────
    async searchPlayers() {
      const input = $('fb-search-input');
      if (!input) return;
      const term = input.value.trim();
      if (!term) return;
      const c = $('fb-players-container');
      if (!c) return;
      this.showLoader('fb-players-container');

      try {
        // FootApi player search: /api/player/search/{query}
        const data = await this.fetchProxy(`api/player/search/${encodeURIComponent(term)}`);
        const players = data?.players || data?.results || data?.response || [];

        if (!Array.isArray(players) || players.length === 0) {
          this.showEmpty('fb-players-container', `No se encontró "${term}"`);
          return;
        }

        let html = '';
        players.slice(0, 10).forEach(pObj => {
          const p      = pObj.player || pObj;
          const name   = p.name || p.shortName || 'Jugador';
          const team   = p.team?.name || p.teamName || 'N/A';
          const nat    = p.country?.name || p.nationality || '';
          const pos    = p.position || '';
          const photoId = p.id;
          const photoUrl = photoId ? `/sports/api/football/player/${photoId}/image` : '';

          html += `
            <div class="sm-event" style="display:flex;gap:16px;align-items:center;">
              ${photoUrl
                ? `<img src="${photoUrl}" style="width:50px;height:50px;border-radius:50%;object-fit:cover;flex-shrink:0;" onerror="this.src='';this.style.background='rgba(255,255,255,.1)'">`
                : `<div style="width:50px;height:50px;border-radius:50%;background:rgba(255,255,255,.1);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:1.4rem;">👤</div>`}
              <div style="flex:1;min-width:0;">
                <div style="font-weight:700;font-size:.9rem;margin-bottom:4px;">${name}</div>
                <div style="font-size:.75rem;color:rgba(255,255,255,.5);line-height:1.6;">
                  ${nat}${pos ? ' · <span style="color:var(--sport-clr,#10b981);">' + pos + '</span>' : ''}
                  <br><strong>Equipo:</strong> ${team}
                </div>
              </div>
            </div>`;
        });

        c.innerHTML = html;

      } catch(err) {
        console.warn('[FootAPI] searchPlayers error:', err);
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

  window.FootballAPI = SoccerAPI;
  window.SoccerAPI   = SoccerAPI;

  document.addEventListener('DOMContentLoaded', () => {
    SoccerAPI.initFilters();
    setTimeout(() => SoccerAPI.loadNewsAndOdds(), 100);
  });

})();
