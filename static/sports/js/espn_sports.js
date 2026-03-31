/**
 * espn_sports.js — Generic ESPN Scoreboard client
 * Used by matches.html for sports: nba, nhl, tennis, rugby, golf, f1
 * Reads window.SPORT_CONFIG to know which sport to load.
 * Uses ESPN's free public scoreboard API + custom matches from Firebase.
 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  // ESPN scoreboard API endpoints mapped by sport_source key
  const ESPN_ENDPOINTS = {
    nba:       'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard',
    nhl:       'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard',
    rugby:     'https://site.api.espn.com/apis/site/v2/sports/rugby/scoreboard',
    golf:      'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard',
    // Tennis & F1 don't have an ESPN scoreboard — will show custom-only:
    tennis:    null,
    f1:        null,
  };

  // Sport emoji fallbacks
  const SPORT_EMOJIS = {
    nba: '🏀', nhl: '🏒', rugby: '🏉', golf: '⛳', tennis: '🎾', f1: '🏎️'
  };

  const cfg = window.SPORT_CONFIG || { source: 'nba', name: 'NBA', emoji: '🏀', color: '#f59e0b' };
  const SPORT = cfg.source;

  function showLoader(containerId) {
    const c = $(containerId);
    if (!c) return;
    c.innerHTML = `
      <div class="sm-skeleton"><div class="sm-skel-line wide"></div><div class="sm-skel-line medium"></div></div>
      <div class="sm-skeleton"><div class="sm-skel-line wide"></div><div class="sm-skel-line short"></div></div>
      <div class="sm-skeleton"><div class="sm-skel-line wide"></div><div class="sm-skel-line medium"></div></div>`;
  }

  function showEmpty(containerId, msg) {
    const c = $(containerId);
    if (!c) return;
    c.innerHTML = `<div class="sm-empty"><div class="sm-empty-icon">${SPORT_EMOJIS[SPORT] || '🏆'}</div><p>${msg}</p></div>`;
  }

  function setupFilters() {
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
  }

  function buildEventCard(params) {
    const {
      matchId, home, away, scoreStr, displayTime, dataStatus,
      isFinished, league, homeLogo, awayLogo, showDraw
    } = params;

    const homeImg = homeLogo ? `<img src="${homeLogo}" style="height:20px;width:20px;vertical-align:middle;margin-left:5px;object-fit:contain;" onerror="this.style.display='none'">` : '';
    const awayImg = awayLogo ? `<img src="${awayLogo}" style="height:20px;width:20px;vertical-align:middle;margin-right:5px;object-fit:contain;" onerror="this.style.display='none'">` : '';

    const drawBtn = (showDraw && !isFinished) ? `
      <button class="sm-odd-btn" onclick="openBetSlip('${matchId}', 'empate', '${away} vs ${home}', 2.00)">
        <span class="sm-odd-label">EMPATE</span>
        <span class="sm-odd-value">2.00</span>
      </button>` : '';

    return `
      <div class="sm-event" data-status="${dataStatus}">
        <div class="sm-event-meta">
          <span class="sm-event-league">${league}</span>
          <span class="sm-event-time">${displayTime}</span>
        </div>
        <div class="sm-event-matchup">
          <div class="sm-event-team">${awayImg}${away}</div>
          <div class="sm-event-vs">${scoreStr}</div>
          <div class="sm-event-team">${home}${homeImg}</div>
        </div>
        ${!isFinished ? `
        <div class="sm-odds">
          <button class="sm-odd-btn" onclick="openBetSlip('${matchId}', '${away}', '${away} vs ${home}', 1.75)">
            <span class="sm-odd-label">VISITA (${away})</span>
            <span class="sm-odd-value">1.75</span>
          </button>
          ${drawBtn}
          <button class="sm-odd-btn" onclick="openBetSlip('${matchId}', '${home}', '${away} vs ${home}', 1.75)">
            <span class="sm-odd-label">LOCAL (${home})</span>
            <span class="sm-odd-value">1.75</span>
          </button>
        </div>` : `
        <div style="text-align:center; font-size:.72rem; color:rgba(255,255,255,0.3); padding: 4px 0;">⏹ Partido Finalizado</div>
        `}
      </div>`;
  }

  async function parseESPNEvent(event) {
    const comp   = event.competitions?.[0] || {};
    const comps  = comp.competitors || [];
    const homeObj = comps.find(c => c.homeAway === 'home') || comps[0] || {};
    const awayObj = comps.find(c => c.homeAway === 'away') || comps[1] || {};

    const home     = homeObj.team?.displayName || homeObj.team?.name || 'Local';
    const away     = awayObj.team?.displayName || awayObj.team?.name || 'Visitante';
    const homeLogo = homeObj.team?.logo || '';
    const awayLogo = awayObj.team?.logo || '';

    const homeScore = homeObj.score ?? '';
    const awayScore = awayObj.score ?? '';

    const statusInfo = comp.status?.type || {};
    const isFinished = statusInfo.completed || statusInfo.state === 'post';
    const isLive     = statusInfo.state === 'in';
    const liveLabel  = statusInfo.shortDetail || '';

    let scoreStr = 'VS';
    if ((isLive || isFinished) && homeScore !== '' && awayScore !== '') {
      scoreStr = `${awayScore} - ${homeScore}`;
    }

    let displayTime;
    if (isLive) {
      displayTime = `<span style="color:#ef4444;font-weight:bold;">🔴 EN VIVO${liveLabel ? ' · ' + liveLabel : ''}</span>`;
    } else if (isFinished) {
      displayTime = `<span style="color:rgba(255,255,255,0.4);">FINALIZADO${liveLabel ? ' (' + liveLabel + ')' : ''}</span>`;
    } else {
      const d = event.date ? new Date(event.date) : null;
      displayTime = d ? d.toLocaleString('es-MX', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : 'Próximamente';
    }

    const dataStatus = isLive ? 'live' : (isFinished ? 'finished' : 'upcoming');
    const league     = comp.league?.name || comp.tournament?.displayName || cfg.name.toUpperCase();
    const matchId    = event.id || `${home}_${away}`;

    return { matchId, home, away, scoreStr, displayTime, dataStatus, isFinished, league, homeLogo, awayLogo };
  }

  async function loadEvents() {
    const container = $('events-container');
    if (!container) return;
    showLoader('events-container');

    let cards = [];

    // 1️⃣ Fetch custom matches (upcoming + finished) for this sport
    try {
      const [upRes, finRes] = await Promise.all([
        fetch(`/sports/api/custom_matches/${SPORT}`),
        fetch(`/sports/api/custom_matches_finished/${SPORT}`)
      ]);
      const upData  = await upRes.json().catch(() => []);
      const finData = await finRes.json().catch(() => []);
      const allCustom = [
        ...(Array.isArray(upData)  ? upData  : []),
        ...(Array.isArray(finData) ? finData : [])
      ];

      allCustom.forEach(c => {
        const norm = CustomMatchTimer.normalizeCustomMatch(c, SPORT);
        cards.push({
          matchId:     norm.id,
          home:        norm.home_team,
          away:        norm.away_team,
          scoreStr:    norm.scoreStr,
          displayTime: norm.timeDisplay,
          dataStatus:  norm.isFinished ? 'finished' : 'upcoming',
          isFinished:  norm.isFinished,
          league:      norm.league || '🔥 EVENTO ESPECIAL',
          homeLogo:    '',
          awayLogo:    '',
          showDraw:    false,
          sortPriority: 0  // custom first
        });
      });
    } catch(e) {
      console.warn('[EspnSports] Custom matches fetch error:', e);
    }

    // 2️⃣ Fetch ESPN scoreboard (if endpoint exists for this sport)
    const endpoint = ESPN_ENDPOINTS[SPORT];
    if (endpoint) {
      try {
        const res  = await fetch(endpoint);
        const data = await res.json();
        const events = data.events || [];

        for (const ev of events) {
          const parsed = await parseESPNEvent(ev);
          cards.push({
            ...parsed,
            showDraw:    false,
            sortPriority: 1
          });
        }
      } catch(e) {
        console.warn(`[EspnSports] ESPN API error for ${SPORT}:`, e);
      }
    }

    if (cards.length === 0) {
      const sportName = cfg.name || SPORT.toUpperCase();
      showEmpty('events-container',
        endpoint
          ? `No hay eventos de ${sportName} disponibles en este momento.`
          : `No hay eventos de ${sportName} disponibles. Los administradores pueden agregar eventos personalizados.`
      );
      return;
    }

    // Sort: custom first, then live → upcoming → finished
    const statusOrder = { live: 0, upcoming: 1, finished: 2 };
    cards.sort((a, b) => {
      if (a.sortPriority !== b.sortPriority) return a.sortPriority - b.sortPriority;
      return (statusOrder[a.dataStatus] ?? 1) - (statusOrder[b.dataStatus] ?? 1);
    });

    container.innerHTML = cards.map(c => buildEventCard(c)).join('');

    const countEl = $('event-count');
    if (countEl) countEl.innerText = `${cards.length} eventos`;
  }

  document.addEventListener('DOMContentLoaded', () => {
    setupFilters();
    setTimeout(loadEvents, 80);
  });

})();
