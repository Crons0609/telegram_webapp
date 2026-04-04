"""
cache_system.py — Sistema Avanzado de Caché para APIs Deportivas
================================================================
Arquitectura: RAM cache (dict) + threading.Lock para deduplicación.
Compatible con Render FREE (sin Redis, sin dependencias adicionales).

TTL por categoría:
  - live    → 15  s
  - matches → 120 s
  - leagues → 3600 s
  - default → 180 s

Funcionalidades:
  1. TTL configurable por clave
  2. Stale-While-Revalidate (sírvete stale, refreshea en background)
  3. threading.Lock por clave para prevenir thundering herd
  4. Endpoint helper para refrescar el caché externamente (UptimeRobot/Cron)
"""

import time
import threading
import logging
import requests
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)

# ─── TTL DEFAULTS (segundos) ──────────────────────────────────────────────────
TTL_LIVE    = 15
TTL_MATCHES = 120
TTL_LEAGUES = 3600
TTL_DEFAULT = 180

# ─── TIPO DE CATEGORÍA → TTL ──────────────────────────────────────────────────
_CATEGORY_TTL = {
    'live':    TTL_LIVE,
    'matches': TTL_MATCHES,
    'leagues': TTL_LEAGUES,
}


class AdvancedSportsCache:
    """
    Caché en memoria con soporte de:
      · TTL configurable por entrada
      · Stale-While-Revalidate
      · threading.Lock por clave (prevención de llamadas duplicadas)
    """

    def __init__(self):
        # Almacenamiento principal: { key → { data, timestamp, ttl } }
        self._store: dict[str, dict] = {}

        # Un Lock por clave activa (para deduplicar solicitudes simultáneas)
        self._locks: dict[str, threading.Lock] = {}
        self._locks_meta = threading.Lock()  # Protege el dict _locks

        # Permite sobreescribir TTL desde el panel admin
        self._ttl_overrides: dict[str, int] = {}

    # ── Obtener o crear lock por clave ────────────────────────────────────────
    def _get_lock(self, key: str) -> threading.Lock:
        with self._locks_meta:
            if key not in self._locks:
                self._locks[key] = threading.Lock()
            return self._locks[key]

    # ── Calcular TTL efectivo ──────────────────────────────────────────────────
    def _resolve_ttl(self, key: str, category: str = 'default') -> int:
        if key in self._ttl_overrides:
            return self._ttl_overrides[key]
        return _CATEGORY_TTL.get(category, TTL_DEFAULT)

    # ── Guardar en caché ──────────────────────────────────────────────────────
    def set(self, key: str, data: Any, category: str = 'default', ttl: int = None):
        effective_ttl = ttl if ttl is not None else self._resolve_ttl(key, category)
        self._store[key] = {
            'key':       key,
            'data':      data,
            'timestamp': time.time(),
            'ttl':       effective_ttl,
            'category':  category,
        }
        logger.debug(f"[Cache] SET {key} (TTL={effective_ttl}s)")

    # ── Obtener del caché ─────────────────────────────────────────────────────
    def get(self, key: str) -> Optional[Any]:
        entry = self._store.get(key)
        if entry is None:
            return None
        age = time.time() - entry['timestamp']
        if age < entry['ttl']:
            return entry['data']
        return None  # Expirado

    # ── ¿Está expirado pero disponible (stale)? ───────────────────────────────
    def get_stale(self, key: str) -> Optional[Any]:
        """Devuelve datos aunque estén expirados (para stale-while-revalidate)."""
        entry = self._store.get(key)
        if entry:
            return entry['data']
        return None

    def is_stale(self, key: str) -> bool:
        """True si la entrada existe pero está expirada."""
        entry = self._store.get(key)
        if entry is None:
            return False
        age = time.time() - entry['timestamp']
        return age >= entry['ttl']

    # ── Obtener con Stale-While-Revalidate ────────────────────────────────────
    def get_or_stale(self, key: str, fetcher: Callable, category: str = 'default', ttl: int = None):
        """
        1. Si hay datos frescos → devolver inmediatamente.
        2. Si hay datos stale → devolver stale + lanzar refresh en background.
        3. Si no hay datos → bloquear, llamar al fetcher, almacenar y devolver.
        """
        fresh = self.get(key)
        if fresh is not None:
            return fresh, False  # (data, was_stale)

        stale = self.get_stale(key)
        if stale is not None:
            # Lanzar revalidación en background sin bloquear
            self._revalidate_background(key, fetcher, category, ttl)
            return stale, True  # Devolver stale mientras se refresca

        # Sin datos → obtener con lock (un solo fetch, los demás esperan)
        lock = self._get_lock(key)
        with lock:
            # Double-check: otro hilo pudo haber llenado el cache
            fresh2 = self.get(key)
            if fresh2 is not None:
                return fresh2, False

            try:
                data = fetcher()
                effective_ttl = ttl if ttl is not None else self._resolve_ttl(key, category)
                self.set(key, data, category, effective_ttl)
                return data, False
            except Exception as exc:
                logger.error(f"[Cache] Fetcher error for key={key}: {exc}")
                raise

    def _revalidate_background(self, key: str, fetcher: Callable, category: str, ttl: int = None):
        """Revalida el caché en un hilo daemon sin bloquear la respuesta."""
        def _worker():
            lock = self._get_lock(key)
            if not lock.acquire(blocking=False):
                return  # Otro hilo ya está refrescando
            try:
                data = fetcher()
                self.set(key, data, category, ttl)
                logger.info(f"[Cache] Background revalidated: {key}")
            except Exception as exc:
                logger.warning(f"[Cache] Background revalidation failed for {key}: {exc}")
            finally:
                lock.release()

        t = threading.Thread(target=_worker, daemon=True)
        t.start()

    # ── Eliminar entrada ──────────────────────────────────────────────────────
    def delete(self, key: str):
        self._store.pop(key, None)
        logger.debug(f"[Cache] DEL {key}")

    # ── Limpiar todo ──────────────────────────────────────────────────────────
    def clear(self):
        self._store.clear()
        logger.info("[Cache] Cache completamente limpiado")

    # ── Limpiar solo expirados ─────────────────────────────────────────────────
    def evict_expired(self):
        now = time.time()
        expired_keys = [
            k for k, v in self._store.items()
            if now - v['timestamp'] >= v['ttl']
        ]
        for k in expired_keys:
            del self._store[k]
        if expired_keys:
            logger.debug(f"[Cache] Evicted {len(expired_keys)} expired entries")
        return len(expired_keys)

    # ── Estado del caché (para panel admin) ───────────────────────────────────
    def status(self) -> dict:
        now = time.time()
        entries = []
        for key, entry in self._store.items():
            age = now - entry['timestamp']
            remaining = max(0, entry['ttl'] - age)
            entries.append({
                'key':       key,
                'category':  entry.get('category', 'default'),
                'ttl':       entry['ttl'],
                'age_s':     round(age, 1),
                'remaining_s': round(remaining, 1),
                'is_fresh':  remaining > 0,
                'size_bytes': len(str(entry.get('data', '')).encode('utf-8')),
            })
        entries.sort(key=lambda x: x['key'])
        return {
            'total_entries': len(entries),
            'entries': entries,
            'ttl_config': {
                'live':    self._ttl_overrides.get('live',    TTL_LIVE),
                'matches': self._ttl_overrides.get('matches', TTL_MATCHES),
                'leagues': self._ttl_overrides.get('leagues', TTL_LEAGUES),
                'default': TTL_DEFAULT,
            },
        }

    # ── Actualizar TTL dinámicamente ──────────────────────────────────────────
    def set_ttl_override(self, category: str, ttl_seconds: int):
        self._ttl_overrides[category] = max(5, int(ttl_seconds))
        logger.info(f"[Cache] TTL override: {category} → {ttl_seconds}s")


