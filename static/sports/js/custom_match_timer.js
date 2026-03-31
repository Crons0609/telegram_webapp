/**
 * custom_match_timer.js
 * Módulo compartido que auto-expira partidos custom en el frontend
 * basado en duraciones específicas por deporte.
 *
 * Uso:
 *   CustomMatchTimer.isExpired(sport, dateStr)                    → boolean
 *   CustomMatchTimer.getStatus(sport, dateStr, currentStatus)     → 'upcoming'|'live'|'finished'
 *   CustomMatchTimer.finishedBadge(match)                        → HTML string badge "FINALIZADO · score"
 *   CustomMatchTimer.buildTimeDisplay(dateStr, match, sport)      → HTML string (countdown / fecha)
 *   CustomMatchTimer.normalizeCustomMatch(c, sport)               → normalised object
 */
(function (global) {
  'use strict';

  // ── Duraciones por deporte (minutos luego del inicio) ────────────────────────
  const SPORT_DURATIONS = {
    soccer:  110,   // 90 min + 20 buffer
    nba:     150,   // 120 min + 30 buffer
    nfl:     210,   // 180 min + 30 buffer
    mlb:     210,   // 180 min + 30 buffer
    tennis:  180,   // 150 min + 30 buffer
    nhl:     120,   // 90 min + 30 buffer
    f1:      120,   // 90 min + 30 buffer
    rugby:   100,   // 80 min + 20 buffer
    golf:    420,   // 360 min + 60 buffer
  };

  const DEFAULT_DURATION = 120; // fallback 2 horas

  // ── Helpers ───────────────────────────────────────────────────────────────────

  function _parseMs(dateStr) {
    if (!dateStr) return NaN;
    if (typeof dateStr === 'number') return dateStr * 1000;
    const ms = new Date(dateStr).getTime();
    return ms;
  }

  function _formatCountdown(diffMs) {
    if (diffMs <= 0) return null;
    const totalSec = Math.floor(diffMs / 1000);
    const days  = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const mins  = Math.floor((totalSec % 3600) / 60);
    if (days > 0)  return `en ${days}d ${hours}h`;
    if (hours > 0) return `en ${hours}h ${mins}m`;
    if (mins > 0)  return `en ${mins}m`;
    return 'inminente';
  }

  function _formatElapsed(elapsedMs, sport) {
    const totalMin = Math.floor(elapsedMs / 60000);
    const durationMin = SPORT_DURATIONS[sport] || DEFAULT_DURATION;
    // Cap display at expected duration
    const displayMin = Math.min(totalMin, durationMin - 1);
    if (sport === 'soccer' && displayMin <= 90) return `${displayMin}'`;
    if (sport === 'nba')    return `${displayMin} min`;
    if (sport === 'mlb')    return `Inning ~${Math.ceil(displayMin / 20)}`;
    return `${displayMin} min`;
  }

  // ── Main module ───────────────────────────────────────────────────────────────

  const CustomMatchTimer = {

    /**
     * Retorna true si el partido ya debería estar finalizado.
     */
    isExpired(sport, dateStr) {
      try {
        const durationMs = (SPORT_DURATIONS[sport] || DEFAULT_DURATION) * 60 * 1000;
        const startMs = _parseMs(dateStr);
        if (isNaN(startMs)) return false;
        return (Date.now() - startMs) >= durationMs;
      } catch (e) {
        console.warn('[CustomMatchTimer] Error checking expiry:', e);
        return false;
      }
    },

    /**
     * Retorna el status efectivo del partido: 'upcoming', 'live', o 'finished'
     */
    getStatus(sport, dateStr, currentStatus) {
      if (currentStatus === 'finished' || currentStatus === 'resolved') return 'finished';
      if (this.isExpired(sport, dateStr)) return 'finished';

      try {
        const startMs = _parseMs(dateStr);
        if (!isNaN(startMs) && Date.now() >= startMs) {
          return 'live'; // Started but not expired yet
        }
      } catch(_) {}
      return 'upcoming';
    },

    /**
     * Genera el HTML del badge "FINALIZADO" con score si está disponible.
     */
    finishedBadge(match) {
      const sh = match.score_home;
      const sa = match.score_away;
      const hasScore = sh !== null && sh !== undefined && sa !== null && sa !== undefined;
      if (hasScore) {
        // "away - home" layout matches the card design (away on left)
        return `<span style="color:rgba(255,255,255,0.55);">✅ FINALIZADO <span style="color:#10b981;font-weight:700;">${sa} - ${sh}</span></span>`;
      }
      return `<span style="color:rgba(255,255,255,0.4);">⏹ FINALIZADO</span>`;
    },

    /**
     * Genera el HTML de tiempo para mostrar en la tarjeta del partido.
     * - Futuro:    countdown "en 2h 30m"
     * - En curso:  minuto del partido (si aplica)
     * - Expirado sin resolve: "⏳ Sin resultado"
     */
    buildTimeDisplay(dateStr, match, sport) {
      if (!dateStr) return 'Próximamente';

      try {
        const startMs  = _parseMs(dateStr);
        if (isNaN(startMs)) return String(dateStr);

        const now       = Date.now();
        const diffToStart = startMs - now;

        // ── Future ──
        if (diffToStart > 0) {
          const countdown = _formatCountdown(diffToStart);
          const dateFormatted = new Date(startMs).toLocaleString('es-MX', {
            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
          });
          return `<span style="color:#818cf8;font-size:0.85em;">🕐 ${countdown}</span> <span style="color:rgba(255,255,255,0.35);font-size:0.78em;">${dateFormatted}</span>`;
        }

        const elapsed = now - startMs;
        const durationMs = (SPORT_DURATIONS[sport] || DEFAULT_DURATION) * 60 * 1000;

        // ── Expired but not resolved ──
        if (elapsed >= durationMs) {
          const sh = match && match.score_home;
          const sa = match && match.score_away;
          if (sh !== null && sh !== undefined && sa !== null && sa !== undefined) {
            return this.finishedBadge(match);
          }
          return `<span style="color:rgba(239,68,68,0.8);">⏳ Esperando resultado...</span>`;
        }

        // ── Live ──
        const elapsedStr = _formatElapsed(elapsed, sport);
        return `<span style="color:#ef4444;font-weight:bold;">🔴 EN VIVO ${elapsedStr}</span>`;

      } catch(e) {
        return String(dateStr);
      }
    },

    /**
     * Para partidos custom con score, devuelve el string del marcador.
     * Ej: "2-1" (away - home)
     */
    scoreString(match) {
      const sh = match.score_home;
      const sa = match.score_away;
      if (sh !== null && sh !== undefined && sa !== null && sa !== undefined) {
        return `${sa} - ${sh}`; // Away on left, Home on right (matches card layout)
      }
      return null;
    },

    /**
     * Construye un objeto evento normalizado desde un partido custom
     * compatible con el renderizado de cualquier deporte.
     */
    normalizeCustomMatch(c, sport) {
      const dateStr        = c.date || '';
      const effectiveStatus = this.getStatus(sport, dateStr, c.status);
      const isFinished     = effectiveStatus === 'finished';
      const isLive         = effectiveStatus === 'live';

      const scoreStr   = this.scoreString(c);
      const timeDisplay = isFinished
        ? this.finishedBadge(c)
        : this.buildTimeDisplay(dateStr, c, sport);

      return {
        isCustom:    true,
        id:          c.id,
        home_team:   c.home_team  || 'Local',
        away_team:   c.away_team  || 'Visitante',
        league:      c.league     || '🔥 EVENTO ESPECIAL',
        description: c.description || '',
        date:        dateStr,
        status:      isFinished ? 'finished' : (isLive ? 'live' : 'upcoming'),
        score_home:  c.score_home,
        score_away:  c.score_away,
        scoreStr:    scoreStr || 'VS',
        timeDisplay: timeDisplay,
        isFinished:  isFinished,
        isLive:      isLive,
        // For backward compat: alias
        buildTime:   dateStr,
      };
    }
  };

  global.CustomMatchTimer = CustomMatchTimer;

})(window);
