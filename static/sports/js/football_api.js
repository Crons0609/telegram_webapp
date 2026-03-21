// ============================================================
// FOOTBALL-DATA.ORG v4 — API LAYER
// Zona Jackpot 777 · Centralized API Module
// ============================================================

const FOOTBALL_API = (() => {

  // ----------------------------------------------------------
  // CONFIG (single source of truth)
  // ----------------------------------------------------------

  const BASE_URL = "https://api.football-data.org/v4";
  const TOKEN    = "64bc358798804da7badf499eee7de194";
  const HEADERS  = { "X-Auth-Token": TOKEN };

  // ----------------------------------------------------------
  // CACHE (in-memory, TTL-based)
  // ----------------------------------------------------------

  const _cache = new Map(); // key → { data, expiresAt }

  function _getCached(key) {
    const entry = _cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      _cache.delete(key);
      return null;
    }
    return entry.data;
  }

  function _setCache(key, data, ttlMs) {
    _cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  // ----------------------------------------------------------
  // LOGGER (controlled — disable in production by setting false)
  // ----------------------------------------------------------

  const _DEBUG = false;
  function _log(...args)  { if (_DEBUG) console.log("[FOOTBALL_API]", ...args); }
  function _warn(...args) { console.warn("[FOOTBALL_API]", ...args); }
  function _error(...args){ console.error("[FOOTBALL_API]", ...args); }

  // ----------------------------------------------------------
  // HTTP FETCH with Timeout + Retry + Error Handling
  // ----------------------------------------------------------

  const TIMEOUT_MS = 10_000; // 10 s
  const MAX_RETRIES = 2;

  async function _fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }

  async function apiRequest(endpoint, { ttlMs = 60_000, retries = MAX_RETRIES } = {}) {
    const cacheKey = endpoint;
    const cached = _getCached(cacheKey);

    if (cached !== null) {
      _log(`[CACHE HIT] ${endpoint}`);
      return cached;
    }

    const url = `${BASE_URL}${endpoint}`;
    let attempt = 0;

    while (attempt <= retries) {
      try {
        _log(`[FETCH] ${url} (attempt ${attempt + 1})`);

        const res = await _fetchWithTimeout(url, { headers: HEADERS });

        // --- HTTP error handling ---
        if (!res.ok) {
          if (res.status === 401) {
            _error("401 — Token inválido. Verifica X-Auth-Token.");
            return null;
          }
          if (res.status === 403) {
            _warn("403 — Acceso denegado. Plan de API insuficiente para este endpoint.");
            return null;
          }
          if (res.status === 429) {
            const retryAfter = parseInt(res.headers.get("X-RequestCounter-Reset") || "60", 10);
            _warn(`429 — Rate limit alcanzado. Espera ${retryAfter}s.`);
            // Propagate the rate-limit info to the UI
            _dispatchEvent("ratelimit", { waitSeconds: retryAfter });
            await _sleep(retryAfter * 1000);
            attempt++;
            continue;
          }
          if (res.status >= 500) {
            _warn(`${res.status} — Error del servidor de football-data.`);
            if (attempt < retries) {
              await _sleep(1000 * (attempt + 1)); // exponential backoff
              attempt++;
              continue;
            }
            return null;
          }
          _error(`HTTP ${res.status} — ${res.statusText}`);
          return null;
        }

        const json = await res.json();
        _setCache(cacheKey, json, ttlMs);
        _log(`[OK] ${endpoint}`);
        return json;

      } catch (err) {
        if (err.name === "AbortError") {
          _warn(`[TIMEOUT] ${endpoint} después de ${TIMEOUT_MS}ms`);
        } else {
          _warn(`[NET ERROR] ${endpoint}:`, err.message);
        }

        if (attempt < retries) {
          await _sleep(800 * (attempt + 1));
          attempt++;
          continue;
        }
        _error(`[FAIL] ${endpoint} después de ${retries + 1} intentos`);
        return null;
      }
    }

    return null;
  }

  // ----------------------------------------------------------
  // UTILITY HELPERS
  // ----------------------------------------------------------

  function _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function _dispatchEvent(name, detail = {}) {
    window.dispatchEvent(new CustomEvent(`footballApi:${name}`, { detail }));
  }

  // ----------------------------------------------------------
  // PUBLIC API FUNCTIONS
  // ----------------------------------------------------------

  /**
   * Get upcoming + live matches for multiple competitions.
   * Aggregates CL, PL, PD, BL1, SA, FL1 by default.
   *
   * @param {string[]} competitionCodes - e.g. ['PL','CL']
   * @param {number}   ttlMs            - cache duration in ms (default 60s)
   */
  async function getMatches(competitionCodes = ["CL","PL","PD","BL1","SA","FL1"], ttlMs = 60_000) {
    const results = await Promise.all(
      competitionCodes.map(code =>
        apiRequest(`/competitions/${code}/matches?status=SCHEDULED`, { ttlMs })
      )
    );

    const allMatches = [];
    results.forEach((res, i) => {
      if (!res || !res.matches) return;
      res.matches.forEach(m => {
        allMatches.push(_normalizeMatch(m, competitionCodes[i]));
      });
    });

    // Sort by date ascending
    allMatches.sort((a, b) => new Date(a.date) - new Date(b.date));
    return allMatches;
  }

  /**
   * Get currently live / in-progress matches.
   */
  async function getLiveMatches(ttlMs = 30_000) {
    const res = await apiRequest(`/matches?status=IN_PLAY,PAUSED`, { ttlMs });
    if (!res || !res.matches) return [];
    return res.matches.map(m => _normalizeMatch(m, m.competition?.code || ""));
  }

  /**
   * Get today's matches.
   */
  async function getTodayMatches(ttlMs = 60_000) {
    const today = new Date().toISOString().split("T")[0];
    const res = await apiRequest(`/matches?dateFrom=${today}&dateTo=${today}`, { ttlMs });
    if (!res || !res.matches) return [];
    return res.matches.map(m => _normalizeMatch(m, m.competition?.code || ""));
  }

  /**
   * Get available competitions.
   */
  async function getCompetitions(ttlMs = 86_400_000 /* 24h */) {
    const res = await apiRequest("/competitions", { ttlMs });
    if (!res || !res.competitions) return [];
    return res.competitions.map(c => ({
      id:   c.id,
      code: c.code,
      name: c.name,
      area: c.area?.name || "",
      emblem: c.emblem || null
    }));
  }

  /**
   * Get teams for a competition.
   * @param {string} competitionCode
   */
  async function getTeams(competitionCode, ttlMs = 86_400_000 /* 24h */) {
    const res = await apiRequest(`/competitions/${competitionCode}/teams`, { ttlMs });
    if (!res || !res.teams) return [];
    return res.teams.map(t => ({
      id:     t.id,
      name:   t.name,
      crest:  t.crest || null,
      area:   t.area?.name || ""
    }));
  }

  /**
   * Get single match details.
   * @param {number} matchId
   */
  async function getMatchDetails(matchId, ttlMs = 30_000) {
    const res = await apiRequest(`/matches/${matchId}`, { ttlMs });
    if (!res) return null;
    return _normalizeMatch(res, res.competition?.code || "");
  }

  // ----------------------------------------------------------
  // DATA NORMALIZER
  // Maps football-data.org match → internal app format
  // ----------------------------------------------------------

  function _normalizeMatch(m, competitionCode) {
    const status = _mapStatus(m.status);
    const score  = m.score?.fullTime;
    const homeScore = score?.home ?? null;
    const awayScore = score?.away ?? null;

    return {
      id:              m.id,
      team1:           m.homeTeam?.shortName || m.homeTeam?.name || "Local",
      team2:           m.awayTeam?.shortName || m.awayTeam?.name || "Visitante",
      team1_crest:     m.homeTeam?.crest || null,
      team2_crest:     m.awayTeam?.crest || null,
      date:            m.utcDate,
      status,
      competition:     m.competition?.name || competitionCode,
      competition_code: competitionCode,
      score: {
        home: homeScore,
        away: awayScore
      },
      minute:          m.minute || null,
      // Default odds (floating — overridden by local DB where available)
      odds: _defaultOdds()
    };
  }

  function _mapStatus(raw) {
    const map = {
      SCHEDULED:  "upcoming",
      TIMED:      "upcoming",
      IN_PLAY:    "live",
      PAUSED:     "live",
      FINISHED:   "finished",
      POSTPONED:  "postponed",
      CANCELLED:  "cancelled",
      SUSPENDED:  "suspended"
    };
    return map[raw] || "upcoming";
  }

  function _defaultOdds() {
    // Realistic pseudo-odds (overridden when local DB has the match)
    return { "1": 2.10, "X": 3.20, "2": 3.40 };
  }

  // ----------------------------------------------------------
  // CACHE INSPECTOR (debug)
  // ----------------------------------------------------------

  function getCacheInfo() {
    const info = [];
    _cache.forEach((val, key) => {
      info.push({
        key,
        expiresIn: Math.round((val.expiresAt - Date.now()) / 1000) + "s"
      });
    });
    return info;
  }

  function clearCache() {
    _cache.clear();
    _log("Cache cleared.");
  }

  // ----------------------------------------------------------
  // EXPOSED PUBLIC INTERFACE
  // ----------------------------------------------------------

  return {
    // Core requests
    apiRequest,
    // Match endpoints
    getMatches,
    getLiveMatches,
    getTodayMatches,
    getMatchDetails,
    // Other endpoints
    getCompetitions,
    getTeams,
    // Cache utilities (debug / admin)
    _cache,
    getCacheInfo,
    clearCache
  };

})();