# ─── INSTANCIA GLOBAL ────────────────────────────────────────────────────────
sports_cache = AdvancedSportsCache()


# ─── HELPERS PARA PROXIES ─────────────────────────────────────────────────────

def cached_api_call(
    cache_key: str,
    fetcher: Callable,
    category: str = 'default',
    ttl: int = None,
) -> tuple[Any, bool]:
    """
    Helper de alto nivel para rutas proxy.
    Devuelve (data, was_stale).
    Lanza excepción si no hay datos en caché y el fetcher falla.
    """
    return sports_cache.get_or_stale(cache_key, fetcher, category, ttl)


def build_rapidapi_fetcher(url: str, api_key: str, api_host: str, params: dict = None) -> Callable:
    """
    Construye un callable que hace GET a RapidAPI y devuelve el JSON.
    Levanta excepción si falla (lo maneja cached_api_call o el caller).
    """
    def _fetch():
        headers = {
            "x-rapidapi-key":  api_key,
            "x-rapidapi-host": api_host,
            "Accept":          "application/json",
        }
        resp = requests.get(url, headers=headers, params=params or {}, timeout=12)
        if resp.status_code == 429:
            raise RuntimeError("RapidAPI rate limit (429)")
        if resp.status_code == 403:
            raise RuntimeError("RapidAPI access denied (403)")
        resp.raise_for_status()
        return resp.json()
    return _fetch


# ─── AUTO-EVICTION EN SEGUNDO PLANO ──────────────────────────────────────────

def _start_eviction_thread(interval_seconds: int = 300):
    """Hilo daemon que borra entradas expiradas cada N segundos."""
    def _loop():
        while True:
            time.sleep(interval_seconds)
            try:
                sports_cache.evict_expired()
            except Exception as exc:
                logger.warning(f"[Cache] Eviction error: {exc}")

    t = threading.Thread(target=_loop, daemon=True, name="cache-eviction")
    t.start()
    logger.info(f"[Cache] Eviction thread started (every {interval_seconds}s)")


_start_eviction_thread(300)
