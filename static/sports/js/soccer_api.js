/**
 * soccer_api.js — FootApi / Free-API-Live-Football-Data Client
 * Backend proxy: /sports/api/football/<endpoint>
 *
 * Response shape (events[]):
 *   m.homeTeam.id/name, m.awayTeam.id/name
 *   m.homeScore.current, m.awayScore.current
 *   m.status.type  — "notstarted" | "inprogress" | "finished"
 *   m.status.description
 *   m.startTimestamp  — Unix epoch (sec)
 *   m.tournament.name — league/cup name
 *   m.homeTeam.id     — used for logo: /sports/api/football/api/team/{id}/image
 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  const CACHE_TTL = 180000; // 3 min

  // ── Helpers ────────────────────────────────────────────────────────────────

  function fmtDate(d) {
    return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
  }

  function teamLogo(teamId) {
    return teamId ? `/sports/api/football/api/team/${teamId}/image` : '';
  }

  function logoTag(teamId, side) {
    const style = side === 'home'
      ? 'height:22px;width:22px;vertical-align:middle;margin-left:6px;'
      : 'height:22px;width:22px;vertical-align:middle;margin-right:6px;';
    return teamId
      ? `<img src="${teamLogo(teamId)}" style="${style}border-radius:50%;object-fit:contain;" onerror="this.style.display='none'">`
      : '';
  }

  // ── Main API object ────────────────────────────────────────────────────────

  const SoccerAPI = {

    // Cache
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

    // Proxy fetch
    async fetchProxy(endpoint, params = {}) {
      const qs = new URLSearchParams(params).toString();
      const path = qs ? `${endpoint}?${qs}` : endpoint;
      const cached = this._readCache(path);
      if (cached) return cached;
      try {
        const res = await fetch(`/sports/api/football/${path}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data && !data.error && data.status !== 'error') this._writeCache(path, data);
        return data;
      } catch(err) {
        console.warn('[FootAPI] Fetch error:', endpoint, err.message);
        return { status: 'error', message: err.message };
      }
    },

    // UI helpers
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
        <div class="sm-skeleton"><div class="sm-skel-line wide"></div><div class="sm-skel-line medium"></div></div>
        <div class="sm-skeleton"><div class="sm-skel-line short"></div><div class="sm-skel-line wide"></div></div>`;
    },
    generateOdds() {
      return {
        '1': (Math.random() * (3.80 - 1.50) + 1.50).toFixed(2),
        'X': (Math.random() * (4.50 - 2.90) + 2.90).toFixed(2),
        '2': (Math.random() * (3.80 - 1.50) + 1.50).toFixed(2),
      };
    },

    // Parse event
    _parse(m) {
      const home    = m.homeTeam?.name || m.homeTeam?.shortName || 'Local';
      const away    = m.awayTeam?.name || m.awayTeam?.shortName || 'Visitante';
      const homeId  = m.homeTeam?.id;
      const awayId  = m.awayTeam?.id;
      const league  = m.tournament?.name || m.tournament?.uniqueTournament?.name || 'Liga';
      const statusT = String(m.status?.type || '').toLowerCase();
      const statusD = m.status?.description || '';
      const isLive  = statusT === 'inprogress';
      const isFinish= statusT === 'finished';
      const gH = m.homeScore?.current ?? null;
      const gA = m.awayScore?.current ?? null;
      const scoreStr = (isLive || isFinish) && gH !== null && gA !== null
        ? `${gH} - ${gA}` : 'VS';

      let displayTime;
      if (isLive) {
        displayTime = `<span style="color:#ef4444;font-weight:bold;">🔴 EN VIVO${statusD ? ' · ' + statusD : ''}</span>`;
      } else if (isFinish) {
        displayTime = `<span style="color:rgba(255,255,255,0.4);">FINALIZADO (${statusD || 'Final'})</span>`;
      } else {
        const ts = m.startTimestamp;
        displayTime = ts
          ? new Date(ts * 1000).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
          : 'Próximamente';
      }
      return { home, away, homeId, awayId, league, scoreStr, displayTime, isLive, isFinish };
    },

    // Render events
    _renderEvents(matches, containerId, showOdds = true) {
      const c = $(containerId);
      if (!c) return;
      if (!matches || matches.length === 0) {
        this.showEmpty(containerId, 'No hay eventos disponibles en este momento.');
        return;
      }

      let html = '';
      matches.slice(0, 30).forEach(m => {
        const { home, away, homeId, awayId, league, scoreStr, displayTime, isLive, isFinish } = this._parse(m);
        const odds = this.generateOdds();
        const matchId = m.id || `${home}_${away}_${Date.now()}`;
        const dataStatus = isLive ? 'live' : (isFinish ? 'finished' : 'upcoming');

        html += `
          <div class="sm-event" data-status="${dataStatus}">
            <div style="cursor:pointer;" onclick="SoccerMatchDetails.open('${m.id}','${home}','${away}')">
              <div class="sm-event-meta">
                <span class="sm-event-league">${league}</span>
                <span class="sm-event-time">${displayTime}</span>
              </div>
              <div class="sm-event-matchup">
                <div class="sm-event-team">${logoTag(awayId, 'away')}${away}</div>
                <div class="sm-event-vs">${scoreStr}</div>
                <div class="sm-event-team">${home}${logoTag(homeId, 'home')}</div>
              </div>
            </div>
            ${showOdds && !isFinish ? `
            <div class="sm-odds">
              <button class="sm-odd-btn" onclick="openBetSlip('${matchId}','${away}','${home} vs ${away}',${odds['2']})">
                <span class="sm-odd-label">VISITA</span><span class="sm-odd-value">${odds['2']}</span>
              </button>
              <button class="sm-odd-btn" onclick="openBetSlip('${matchId}','Empate','${home} vs ${away}',${odds['X']})">
                <span class="sm-odd-label">EMPATE</span><span class="sm-odd-value">${odds['X']}</span>
              </button>
              <button class="sm-odd-btn" onclick="openBetSlip('${matchId}','${home}','${home} vs ${away}',${odds['1']})">
                <span class="sm-odd-label">LOCAL</span><span class="sm-odd-value">${odds['1']}</span>
              </button>
            </div>` : ''}
          </div>`;
      });

      c.innerHTML = html;
    },

    // ── Fetch matches for a given date string "YYYY/MM/DD" ────────────────────
    async _fetchMatchesByDate(dateStr) {
      const data = await this.fetchProxy(`api/matches/${dateStr}`);
      return Array.isArray(data?.events) ? data.events : [];
    },

    // ── 1. MAIN EVENT LOADER ─────────────────────────────────────────────────
    async loadNewsAndOdds() {
      const c = $('events-container');
      if (!c) return;
      this.showLoader('events-container');

      try {
        let matches = [];
        const ids = new Set();

        const merge = (evts) => {
          if (!Array.isArray(evts)) return;
          evts.forEach(m => {
            if (m.id && !ids.has(m.id)) { matches.push(m); ids.add(m.id); }
            else if (!m.id) matches.push(m);
          });
        };

        // Step 1 — Live matches
        const live = await this.fetchProxy('api/matches/live');
        merge(live?.events);
        console.log('[FootAPI] Live matches:', live?.events?.length || 0);

        // Step 2 — Today, yesterday, day before yesterday
        const now = new Date();
        for (let daysBack = 0; daysBack <= 2; daysBack++) {
          const d = new Date(now);
          d.setDate(d.getDate() - daysBack);
          const dateStr = fmtDate(d);
          const dayMatches = await this._fetchMatchesByDate(dateStr);
          console.log(`[FootAPI] Matches ${dateStr}:`, dayMatches.length);
          merge(dayMatches);
          if (matches.length >= 10) break; // enough found
        }

        // Step 3 — Next 2 days (upcoming)
        if (matches.length < 5) {
          for (let daysAhead = 1; daysAhead <= 2; daysAhead++) {
            const d = new Date(now);
            d.setDate(d.getDate() + daysAhead);
            const dateStr = fmtDate(d);
            const dayMatches = await this._fetchMatchesByDate(dateStr);
            console.log(`[FootAPI] Upcoming ${dateStr}:`, dayMatches.length);
            merge(dayMatches);
          }
        }

        if (matches.length === 0) {
          this.showEmpty('events-container', 'No hay partidos disponibles. Intenta más tarde.');
          const countEl = $('event-count');
          if (countEl) countEl.innerText = '';
          return;
        }

        // Sort: live first, then upcoming, then finished
        matches.sort((a, b) => {
          const rank = m => {
            const s = String(m.status?.type || '').toLowerCase();
            if (s === 'inprogress') return 0;
            if (s === 'notstarted') return 1;
            return 2;
          };
          return rank(a) - rank(b);
        });

        this._renderEvents(matches, 'events-container', true);
        const shown = Math.min(matches.length, 30);
        const countEl = $('event-count');
        if (countEl) countEl.innerText = `${shown} EVENTOS`;

      } catch(err) {
        console.error('[FootAPI] loadNewsAndOdds error:', err);
        this.showEmpty('events-container', 'Error al cargar: ' + err.message);
      }
    },

    // ── Filter support ────────────────────────────────────────────────────────
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
    },

    // Player search (kept for potential future use)
    async searchPlayers(term) {
      if (!term) return;
      try {
        const data = await this.fetchProxy(`api/player/search/${encodeURIComponent(term)}`);
        return data?.players || data?.results || [];
      } catch(_) { return []; }
    }
  };

  // ── Match Details Logic ────────────────────────────────────────────────────
  const SoccerMatchDetails = {
    currentMatchId: null,
    currentTab: 'h2h',

    open(matchId, home, away) {
      if (!matchId || matchId.includes('_')) {
        SoccerAPI.showToast('Detalles no disponibles para este evento.', 'error');
        return;
      }
      this.currentMatchId = matchId;
      document.getElementById('md-title').textContent = `${home} vs ${away}`;
      document.getElementById('match-details-overlay').classList.add('open');
      document.getElementById('match-details-modal').classList.add('open');
      
      const fab = document.getElementById('my-bets-fab');
      if (fab) fab.style.display = 'none';

      this.switchTab('h2h');
    },

    close() {
      document.getElementById('match-details-overlay').classList.remove('open');
      document.getElementById('match-details-modal').classList.remove('open');
      this.currentMatchId = null;
      
      const modal = document.getElementById('betslip');
      if (!modal || !modal.classList.contains('open')) {
        const fab = document.getElementById('my-bets-fab');
        if (fab) fab.style.display = '';
      }
    },

    switchTab(tab) {
      this.currentTab = tab;
      document.querySelectorAll('.sm-details-tab').forEach(t => t.classList.remove('active'));
      document.getElementById(`tab-${tab}`).classList.add('active');
      this.loadData();
    },

    async loadData() {
      const body = document.getElementById('match-details-body');
      body.innerHTML = `
        <div style="padding:30px; text-align:center; color:rgba(255,255,255,.3);">
          <div style="font-size:1.5rem;margin-bottom:10px;">⏳</div>Cargando datos...
        </div>`;

      try {
        if (this.currentTab === 'h2h') {
          const res = await SoccerAPI.fetchProxy(`api/match/${this.currentMatchId}/h2h`);
          this.renderH2H(res);
        } else if (this.currentTab === 'stats') {
          const res = await SoccerAPI.fetchProxy(`api/match/${this.currentMatchId}/statistics`);
          this.renderStats(res);
        } else if (this.currentTab === 'lineups') {
          const res = await SoccerAPI.fetchProxy(`api/match/${this.currentMatchId}/lineups`);
          this.renderLineups(res);
        }
      } catch (err) {
        body.innerHTML = `<div class="sm-empty"><div class="sm-empty-icon">⚠️</div><p>No se pudieron cargar los datos.</p></div>`;
      }
    },

    renderH2H(data) {
      const body = document.getElementById('match-details-body');
      if (!data || !data.teamDuel || !data.managerDuel) {
        body.innerHTML = `<div class="sm-empty"><div class="sm-empty-icon">📊</div><p>No hay datos H2H disponibles para este partido.</p></div>`;
        return;
      }
      
      const duel = data.teamDuel || {};
      const homeWins = duel.homeWins || 0;
      const awayWins = duel.awayWins || 0;
      const draws = duel.draws || 0;
      
      body.innerHTML = `
        <div class="h2h-summary">
          <div class="h2h-box"><h4>${homeWins}</h4><p>Victorias Local</p></div>
          <div class="h2h-box"><h4>${draws}</h4><p>Empates</p></div>
          <div class="h2h-box"><h4>${awayWins}</h4><p>Victorias Visita</p></div>
        </div>
        <p style="text-align:center;font-size:0.75rem;color:rgba(255,255,255,0.4);">Basado en enfrentamientos directos previos.</p>
      `;
    },

    renderStats(data) {
      const body = document.getElementById('match-details-body');
      if (!data || !data.statistics || data.statistics.length === 0) {
        body.innerHTML = `<div class="sm-empty"><div class="sm-empty-icon">📈</div><p>Las estadísticas del partido aún no están disponibles.</p></div>`;
        return;
      }
      
      // Usually statistics[0] is for the whole match (period "ALL")
      const period = data.statistics[0] || {};
      const groups = period.groups || [];
      
      let html = '';
      groups.forEach(g => {
        html += `<h4 style="font-size:0.8rem; color:var(--sport-clr); margin: 16px 0 8px; font-family:'Orbitron',monospace;">${g.groupName}</h4>`;
        g.statisticsItems.forEach(item => {
          const homeVal = parseFloat(item.home) || 0;
          const awayVal = parseFloat(item.away) || 0;
          const total = homeVal + awayVal || 1; 
          const homePct = (homeVal / total) * 100;
          const awayPct = (awayVal / total) * 100;

          html += `
            <div class="stat-name">${item.name}</div>
            <div class="stat-row">
              <div class="stat-val">${item.home}</div>
              <div class="stat-bar-container">
                <div class="stat-bar-fill-home" style="width: ${homePct}%"></div>
                <div class="stat-bar-fill-away" style="width: ${awayPct}%"></div>
              </div>
              <div class="stat-val">${item.away}</div>
            </div>`;
        });
      });
      
      body.innerHTML = html;
    },

    renderLineups(data) {
      const body = document.getElementById('match-details-body');
      if (!data || !data.home || !data.away) {
        body.innerHTML = `<div class="sm-empty"><div class="sm-empty-icon">👕</div><p>Las alineaciones aún no están confirmadas para este partido.</p></div>`;
        return;
      }

      const homeFormation = data.home.formation || 'Formación Local';
      const awayFormation = data.away.formation || 'Formación Visita';

      const renderTeamList = (teamData) => {
        let listHTML = '';
        const players = teamData.players || [];
        players.forEach(p => {
          const jersey = p.shirtNumber ? `<strong style="color:var(--sport-clr);margin-right:8px;">${p.shirtNumber}</strong>` : '';
          const name = p.player?.shortName || p.player?.name || 'Jugador';
          const pos = p.position ? `<span style="float:right;font-size:0.6rem;color:rgba(255,255,255,.4);">${p.position}</span>` : '';
          listHTML += `<div style="padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,.05); font-size:0.75rem;">${jersey}${name}${pos}</div>`;
        });
        return listHTML;
      };

      body.innerHTML = `
        <div style="display:flex; gap:16px;">
          <div style="flex:1;">
            <h4 style="font-size:0.7rem; color:var(--sport-clr); text-align:center; border-bottom:2px solid var(--sport-clr); padding-bottom:6px; margin-bottom:8px;">
              Local<br><span style="font-size:0.6rem;color:rgba(255,255,255,.5);">${homeFormation}</span>
            </h4>
            ${renderTeamList(data.home)}
          </div>
          <div style="flex:1;">
            <h4 style="font-size:0.7rem; color:#fff; text-align:center; border-bottom:2px solid #fff; padding-bottom:6px; margin-bottom:8px;">
              Visita<br><span style="font-size:0.6rem;color:rgba(255,255,255,.5);">${awayFormation}</span>
            </h4>
            ${renderTeamList(data.away)}
          </div>
        </div>
      `;
    }
  };

  window.FootballAPI = SoccerAPI;
  window.SoccerAPI   = SoccerAPI;
  window.SoccerMatchDetails = SoccerMatchDetails;

  document.addEventListener('DOMContentLoaded', () => {
    SoccerAPI.initFilters();
    SoccerAPI.loadNewsAndOdds();
  });

})();
