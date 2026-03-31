/**
 * custom_match_timer.js
 * Módulo compartido que auto-expira partidos custom en el frontend
 * basado en duraciones específicas por deporte.
 *
 * Uso:
 *   CustomMatchTimer.isExpired(sport, dateStr)  → boolean
 *   CustomMatchTimer.getStatus(sport, dateStr, currentStatus) → 'upcoming'|'finished'
 *   CustomMatchTimer.formatFinishedDisplay()    → HTML string del badge "FINALIZADO"
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

  const CustomMatchTimer = {

    /**
     * Retorna true si el partido ya debería estar finalizado.
     * @param {string} sport - key del deporte (ej: 'soccer', 'nba')
     * @param {string|number} dateStr - fecha ISO o timestamp en segundos
     */
    isExpired(sport, dateStr) {
      try {
        const durationMs = (SPORT_DURATIONS[sport] || DEFAULT_DURATION) * 60 * 1000;
        let startMs;

        if (typeof dateStr === 'number') {
          // Unix timestamp en segundos (footapi)
          startMs = dateStr * 1000;
        } else if (typeof dateStr === 'string') {
          startMs = new Date(dateStr).getTime();
        } else {
          return false;
        }

        if (isNaN(startMs)) return false;

        const elapsed = Date.now() - startMs;
        return elapsed >= durationMs;
      } catch (e) {
        console.warn('[CustomMatchTimer] Error checking expiry:', e);
        return false;
      }
    },

    /**
     * Retorna el status efectivo del partido: 'upcoming', 'live', o 'finished'
     * considerando la auto-expiración.
     */
    getStatus(sport, dateStr, currentStatus) {
      if (currentStatus === 'finished' || currentStatus === 'resolved') {
        return 'finished';
      }
      if (this.isExpired(sport, dateStr)) {
        return 'finished';
      }
      // Check if it started but not expired yet → live candidate
      try {
        let startMs;
        if (typeof dateStr === 'number') startMs = dateStr * 1000;
        else startMs = new Date(dateStr).getTime();
        if (!isNaN(startMs) && Date.now() >= startMs) {
          // Could be live, but we don't override API status for live matches
          return currentStatus || 'upcoming';
        }
      } catch(_) {}
      return currentStatus || 'upcoming';
    },

    /**
     * Genera el HTML de tiempo para un partido custom auto-expirado.
     * @param {string} dateStr - fecha ISO
     * @param {object} match - datos del partido (puede tener score_home, score_away)
     */
    buildTimeDisplay(dateStr, match) {
      if (!dateStr) return 'Próximamente';

      try {
        const d = new Date(dateStr);
        const formatted = d.toLocaleString('es-MX', {
          day:    '2-digit',
          month:  'short',
          hour:   '2-digit',
          minute: '2-digit',
        });
        return formatted;
      } catch(_) {
        return dateStr;
      }
    },

    /**
     * Genera el HTML del badge "FINALIZADO" para partidos custom expirados.
     * Si tiene marcador, lo incluye.
     */
    finishedBadge(match) {
      const sh = match.score_home;
      const sa = match.score_away;
      if (sh !== null && sh !== undefined && sa !== null && sa !== undefined) {
        return `<span style="color:rgba(255,255,255,0.5);">✅ FINALIZADO</span>`;
      }
      return `<span style="color:rgba(255,255,255,0.4);">⏹ FINALIZADO</span>`;
    },

    /**
     * Para partidos custom con score, devuelve el string del marcador.
     * Ej: "2-1"
     */
    scoreString(match) {
      const sh = match.score_home;
      const sa = match.score_away;
      if (sh !== null && sh !== undefined && sa !== null && sa !== undefined) {
        return `${sa} - ${sh}`; // Away - Home (como en el layout)
      }
      return null;
    },

    /**
     * Construye un objeto evento normalizado desde un partido custom
     * compatible con el renderizado de cualquier deporte.
     */
    normalizeCustomMatch(c, sport) {
      const dateStr = c.date || '';
      const expired = this.isExpired(sport, dateStr);
      const alreadyFinished = c.status === 'finished' || c.status === 'resolved';
      const isFinished = expired || alreadyFinished;

      const scoreStr = this.scoreString(c);
      const timeDisplay = isFinished
        ? this.finishedBadge(c)
        : this.buildTimeDisplay(dateStr, c);

      return {
        isCustom:    true,
        id:          c.id,
        home_team:   c.home_team || 'Local',
        away_team:   c.away_team || 'Visitante',
        league:      c.league || '🔥 EVENTO ESPECIAL',
        description: c.description || '',
        date:        dateStr,
        status:      isFinished ? 'finished' : 'upcoming',
        score_home:  c.score_home,
        score_away:  c.score_away,
        scoreStr:    scoreStr || 'VS',
        timeDisplay: timeDisplay,
        isFinished:  isFinished,
      };
    }
  };

  global.CustomMatchTimer = CustomMatchTimer;

})(window);
