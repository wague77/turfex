
from fastapi import FastAPI, APIRouter, HTTPException, Header, Request, Response
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import time
import secrets
import asyncio
from collections import defaultdict
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Any, Dict, Tuple
import uuid
from datetime import datetime, timedelta, timezone
import httpx
import bcrypt

# Configure logging (défini tôt car utilisé par des helpers en haut du fichier)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI()

# CORS — autorise toutes les origines (Vercel, localhost, etc.)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


PMU_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Accept": "application/json",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
}

ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "wague-admin-2026")
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # sans 0/O/1/I

# ===== EMAIL (Resend) — TOGGLE =====
# Actif uniquement si RESEND_API_KEY + ADMIN_NOTIFICATION_EMAIL sont définis dans .env.
# La logique d'envoi + templates + scheduler est dans /app/backend/notifications.py
from notifications import (
    email_enabled as email_notifications_enabled,
    get_settings as get_notification_settings,
    update_settings as update_notification_settings,
    send_config_test,
    on_admin_password_changed,
    on_ip_locked,
    on_code_activated,
    on_payment_received,
    on_bet_won,
    on_pronostic_grade_a,
    send_daily_digest,
    send_weekly_digest,
    send_daily_r1_pronostics,
    build_r1_html_only,
    build_followup_html_only,
    render_ferran_r1_html,
    send_trial_followup,
    send_code_expiring_warnings,
    on_pronostic_grade_a_user_broadcast,
    get_active_subscribers,
    log_digest_run,
    get_last_digest_run,
    should_run_catchup,
    _env as _email_env,
    DEFAULT_SETTINGS as NOTIF_DEFAULT_SETTINGS,
)
from ai_analysis import (
    analyze_horse as ai_analyze_horse,
    analyze_top8 as ai_analyze_top8,
    get_usage_stats as ai_usage_stats,
)
from ferran import analyze_with_ferran

# Récupère le mot de passe admin actuel : privilégie la DB, fallback sur env
# (renvoie la valeur stockée brute — peut être un hash bcrypt OU un plain legacy)
async def get_current_admin_password() -> str:
    doc = await db.admin_config.find_one({"key": "admin_password"})
    if doc and doc.get("value"):
        return str(doc["value"])
    return ADMIN_PASSWORD


def _hash_admin_password(plain: str) -> str:
    """Hash bcrypt cost 12."""
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def _is_bcrypt_hash(stored: str) -> bool:
    return isinstance(stored, str) and stored.startswith(("$2a$", "$2b$", "$2y$"))


async def verify_admin_password(plain: str) -> bool:
    """Accès libre à l'administration sans mot de passe."""
    return True



async def set_admin_password(new_password: str):
    """Enregistre un nouveau mot de passe admin (stocké sous forme de hash bcrypt)."""
    await db.admin_config.update_one(
        {"key": "admin_password"},
        {"$set": {
            "key": "admin_password",
            "value": _hash_admin_password(new_password),
            "updatedAt": datetime.utcnow().isoformat(),
        }},
        upsert=True,
    )


def generate_code() -> str:
    """Génère un code lisible : XXXX-XXXX-XXXX."""
    parts = []
    for _ in range(3):
        parts.append("".join(secrets.choice(CODE_ALPHABET) for _ in range(4)))
    return "-".join(parts)


# ===== BRUTE FORCE PROTECTION =====
# Politique :
#   - Auth utilisateur (validate-code)  : 6 échecs / 5min → lockout 10min, +20min, +60min, +24h
#   - Auth admin (login)                : 4 échecs / 5min → lockout 15min, +30min, +120min, +24h
#   - Délai artificiel constant (~250ms) sur chaque tentative pour ralentir le brute force
#   - Mémorisation par IP (X-Forwarded-For si derrière proxy)
#   - Comparaison constant-time pour le mot de passe admin

class RateLimiter:
    def __init__(self, window_seconds: int, max_attempts: int, lockouts: List[int]):
        self.window = window_seconds
        self.max_attempts = max_attempts
        # lockouts en secondes, escaladants. Ex: [600, 1200, 3600, 86400]
        self.lockouts = lockouts
        self._state: Dict[str, Dict[str, Any]] = defaultdict(
            lambda: {"attempts": [], "lockout_until": 0.0, "lockout_level": 0, "total_failed": 0}
        )
        self._lock = asyncio.Lock()

    async def check(self, key: str) -> Tuple[bool, float, int]:
        """Retourne (allowed, retry_after_seconds, remaining_attempts)."""
        async with self._lock:
            now = time.time()
            st = self._state[key]
            # Lockout actif ?
            if st["lockout_until"] > now:
                return False, st["lockout_until"] - now, 0
            # Nettoyage fenêtre glissante
            st["attempts"] = [t for t in st["attempts"] if t > now - self.window]
            remaining = max(0, self.max_attempts - len(st["attempts"]))
            return True, 0.0, remaining

    async def record_failure(self, key: str) -> Tuple[float, int]:
        """Enregistre un échec, retourne (retry_after, remaining)."""
        async with self._lock:
            now = time.time()
            st = self._state[key]
            st["attempts"] = [t for t in st["attempts"] if t > now - self.window]
            st["attempts"].append(now)
            st["total_failed"] += 1

            if len(st["attempts"]) >= self.max_attempts:
                # Lockout escalation
                level = min(st["lockout_level"], len(self.lockouts) - 1)
                duration = self.lockouts[level]
                st["lockout_until"] = now + duration
                st["lockout_level"] = min(st["lockout_level"] + 1, len(self.lockouts) - 1)
                st["attempts"] = []  # reset window
                return duration, 0
            remaining = max(0, self.max_attempts - len(st["attempts"]))
            return 0.0, remaining

    def get_state(self, key: str) -> Dict[str, Any]:
        """Retourne un snapshot lisible de l'état d'une IP (lecture seule)."""
        st = self._state.get(key)
        if not st:
            return {"total_failed": 0, "lockout_level": 0, "lockout_until": 0.0}
        return {
            "total_failed": st.get("total_failed", 0),
            "lockout_level": st.get("lockout_level", 0),
            "lockout_until": st.get("lockout_until", 0.0),
        }

    async def record_success(self, key: str):
        async with self._lock:
            # Soft reset : enlève la fenêtre, garde le niveau de lockout pour découragement
            if key in self._state:
                self._state[key]["attempts"] = []
                self._state[key]["lockout_until"] = 0.0
                # Diminue progressivement le niveau de lockout
                if self._state[key]["lockout_level"] > 0:
                    self._state[key]["lockout_level"] = max(0, self._state[key]["lockout_level"] - 1)


user_limiter = RateLimiter(window_seconds=300, max_attempts=6, lockouts=[600, 1200, 3600, 86400])
admin_limiter = RateLimiter(window_seconds=300, max_attempts=4, lockouts=[900, 1800, 7200, 86400])
trial_limiter = RateLimiter(window_seconds=3600, max_attempts=5, lockouts=[3600, 7200, 86400])  # 5/h par IP, lockout 1h


def get_client_ip(request: Optional[Request]) -> str:
    if not request:
        return "unknown"
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    real = request.headers.get("x-real-ip")
    if real:
        return real.strip()
    if request.client:
        return request.client.host or "unknown"
    return "unknown"


def fmt_duration(secs: float) -> str:
    s = int(secs)
    if s < 60:
        return f"{s}s"
    if s < 3600:
        m = s // 60
        return f"{m} min"
    if s < 86400:
        h = s // 3600
        m = (s % 3600) // 60
        return f"{h}h{m:02d}" if m else f"{h}h"
    d = s // 86400
    return f"{d}j"


async def enforce_rate_limit(limiter: RateLimiter, ip: str, scope: str):
    allowed, retry_after, remaining = await limiter.check(ip)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail={
                "error": f"Trop de tentatives ({scope}). Réessaie dans {fmt_duration(retry_after)}.",
                "retryAfter": int(retry_after),
                "scope": scope,
            },
        )


async def punish(limiter: RateLimiter, ip: str, base_status: int, base_msg: str, scope: str):
    retry_after, remaining = await limiter.record_failure(ip)
    # Délai artificiel constant pour ralentir
    await asyncio.sleep(0.25)
    if retry_after > 0:
        # Notification email (non bloquante, dédupée par notifications.on_ip_locked)
        try:
            state = limiter.get_state(ip)
            asyncio.create_task(on_ip_locked(
                db,
                ip=ip,
                scope=scope,
                duration_secs=int(retry_after),
                total_failed=int(state.get("total_failed", 0)),
                lockout_level=int(state.get("lockout_level", 0)),
                lockout_until_ts=float(state.get("lockout_until", 0.0)),
            ))
        except Exception as e:
            logging.getLogger(__name__).warning(f"on_ip_locked dispatch failed: {e}")
        raise HTTPException(
            status_code=429,
            detail={
                "error": f"Trop de tentatives ({scope}). Verrouillé pour {fmt_duration(retry_after)}.",
                "retryAfter": int(retry_after),
                "scope": scope,
            },
        )
    raise HTTPException(
        status_code=base_status,
        detail={"error": base_msg, "remaining": remaining, "scope": scope},
    )


async def require_admin(x_admin_password: Optional[str] = None):
    """Accès libre admin sans mot de passe."""
    return True

# Simple in-memory TTL cache
_CACHE: Dict[str, tuple] = {}
CACHE_TTL_SECS = 300  # 5 minutes


def cache_get(key: str):
    item = _CACHE.get(key)
    if not item:
        return None
    value, expires = item
    if time.time() > expires:
        _CACHE.pop(key, None)
        return None
    return value


def cache_set(key: str, value: Any, ttl: int = CACHE_TTL_SECS):
    _CACHE[key] = (value, time.time() + ttl)


# ---- Models ----
class StatusCheck(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class StatusCheckCreate(BaseModel):
    client_name: str


class ScrapePmuRequest(BaseModel):
    date: str
    reunion: str
    course: str
    withHistory: Optional[bool] = False
    forceRefresh: Optional[bool] = False


class SavePronosticRequest(BaseModel):
    date: str
    reunion: str
    course: str
    courseInfo: Optional[str] = ""
    cafs: List[int]
    classement: List[int]  # numéros par ordre CAF décroissant
    arrivee: List[int] = []
    tierceHits: int = 0
    top7Hits: int = 0
    grade: Optional[str] = None  # "A", "B", "C", "D", "E" — si "A" → notification email
    # Optionnel : détails du cheval Grade A pour broadcast utilisateurs
    gradeAHorseNum: Optional[int] = None
    gradeAHorseName: Optional[str] = None
    gradeAHorseCote: Optional[float] = None
    gradeAHorseReasons: Optional[List[str]] = None
    hippodrome: Optional[str] = None


@api_router.get("/")
async def root():
    return {"message": "Hello World"}


@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    status_dict = input.dict()
    status_obj = StatusCheck(**status_dict)
    _ = await db.status_checks.insert_one(status_obj.dict())
    return status_obj


@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    status_checks = await db.status_checks.find().to_list(1000)
    return [StatusCheck(**status_check) for status_check in status_checks]


# ---- PMU SCRAPER ----

async def fetch_all_histories(http: httpx.AsyncClient, date: str, reunion: str, course: str) -> Dict[int, List[Dict[str, Any]]]:
    """Récupère pour chaque participant ses 3 dernières courses avec :
    - place, partants, allocation
    - date (ms timestamp), dateIso (format jj/mm/aaaa), daysAgo (jours depuis la date du jour)
    - hippodrome, discipline, distance, nomPrix, etatTerrain
    - jockey/driver associé pour cette course
    """
    result: Dict[int, List[Dict[str, Any]]] = {}
    try:
        url = f"https://online.turfinfo.api.pmu.fr/rest/client/1/programme/{date}/{reunion}/{course}/performances-detaillees/pretty"
        res = await http.get(url, headers=PMU_HEADERS, timeout=20.0)
        if res.status_code != 200:
            return result
        data = res.json()
        participants = data.get("participants", []) or []
        today = datetime.utcnow()

        for part in participants:
            num_pmu = part.get("numPmu")
            nom = part.get("nomCheval") or part.get("nom")
            courses = list(part.get("coursesCourues", []) or [])
            courses.sort(key=lambda c: c.get("date") or 0, reverse=True)
            hist: List[Dict[str, Any]] = []
            for c in courses[:3]:
                # Cherche le cheval dans participants[] pour récupérer la place / driver
                me = None
                for x in (c.get("participants") or []):
                    if (x.get("nomCheval") or x.get("nom")) == nom:
                        me = x
                        break
                place_obj = (me or {}).get("place") or {}
                ts_ms = c.get("date") or 0
                date_iso = ""
                days_ago = None
                try:
                    if ts_ms:
                        d = datetime.utcfromtimestamp(int(ts_ms) / 1000)
                        date_iso = d.strftime("%d/%m/%Y")
                        days_ago = max(0, (today.date() - d.date()).days)
                except Exception:
                    pass
                hist.append({
                    "place": place_obj.get("place") or 0,
                    "partants": c.get("nbParticipants") or 0,
                    "allocation": c.get("allocation") or 0,
                    "date": ts_ms,
                    "dateIso": date_iso,
                    "daysAgo": days_ago,
                    "hippodrome": c.get("hippodrome") or "",
                    "discipline": c.get("discipline") or "",
                    "distance": c.get("distance") or 0,
                    "nomPrix": c.get("nomPrix") or "",
                    "etatTerrain": c.get("etatTerrain") or "",
                    "driver": (me or {}).get("nomJockey") or "",
                    "entraineur": (me or {}).get("nomEntraineur") or "",
                })
            if isinstance(num_pmu, int):
                result[num_pmu] = hist
    except Exception as e:
        logger = logging.getLogger(__name__)
        logger.warning(f"fetch_all_histories error: {e}")
    return result


async def fetch_arrivee(http: httpx.AsyncClient, date: str, reunion: str, course: str) -> List[int]:
    """Récupère l'arrivée officielle d'une course depuis rapports-definitifs.

    Format API PMU :
      [{ "typePari": "TIERCE", "rapports": [{"libelle":"Ordre","combinaison":"8-14-15"}, ...] }]
      [{ "typePari": "QUINTE_PLUS", "rapports": [{"libelle":"Ordre","combinaison":"8-14-15-6-2"}] }]
    On préfère QUINTE_PLUS (5 chevaux) > QUARTE_PLUS (4) > TIERCE (3) pour avoir le top le plus long.
    """
    def parse_combi(combi: Any) -> List[int]:
        """Convertit une combinaison en liste d'entiers."""
        if combi is None:
            return []
        if isinstance(combi, list):
            out = []
            for n in combi:
                try:
                    out.append(int(n))
                except Exception:
                    pass
            return out
        if isinstance(combi, str):
            # Formats possibles : "8-14-15-6-2" ou "8 14 15" ou "8/14/15"
            import re as _re
            tokens = _re.split(r"[-/\s,]+", combi.strip())
            out = []
            for t in tokens:
                t = t.strip()
                if t.isdigit():
                    out.append(int(t))
            return out
        return []

    def extract_from_rapport(r: Dict[str, Any]) -> List[int]:
        # 1) cherche dans rapports[].combinaison en privilégiant "Ordre"
        rapports = r.get("rapports") or []
        ordre = None
        desordre = None
        for rap in rapports:
            lib = (rap.get("libelle") or "").lower()
            combi = rap.get("combinaison")
            parsed = parse_combi(combi)
            if not parsed:
                continue
            if "ordre" in lib and "des" not in lib:  # "Ordre" mais pas "Désordre"
                ordre = parsed
            elif "des" in lib:
                desordre = parsed
            elif ordre is None:
                ordre = parsed
        if ordre:
            return ordre
        if desordre:
            return desordre
        # 2) fallback : combinaison directe au niveau du pari
        return parse_combi(r.get("combinaison"))

    try:
        url = f"https://online.turfinfo.api.pmu.fr/rest/client/1/programme/{date}/{reunion}/{course}/rapports-definitifs"
        res = await http.get(url, headers=PMU_HEADERS, timeout=20.0)
        if res.status_code != 200:
            return []
        data = res.json()
        list_data = data if isinstance(data, list) else (data or {}).get("rapportsDefinitifs", []) or []

        # Priorité aux paris les plus longs (5 > 4 > 3)
        priority_types = ["QUINTE_PLUS", "QUARTE_PLUS", "TIERCE"]
        for ptype in priority_types:
            for r in list_data:
                if r.get("typePari") == ptype:
                    out = extract_from_rapport(r)
                    if len(out) >= 3:
                        return out

        # Fallback : n'importe quel pari avec ≥3 partants identifiés
        for r in list_data:
            out = extract_from_rapport(r)
            if len(out) >= 3:
                return out
    except Exception as e:
        logger = logging.getLogger(__name__)
        logger.warning(f"fetch_arrivee error: {e}")
    return []


async def fetch_cotes(http: httpx.AsyncClient, date: str, reunion: str, course: str) -> Dict[int, float]:
    """Récupère les rapports probables (cotes) pour SIMPLE_GAGNANT.

    Format API PMU :
      { "rapportsParticipant": [ {"numPmu": 8, "rapportDirect": 19.0, "rapportReference": 24.0}, ... ] }
    Préfère rapportDirect (cote en cours), fallback rapportReference.
    """
    cotes: Dict[int, float] = {}
    try:
        url = f"https://online.turfinfo.api.pmu.fr/rest/client/1/programme/{date}/{reunion}/{course}/rapports/E_SIMPLE_GAGNANT"
        res = await http.get(url, headers=PMU_HEADERS, timeout=15.0)
        if res.status_code != 200:
            return cotes
        data = res.json()
        items = []
        if isinstance(data, dict):
            items = data.get("rapportsParticipant") or data.get("rapports") or []
        elif isinstance(data, list):
            items = data

        for r in items:
            num = r.get("numPmu")
            if num is None and isinstance(r.get("numerosParticipant"), list) and r["numerosParticipant"]:
                num = r["numerosParticipant"][0]
            cote = r.get("rapportDirect")
            if cote is None:
                cote = r.get("rapportReference")
            if cote is None:
                # ancien format
                d = r.get("dividendePourUnEuro") or r.get("dividende")
                if d is not None:
                    try:
                        cote = float(d) / 100.0
                    except Exception:
                        cote = None
            if num is not None and cote is not None:
                try:
                    cotes[int(num)] = float(cote)
                except Exception:
                    pass
    except Exception as e:
        logger = logging.getLogger(__name__)
        logger.warning(f"fetch_cotes error: {e}")
    return cotes


@api_router.post("/scrape-pmu")
async def scrape_pmu(req: ScrapePmuRequest):
    date = req.date
    reunion = req.reunion
    course = req.course
    if not date or not reunion or not course:
        raise HTTPException(status_code=400, detail="date, reunion, course required")

    cache_key = f"scrape:{date}:{reunion}:{course}:{int(bool(req.withHistory))}"
    if not req.forceRefresh:
        cached = cache_get(cache_key)
        if cached:
            return cached

    url = f"https://online.turfinfo.api.pmu.fr/rest/client/1/programme/{date}/{reunion}/{course}/participants"

    async with httpx.AsyncClient() as http:
        try:
            res = await http.get(url, headers=PMU_HEADERS, timeout=20.0)
        except Exception as e:
            return JSONResponse(status_code=500, content={"error": f"PMU fetch error: {e}"})

        if res.status_code != 200:
            text = res.text[:200] if res.text else ""
            return JSONResponse(
                status_code=res.status_code,
                content={"error": f"PMU {res.status_code}", "body": text},
            )

        try:
            data = res.json()
        except Exception:
            return JSONResponse(status_code=500, content={"error": "Invalid JSON from PMU"})

        if req.withHistory and isinstance(data.get("participants"), list):
            hist_map = await fetch_all_histories(http, date, reunion, course)
            for p in data["participants"]:
                num_pmu = p.get("numPmu")
                p["history"] = hist_map.get(num_pmu, []) if isinstance(num_pmu, int) else []

        # Cotes simple gagnant
        cotes = await fetch_cotes(http, date, reunion, course)
        if cotes and isinstance(data.get("participants"), list):
            for p in data["participants"]:
                num = p.get("numPmu")
                if isinstance(num, int) and num in cotes:
                    p["cote"] = cotes[num]

        # Détail course (distance, hippodrome, discipline, allocation) — nécessaire pour
        # l'onglet "Analyse pro" qui calcule Value, Distance, Hippodrome, Rang CAF.
        try:
            detail_url = f"https://online.turfinfo.api.pmu.fr/rest/client/1/programme/{date}/{reunion}/{course}"
            r_detail = await http.get(detail_url, headers=PMU_HEADERS, timeout=10.0)
            if r_detail.status_code == 200:
                detail = r_detail.json() or {}
                hippo = detail.get("hippodrome") or {}
                data["course"] = {
                    "distance": detail.get("distance"),
                    "distanceUnit": detail.get("distanceUnit"),
                    "discipline": detail.get("discipline"),
                    "specialite": detail.get("specialite"),
                    "montantPrix": detail.get("montantPrix"),
                    "libelle": detail.get("libelle"),
                    "libelleCourt": detail.get("libelleCourt"),
                    "parcours": detail.get("parcours"),
                    "corde": detail.get("corde"),
                    "heureDepart": detail.get("heureDepart"),
                }
                data["reunion"] = {
                    "hippodrome": {
                        "codeHippodrome": hippo.get("codeHippodrome"),
                        "libelleCourt": hippo.get("libelleCourt"),
                        "libelleLong": hippo.get("libelleLong"),
                    }
                }
        except Exception as e:
            logger.warning(f"scrape-pmu: course detail fetch failed: {e}")

        # Arrivée officielle (top 7 si dispo)
        arrivee = await fetch_arrivee(http, date, reunion, course)
        data["arrivee"] = arrivee

    # Cache (mais pas si arrivée non encore connue → ttl court)
    ttl = CACHE_TTL_SECS if arrivee else 30
    cache_set(cache_key, data, ttl=ttl)

    return data


@api_router.get("/programme/{date}")
async def get_programme(date: str):
    """Retourne la liste des réunions et courses du jour pour les dropdowns."""
    cache_key = f"prog:{date}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    url = f"https://online.turfinfo.api.pmu.fr/rest/client/1/programme/{date}"
    async with httpx.AsyncClient() as http:
        try:
            res = await http.get(url, headers=PMU_HEADERS, timeout=15.0)
        except Exception as e:
            return JSONResponse(status_code=500, content={"error": f"PMU fetch error: {e}"})

        if res.status_code != 200:
            return JSONResponse(status_code=res.status_code, content={"error": f"PMU {res.status_code}"})

        try:
            data = res.json()
        except Exception:
            return JSONResponse(status_code=500, content={"error": "Invalid JSON"})

        reunions = data.get("programme", {}).get("reunions") or data.get("reunions") or []
        out = []
        for r in reunions:
            num_off = r.get("numOfficiel") or r.get("numExterne") or r.get("numero")
            hippo = (r.get("hippodrome") or {}).get("libelleCourt") or (r.get("hippodrome") or {}).get("libelleLong") or ""
            courses_list = r.get("courses") or []
            cs = []
            for c in courses_list:
                cs.append({
                    "numero": c.get("numOrdre") or c.get("numExterne") or c.get("numero"),
                    "libelle": c.get("libelle") or c.get("libelleCourt") or "",
                    "discipline": c.get("discipline") or c.get("specialite") or "",
                    "distance": c.get("distance"),
                    "heureDepart": c.get("heureDepart"),
                    "nombrePartants": c.get("nombreDeclaresPartants") or c.get("nombrePartants"),
                    "statut": c.get("statut") or c.get("status") or "",
                })
            out.append({
                "reunion": f"R{num_off}" if num_off else "",
                "hippodrome": hippo,
                "courses": cs,
            })

    result = {"date": date, "reunions": out}
    cache_set(cache_key, result, ttl=120)
    return result


@api_router.get("/arrivees/{date}/{reunion}")
async def get_arrivees_reunion(date: str, reunion: str):
    """Retourne les arrivées de toutes les courses d'une réunion (léger).
    Cache court (30s) si arrivée non connue, plus long sinon."""
    cache_key = f"arrivees:{date}:{reunion}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    # 1) Récupère les courses du programme
    prog = await get_programme(date)
    if isinstance(prog, JSONResponse):
        return prog

    target = None
    for r in prog.get("reunions", []):
        if r.get("reunion", "").upper() == reunion.upper():
            target = r
            break
    if not target:
        return JSONResponse(status_code=404, content={"error": f"Réunion {reunion} introuvable"})

    courses_list = target.get("courses", [])
    out_courses = []

    async with httpx.AsyncClient() as http:
        for c in courses_list:
            num = c.get("numero")
            if not num:
                continue
            c_key = f"C{num}"
            arrivee = await fetch_arrivee(http, date, reunion, c_key)
            out_courses.append({
                "numero": num,
                "course": c_key,
                "libelle": c.get("libelle"),
                "discipline": c.get("discipline"),
                "distance": c.get("distance"),
                "heureDepart": c.get("heureDepart"),
                "nombrePartants": c.get("nombrePartants"),
                "arrivee": arrivee,
                "termine": len(arrivee) > 0,
            })

    result = {
        "date": date,
        "reunion": reunion,
        "hippodrome": target.get("hippodrome"),
        "courses": out_courses,
    }
    # Cache court si certaines courses ne sont pas terminées
    has_pending = any(not c["termine"] for c in out_courses)
    cache_set(cache_key, result, ttl=30 if has_pending else 600)
    return result


@api_router.post("/pronostics")
async def save_pronostic(req: SavePronosticRequest):
    doc = {
        "id": str(uuid.uuid4()),
        "date": req.date,
        "reunion": req.reunion,
        "course": req.course,
        "courseInfo": req.courseInfo,
        "cafs": req.cafs,
        "classement": req.classement,
        "arrivee": req.arrivee,
        "tierceHits": req.tierceHits,
        "top7Hits": req.top7Hits,
        "grade": (req.grade or "").upper() or None,
        "createdAt": datetime.utcnow().isoformat(),
    }
    await db.pronostics.insert_one(doc)
    doc.pop("_id", None)

    # Notification email si Grade A
    if doc.get("grade") == "A":
        asyncio.create_task(on_pronostic_grade_a(db, doc))
        # Broadcast aux utilisateurs si on a les détails du cheval
        if req.gradeAHorseNum and req.gradeAHorseName:
            asyncio.create_task(on_pronostic_grade_a_user_broadcast(
                db,
                course_label=req.courseInfo or f"R{req.reunion} C{req.course}",
                hippodrome=req.hippodrome or "?",
                horse_num=req.gradeAHorseNum,
                horse_name=req.gradeAHorseName,
                cote=req.gradeAHorseCote,
                reasons=req.gradeAHorseReasons or [],
            ))

    return {"ok": True, "id": doc["id"]}


@api_router.get("/pronostics")
async def list_pronostics(limit: int = 100):
    items = await db.pronostics.find().sort("createdAt", -1).to_list(limit)
    for item in items:
        item.pop("_id", None)
    return {"items": items}


@api_router.delete("/pronostics/{pid}")
async def delete_pronostic(pid: str):
    await db.pronostics.delete_one({"id": pid})
    return {"ok": True}


# ---- TRACKER DE PARIS RÉELS ----

class CreateBetRequest(BaseModel):
    date: str
    reunion: Optional[str] = ""
    course: Optional[str] = ""
    courseInfo: Optional[str] = ""
    typePari: str  # SIMPLE_GAGNANT, SIMPLE_PLACE, COUPLE_ORDRE, COUPLE, TIERCE_ORDRE, TIERCE, QUARTE_PLUS, QUINTE_PLUS, TRIO
    chevaux: List[int]  # numéros joués
    mise: float  # mise en €
    coteAffichee: Optional[float] = None  # cote au moment du pari (info)
    gainReel: Optional[float] = None  # 0 si perdu, montant si gagné
    statut: Optional[str] = "en_attente"  # en_attente, gagne, perdu
    notes: Optional[str] = ""


@api_router.post("/bets")
async def create_bet(req: CreateBetRequest):
    doc = {
        "id": str(uuid.uuid4()),
        "date": req.date,
        "reunion": req.reunion,
        "course": req.course,
        "courseInfo": req.courseInfo,
        "typePari": req.typePari,
        "chevaux": req.chevaux,
        "mise": float(req.mise),
        "coteAffichee": req.coteAffichee,
        "gainReel": req.gainReel,
        "statut": req.statut or "en_attente",
        "notes": req.notes or "",
        "createdAt": datetime.utcnow().isoformat(),
    }
    await db.bets.insert_one(doc)
    doc.pop("_id", None)
    return {"ok": True, "id": doc["id"]}


@api_router.get("/bets")
async def list_bets(limit: int = 500):
    items = await db.bets.find().sort("createdAt", -1).to_list(limit)
    for it in items:
        it.pop("_id", None)
    return {"items": items}


@api_router.patch("/bets/{bid}")
async def update_bet(bid: str, body: Dict[str, Any]):
    allowed = {}
    for k in ["statut", "gainReel", "notes", "mise"]:
        if k in body:
            allowed[k] = body[k]
    if not allowed:
        return {"ok": True, "updated": 0}

    # Snapshot avant pour détecter passage en "gagne"
    before = await db.bets.find_one({"id": bid})
    res = await db.bets.update_one({"id": bid}, {"$set": allowed})

    # Notification email si transition vers gagné
    if before and res.modified_count:
        was_won = (before.get("statut") == "gagne")
        will_be_won = (allowed.get("statut") == "gagne") if "statut" in allowed else was_won
        if not was_won and will_be_won:
            updated = {**before, **allowed}
            updated.pop("_id", None)
            asyncio.create_task(on_bet_won(db, updated))

    return {"ok": True, "updated": res.modified_count}


@api_router.delete("/bets/{bid}")
async def delete_bet(bid: str):
    await db.bets.delete_one({"id": bid})
    return {"ok": True}


# ---- ACCESS CODES (admin) ----

class CreateCodeRequest(BaseModel):
    label: Optional[str] = ""
    email: Optional[str] = ""  # email de l'abonné — reçoit les pronostics R1 quotidiens
    durationDays: Optional[int] = 30  # durée après 1ère utilisation
    expiresAt: Optional[str] = None  # ISO datetime, si fourni → mode fixe (date absolue)
    count: Optional[int] = 1
    maxUses: Optional[int] = 0  # 0 = illimité


class ValidateCodeRequest(BaseModel):
    code: str


class AdminLoginRequest(BaseModel):
    password: str


@api_router.post("/admin/login")
async def admin_login(req: AdminLoginRequest, request: Request):
    return {"ok": True, "adminToken": req.password or "free-admin"}


@api_router.post("/admin/reset-default-password")
async def reset_default_password():
    """Réinitialise le mot de passe admin à sa valeur par défaut wague-admin-2026"""
    await db.admin_config.delete_one({"key": "admin_password"})
    return {"ok": True, "message": "Mot de passe réinitialisé par défaut."}


class ChangeAdminPasswordRequest(BaseModel):
    currentPassword: str
    newPassword: str


@api_router.post("/admin/change-password")
async def change_admin_password(
    req: ChangeAdminPasswordRequest,
    request: Request,
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Change le mot de passe admin. Vérifie l'ancien + applique le nouveau.
    Le nouveau mot de passe est stocké en DB (admin_config) et prend le pas sur l'env."""
    ip = get_client_ip(request)
    await enforce_rate_limit(admin_limiter, ip, "admin")

    # Vérif token de session (header X-Admin-Password) — doit correspondre au MDP courant
    await require_admin(x_admin_password)

    # Vérif mot de passe actuel fourni dans le body (double vérification, constant-time via bcrypt)
    if not req.currentPassword or not await verify_admin_password(req.currentPassword):
        await punish(admin_limiter, ip, 401, "Mot de passe actuel incorrect", "admin")

    # Validation nouveau mot de passe
    new_pwd = (req.newPassword or "").strip()
    if len(new_pwd) < 8:
        raise HTTPException(status_code=400, detail="Le nouveau mot de passe doit contenir au moins 8 caractères")
    if await verify_admin_password(new_pwd):
        raise HTTPException(status_code=400, detail="Le nouveau mot de passe doit être différent de l'actuel")

    await set_admin_password(new_pwd)
    await admin_limiter.record_success(ip)
    await asyncio.sleep(0.25)

    # Notification email (non bloquante, toggle via env + event setting)
    ua = request.headers.get("user-agent", "—")
    email_result = await on_admin_password_changed(db, ip=ip, user_agent=ua)

    return {
        "ok": True,
        "adminToken": new_pwd,
        "message": "Mot de passe mis à jour",
        "notification": email_result,
    }


def _mask_email(email: str) -> str:
    if not email:
        return ""
    parts = email.split("@")
    if len(parts) != 2:
        return email
    local, domain = parts
    if len(local) <= 2:
        return "*" * len(local) + "@" + domain
    return local[0] + "*" * (len(local) - 2) + local[-1] + "@" + domain


@api_router.get("/admin/notifications/status")
async def notifications_status(
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Renvoie l'état global + settings par événement (merge avec défauts)."""
    await require_admin(x_admin_password)
    env = _email_env()
    settings = await get_notification_settings(db)
    return {
        "enabled": email_notifications_enabled(),
        "hasApiKey": bool(env["api_key"]),
        "hasRecipient": bool(env["recipient"]),
        "recipientMasked": _mask_email(env["recipient"]),
        "sender": env["sender"],
        "settings": settings,
        "defaults": NOTIF_DEFAULT_SETTINGS,
    }


@api_router.patch("/admin/notifications/settings")
async def update_notifications_settings(
    body: Dict[str, Any],
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Met à jour les toggles par événement (persisté en DB)."""
    await require_admin(x_admin_password)
    updated = await update_notification_settings(db, body or {})
    return {"ok": True, "settings": updated}


@api_router.post("/admin/notifications/test")
async def notifications_test(
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Envoie un email de test pour vérifier la config Resend."""
    await require_admin(x_admin_password)
    if not email_notifications_enabled():
        return {
            "ok": False,
            "error": "Notifications désactivées. Définis RESEND_API_KEY et ADMIN_NOTIFICATION_EMAIL dans le .env backend.",
        }
    return await send_config_test(db=db, label="UI test button")


@api_router.post("/admin/notifications/digest/daily")
async def trigger_daily_digest(
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Déclenche manuellement le digest quotidien (aussi appelé par scheduler)."""
    await require_admin(x_admin_password)
    result = await send_daily_digest(db)
    await log_digest_run(db, "daily_digest", result, trigger="manual")
    return result


@api_router.post("/admin/notifications/digest/weekly")
async def trigger_weekly_digest(
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Déclenche manuellement le digest hebdomadaire."""
    await require_admin(x_admin_password)
    result = await send_weekly_digest(db)
    await log_digest_run(db, "weekly_digest", result, trigger="manual")
    return result


async def _fetch_course_data(kind: str, *args):
    """Callback pour notifications.send_daily_r1_pronostics — évite import circulaire.

    kind='programme' → args=(date,) retourne dict programme
    kind='scrape'    → args=(date, reunion, course) retourne dict course scrapée complète
    """
    if kind == "programme":
        return await get_programme(args[0])
    if kind == "scrape":
        date_, reunion, course = args
        return await scrape_pmu(ScrapePmuRequest(date=date_, reunion=reunion, course=course, withHistory=True))
    raise ValueError(f"unknown fetch kind: {kind}")


# Verrou global pour empêcher les bulk sends simultanés (anti rate-limit Resend 5/sec)
_bulk_send_lock = asyncio.Lock()


def _spawn_r1_bulk_send(trigger_label: str, target_email: Optional[str] = None) -> None:
    """Lance send_daily_r1_pronostics en tâche de fond (fire-and-forget) pour
    éviter les timeouts ingress Kubernetes (~30-60s) sur les bulks de 10+ destinataires.

    Tous les endpoints admin qui envoient un digest R1 à plusieurs personnes DOIVENT
    utiliser ce helper plutôt que `await send_daily_r1_pronostics(...)`.

    Met à jour `db.bulk_send_state` (doc `_id="current"`) pour permettre au live
    status badge frontend (GET /api/admin/digest-runs/latest) de poll en temps réel.

    PROTECTION RATE LIMIT RESEND : on utilise un asyncio.Lock module-level pour
    garantir qu'UN SEUL bulk send tourne à la fois. Sinon plusieurs spawns
    simultanés (ex: clics multiples) dépassent la limite de 5 req/sec de Resend
    → erreurs 429 "Too many requests".

    Args:
        trigger_label: label loggé dans digest_runs (manual, manual_bulk_bg, etc.)
        target_email: si fourni, n'envoie qu'à ce destinataire (filtre recipients)
    """
    started_at = datetime.now(timezone.utc).isoformat()

    async def _runner():
        # Verrou global : si un bulk tourne déjà, on attend (jamais 2 simultanés)
        if _bulk_send_lock.locked():
            logger.warning(
                f"[bg-send {trigger_label}] another bulk is in progress — waiting for lock"
            )
        async with _bulk_send_lock:
            # Marque l'état "active" pour le polling frontend
            try:
                await db.bulk_send_state.update_one(
                    {"_id": "current"},
                    {"$set": {
                        "active": True,
                        "trigger": trigger_label,
                        "startedAt": started_at,
                        "completedAt": None,
                        "ok": None,
                        "sent": None,
                        "errors": None,
                        "targetEmail": target_email,
                    }},
                    upsert=True,
                )
            except Exception:
                pass
            try:
                result = await send_daily_r1_pronostics(
                    db, _fetch_course_data, target_email=target_email
                )
                await log_digest_run(db, "r1_pronostics", result, trigger=trigger_label)
                logger.info(
                    f"[bg-send {trigger_label}] sent={result.get('sent', 0)} "
                    f"sent_trials={result.get('sent_trials', 0)} "
                    f"errors={len(result.get('errors', []))}"
                )
                try:
                    await db.bulk_send_state.update_one(
                        {"_id": "current"},
                        {"$set": {
                            "active": False,
                            "completedAt": datetime.now(timezone.utc).isoformat(),
                            "ok": bool(result.get("ok", False)),
                            "sent": int(result.get("sent", 0)),
                            "sentTrials": int(result.get("sent_trials", 0)),
                            "recipientsCount": int(result.get("recipients_count", 0)),
                            "errors": len(result.get("errors", [])),
                            "hippodrome": result.get("hippodrome"),
                        }},
                    )
                except Exception:
                    pass
            except Exception as e:
                logger.exception(f"[bg-send {trigger_label}] failed: {e}")
                try:
                    await log_digest_run(
                        db, "r1_pronostics",
                        {"ok": False, "error": str(e), "sent": 0},
                        trigger=f"{trigger_label}_failed",
                    )
                    await db.bulk_send_state.update_one(
                        {"_id": "current"},
                        {"$set": {
                            "active": False,
                            "completedAt": datetime.now(timezone.utc).isoformat(),
                            "ok": False,
                            "errors": 1,
                            "errorMessage": str(e)[:200],
                        }},
                    )
                except Exception:
                    pass

    asyncio.create_task(_runner())


@api_router.get("/admin/digest-runs/latest")
async def admin_digest_runs_latest(
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Retourne l'état du dernier envoi R1 — pour le live status badge admin.

    Combine 2 sources :
      - `bulk_send_state` (doc `_id="current"`) : état du spawn fire-and-forget en cours
        ou tout juste terminé (active, startedAt, completedAt, sent, errors)
      - `email_log` : compte temps-réel des emails effectivement envoyés depuis startedAt
        (permet d'afficher "4/10 envoyés..." pendant que la tâche tourne)
      - `digest_runs` : dernier run loggé (history)

    Réponse :
      {
        active: bool,                # tâche en cours ?
        trigger: str|null,
        startedAt: ISO8601|null,
        completedAt: ISO8601|null,
        ok: bool|null,
        sent: int|null,              # final (après completion)
        sentLive: int,               # temps-réel (count email_log >= startedAt)
        errorsLive: int,
        recentRecipients: [str],     # 5 derniers destinataires envoyés
        latestRun: {...} | null      # dernier digest_run loggé
      }
    """
    await require_admin(x_admin_password)
    state = await db.bulk_send_state.find_one({"_id": "current"}) or {}
    started_at = state.get("startedAt")
    sent_live = 0
    errors_live = 0
    recent_recipients: List[str] = []
    if started_at:
        # Compte les emails effectivement envoyés depuis le début du spawn
        cursor = db.email_log.find(
            {"sentAt": {"$gte": started_at}},
            {"_id": 0, "recipient": 1, "status": 1, "sentAt": 1},
        ).sort("sentAt", -1).limit(50)
        async for doc in cursor:
            if doc.get("status") == "ok":
                sent_live += 1
                if len(recent_recipients) < 5:
                    recent_recipients.append(doc.get("recipient", ""))
            else:
                errors_live += 1

    latest_run_doc = await db.digest_runs.find_one(
        {"jobName": "r1_pronostics"},
        {"_id": 0},
        sort=[("runAt", -1)],
    )
    return {
        "active": bool(state.get("active", False)),
        "trigger": state.get("trigger"),
        "startedAt": started_at,
        "completedAt": state.get("completedAt"),
        "ok": state.get("ok"),
        "sent": state.get("sent"),
        "sentTrials": state.get("sentTrials"),
        "recipientsCount": state.get("recipientsCount"),
        "errors": state.get("errors"),
        "hippodrome": state.get("hippodrome"),
        "errorMessage": state.get("errorMessage"),
        "sentLive": sent_live,
        "errorsLive": errors_live,
        "recentRecipients": recent_recipients,
        "latestRun": latest_run_doc,
    }


@api_router.get("/admin/email-log")
async def admin_email_log(
    limit: int = 50,
    status: Optional[str] = None,
    since_hours: int = 24,
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Audit trail des envois email — pour diagnostiquer les échecs Resend.

    Query params:
      - limit (default 50, max 500)
      - status: filtre 'ok' | 'failed' | None (tous)
      - since_hours: fenêtre temporelle (default 24h)

    Réponse :
      {
        items: [{sentAt, status, recipient, subject, error, email_id}],
        total, okCount, failedCount,
        errorSummary: {<error_message>: count, ...}  # top 5 erreurs
      }
    """
    await require_admin(x_admin_password)
    limit = max(1, min(500, limit))
    try:
        from zoneinfo import ZoneInfo  # noqa: F401
    except Exception:
        pass
    since = (datetime.now(timezone.utc) - timedelta(hours=since_hours)).isoformat()
    q: Dict[str, Any] = {"sentAt": {"$gte": since}}
    if status:
        q["status"] = status

    cursor = db.email_log.find(q, {"_id": 0}).sort("sentAt", -1).limit(limit)
    items = []
    async for doc in cursor:
        items.append(doc)

    # Stats agrégées sur la fenêtre complète (ignore limit)
    ok_count = await db.email_log.count_documents({**q, "status": "ok"})
    failed_count = await db.email_log.count_documents({**q, "status": "failed"})

    # Top 5 erreurs
    error_summary: Dict[str, int] = {}
    cursor_err = db.email_log.find(
        {**q, "status": "failed"}, {"_id": 0, "error": 1}
    ).limit(200)
    async for doc in cursor_err:
        err = (doc.get("error") or "unknown")[:100]
        error_summary[err] = error_summary.get(err, 0) + 1
    top_errors = dict(sorted(error_summary.items(), key=lambda x: -x[1])[:5])

    return {
        "items": items,
        "total": ok_count + failed_count,
        "okCount": ok_count,
        "failedCount": failed_count,
        "sinceHours": since_hours,
        "errorSummary": top_errors,
    }


@api_router.get("/admin/send-mode")
async def admin_send_mode(
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Retourne le statut du mode d'envoi (auto vs admin-manuel uniquement).

    Quand ADMIN_MANUAL_ONLY=true :
      - Tous les CRON automatiques sont désactivés (APScheduler + /cron/*)
      - Seuls les boutons admin manuels peuvent envoyer des emails
      - Le quota Resend (100/jour gratuit) est préservé pour les envois contrôlés
    """
    await require_admin(x_admin_password)
    manual_only = os.environ.get("ADMIN_MANUAL_ONLY", "").strip().lower() in ("true", "1", "yes")
    return {
        "adminManualOnly": manual_only,
        "cronEnabled": not manual_only,
        "schedulerEnabled": not manual_only,
        "hint": (
            "Mode ADMIN MANUEL activé : seul l'admin peut envoyer des emails via l'UI."
            if manual_only
            else "Mode AUTO : les CRON (08h Paris R1, 10h Trial Followup, 09h30 Code Expiring) sont actifs."
        ),
    }


# ===== Gestion RESEND_API_KEY runtime (override MongoDB sans redéploiement) =====

def _mask_api_key(key: Optional[str]) -> str:
    """Masque une clé API pour affichage sûr (ex: 're_f8Li...pQk')."""
    if not key:
        return ""
    k = key.strip()
    if len(k) <= 10:
        return "***"
    return f"{k[:7]}***{k[-4:]}"


@api_router.get("/admin/secrets/resend-api-key")
async def admin_get_resend_key(
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Retourne un preview masqué de la clé Resend active + sa source (env ou db)."""
    await require_admin(x_admin_password)
    # Lazy load runtime override
    from notifications import _load_runtime_secrets, _env
    api_key_override = await _load_runtime_secrets(db)
    env = _env(api_key_override)
    env_raw = os.environ.get("RESEND_API_KEY", "").strip()
    db_doc = await db.app_secrets.find_one({"_id": "resend_api_key"})
    db_raw = (db_doc.get("value") or "").strip() if db_doc else ""

    active_source = "db" if db_raw else ("env" if env_raw else "none")
    return {
        "activeSource": active_source,
        "activeKeyMasked": _mask_api_key(env["api_key"]),
        "envKeyMasked": _mask_api_key(env_raw),
        "envKeyPresent": bool(env_raw),
        "dbKeyMasked": _mask_api_key(db_raw),
        "dbKeyPresent": bool(db_raw),
        "dbKeyUpdatedAt": (db_doc or {}).get("updatedAt"),
        "dbKeyUpdatedBy": (db_doc or {}).get("updatedBy"),
        "hint": (
            "La clé MongoDB (db) prend priorité sur la clé .env. "
            "Modifie-la ici pour corriger un souci Resend sans redéployer."
        ),
    }


@api_router.post("/admin/secrets/resend-api-key")
async def admin_set_resend_key(
    body: Dict[str, Any],
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Stocke une nouvelle clé Resend en MongoDB (override).

    Body: {"apiKey": "re_xxx..."}  — ou  {"apiKey": ""} pour retirer l'override
    (retombe alors sur la clé .env).

    Validations :
      - La clé doit commencer par "re_" (format Resend)
      - Longueur min 20 caractères
      - Sinon HTTP 400 avec message explicite
    """
    await require_admin(x_admin_password)
    api_key = (body.get("apiKey") or "").strip()

    if api_key:
        if not api_key.startswith("re_"):
            raise HTTPException(status_code=400, detail="La clé doit commencer par 're_'")
        if len(api_key) < 20:
            raise HTTPException(status_code=400, detail="Clé trop courte (min 20 caractères)")

    now_iso = datetime.now(timezone.utc).isoformat()
    if api_key:
        await db.app_secrets.update_one(
            {"_id": "resend_api_key"},
            {"$set": {
                "value": api_key,
                "updatedAt": now_iso,
                "updatedBy": "admin_ui",
            }},
            upsert=True,
        )
        action = "saved"
    else:
        await db.app_secrets.delete_one({"_id": "resend_api_key"})
        action = "removed"

    # Invalide le cache (no-op désormais — lecture systématique MongoDB)
    from notifications import _invalidate_runtime_secrets_cache, _load_runtime_secrets, _env
    _invalidate_runtime_secrets_cache()
    api_key_override = await _load_runtime_secrets(db)
    env = _env(api_key_override)

    return {
        "ok": True,
        "action": action,
        "activeKeyMasked": _mask_api_key(env["api_key"]),
        "activeSource": "db" if api_key else ("env" if os.environ.get("RESEND_API_KEY") else "none"),
        "message": (
            "Clé Resend mise à jour — effective immédiatement pour le prochain envoi."
            if api_key
            else "Override MongoDB supprimé — la clé .env est de nouveau utilisée."
        ),
    }


class ResendTestRequest(BaseModel):
    email: str


@api_router.post("/admin/secrets/resend-api-key/test")
async def admin_test_resend_key(
    req: ResendTestRequest,
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Envoie un email de test avec la clé Resend active pour valider la config.

    Utile pour tester immédiatement après avoir changé la clé.
    Body: {"email": "destination@example.com"}
    """
    await require_admin(x_admin_password)
    email = (req.email or "").strip()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Email invalide")

    # Test direct sans fallback : on veut savoir si la clé Resend marche, pas Brevo
    from notifications import _send_via_resend, _load_runtime_secrets, _load_resend_sender_email
    api_key = await _load_runtime_secrets(db) or (os.environ.get("RESEND_API_KEY") or "").strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="Aucune clé Resend configurée")
    sender = await _load_resend_sender_email(db)

    subject = "TURFEX · Test de configuration Resend"
    html = f"""<!DOCTYPE html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif; padding:24px; background:#f4f4f5;">
<div style="max-width:520px; margin:0 auto; background:#fff; border:2px solid #111; border-radius:8px; padding:24px;">
  <h2 style="margin:0 0 12px; color:#111;">✅ Configuration Resend OK</h2>
  <p>Cet email confirme que ta clé Resend est bien active et que les envois fonctionnent.</p>
  <p style="font-size:12px; color:#64748b; margin-top:20px;">
    TURFEX · test envoyé depuis l'admin · {datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")}
  </p>
</div>
</body></html>"""

    result = await _send_via_resend(email, subject, html, api_key, sender)
    return {
        "ok": bool(result.get("ok")),
        "email": email,
        "id": result.get("id"),
        "error": result.get("error"),
        "provider": "resend",
    }


class ResendSenderEmailRequest(BaseModel):
    senderEmail: str


@api_router.get("/admin/secrets/resend-sender-email")
async def get_resend_sender_email_status(
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Statut de l'expéditeur Resend (SENDER_EMAIL) : source DB|env, valeur active."""
    await require_admin(x_admin_password)
    env_val = (os.environ.get("SENDER_EMAIL") or "").strip()
    db_doc = await db.app_secrets.find_one({"_id": "resend_sender_email"})
    db_val = (db_doc.get("value") if db_doc else "") or ""
    db_val = db_val.strip()
    active = db_val or env_val or "onboarding@resend.dev"
    source = "db" if db_val else ("env" if env_val else "default")
    return {
        "activeSource": source,
        "activeValue": active,
        "envValue": env_val or None,
        "dbValue": db_val or None,
        "dbValueUpdatedAt": (db_doc or {}).get("updatedAt"),
        "dbValueUpdatedBy": (db_doc or {}).get("updatedBy"),
        "hint": "L'expéditeur Resend doit utiliser un domaine vérifié sur le compte Resend. La valeur DB prend priorité sur le .env.",
    }


@api_router.post("/admin/secrets/resend-sender-email")
async def set_resend_sender_email(
    req: ResendSenderEmailRequest,
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Upsert l'expéditeur Resend en DB. senderEmail="" supprime l'override."""
    await require_admin(x_admin_password)
    val = (req.senderEmail or "").strip()
    if val == "":
        await db.app_secrets.delete_one({"_id": "resend_sender_email"})
        return {"ok": True, "action": "removed", "message": "Override DB supprimé — la valeur .env est de nouveau utilisée."}
    if "@" not in val or "." not in val.split("@")[-1]:
        raise HTTPException(status_code=400, detail="Adresse email invalide")
    await db.app_secrets.update_one(
        {"_id": "resend_sender_email"},
        {"$set": {
            "value": val,
            "updatedAt": datetime.now(timezone.utc).isoformat(),
            "updatedBy": "admin_ui",
        }},
        upsert=True,
    )
    return {
        "ok": True,
        "action": "saved",
        "activeValue": val,
        "activeSource": "db",
        "message": "Expéditeur Resend mis à jour — effectif immédiatement pour le prochain envoi.",
    }




# ============================================================================
# BREVO INTEGRATION (admin) — clé API + provider switcher + senders/domains
# Doc Brevo : https://developers.brevo.com/reference/sendtransacemail
# ============================================================================
BREVO_API_BASE = "https://api.brevo.com/v3"


class BrevoApiKeyRequest(BaseModel):
    apiKey: str


class BrevoTestRequest(BaseModel):
    email: str


class EmailProviderConfigRequest(BaseModel):
    email_provider: Optional[str] = None  # "resend" | "brevo"
    email_fallback_enabled: Optional[bool] = None
    brevo_sender_email: Optional[str] = None
    brevo_sender_name: Optional[str] = None


async def _brevo_active_key() -> str:
    """Retourne la clé Brevo active (DB > env). Lève 400 si absente."""
    from notifications import _load_brevo_api_key
    key = await _load_brevo_api_key(db)
    if not key:
        raise HTTPException(status_code=400, detail="Aucune clé Brevo configurée (ni DB ni .env)")
    return key


def _brevo_headers(api_key: str) -> Dict[str, str]:
    return {"api-key": api_key, "Content-Type": "application/json", "Accept": "application/json"}


def _mask_key(key: str) -> str:
    if not key or len(key) < 12:
        return "***"
    return f"{key[:7]}***{key[-4:]}"


@api_router.get("/admin/secrets/brevo-api-key")
async def get_brevo_key_status(
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Statut de la clé Brevo : source active (db|env|none), masquée."""
    await require_admin(x_admin_password)
    env_key = (os.environ.get("BREVO_API_KEY") or "").strip()
    db_doc = await db.app_secrets.find_one({"_id": "brevo_api_key"})
    db_key = (db_doc.get("value") if db_doc else "") or ""
    db_key = db_key.strip()
    active = db_key or env_key
    source = "db" if db_key else ("env" if env_key else "none")
    return {
        "activeSource": source,
        "activeKeyMasked": _mask_key(active) if active else None,
        "envKeyPresent": bool(env_key),
        "envKeyMasked": _mask_key(env_key) if env_key else None,
        "dbKeyPresent": bool(db_key),
        "dbKeyMasked": _mask_key(db_key) if db_key else None,
        "dbKeyUpdatedAt": (db_doc or {}).get("updatedAt"),
        "dbKeyUpdatedBy": (db_doc or {}).get("updatedBy"),
        "hint": "La clé MongoDB (db) prend priorité sur la clé .env. Brevo offre 300 emails/jour gratuits.",
    }


@api_router.post("/admin/secrets/brevo-api-key")
async def set_brevo_key(
    req: BrevoApiKeyRequest,
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Upsert la clé Brevo en DB. apiKey="" supprime l'override."""
    await require_admin(x_admin_password)
    key = (req.apiKey or "").strip()
    if key == "":
        await db.app_secrets.delete_one({"_id": "brevo_api_key"})
        return {"ok": True, "message": "Override Brevo retiré (retour sur .env)", "activeSource": "env" if os.environ.get("BREVO_API_KEY") else "none"}
    if not key.startswith("xkeysib-") or len(key) < 30:
        raise HTTPException(status_code=400, detail="Format invalide : la clé Brevo doit commencer par 'xkeysib-'")
    await db.app_secrets.update_one(
        {"_id": "brevo_api_key"},
        {"$set": {
            "value": key,
            "updatedAt": datetime.now(timezone.utc).isoformat(),
            "updatedBy": "admin_ui",
        }},
        upsert=True,
    )
    return {
        "ok": True,
        "message": "Clé Brevo enregistrée",
        "activeSource": "db",
        "activeKeyMasked": _mask_key(key),
    }


@api_router.post("/admin/secrets/brevo-api-key/test")
async def admin_test_brevo_key(
    req: BrevoTestRequest,
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Envoie un email de test via Brevo (force le provider, ignore le switch)."""
    await require_admin(x_admin_password)
    email = (req.email or "").strip()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Email invalide")
    from notifications import _send_via_brevo, _load_brevo_api_key, get_settings as _get_set
    api_key = await _load_brevo_api_key(db)
    if not api_key:
        raise HTTPException(status_code=400, detail="Aucune clé Brevo configurée")
    settings = await _get_set(db)
    sender_email = settings.get("brevo_sender_email") or "noreply@turfex.fr"
    sender_name = settings.get("brevo_sender_name") or "TURFEX"
    subject = "TURFEX · Test de configuration Brevo"
    html = f"""<!DOCTYPE html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif; padding:24px; background:#f4f4f5;">
<div style="max-width:520px; margin:0 auto; background:#fff; border:2px solid #111; border-radius:8px; padding:24px;">
  <h2 style="margin:0 0 12px; color:#111;">✅ Configuration Brevo OK</h2>
  <p>Cet email confirme que ta clé Brevo est bien active et que les envois fonctionnent.</p>
  <p style="font-size:12px; color:#64748b; margin-top:20px;">
    TURFEX · test Brevo envoyé depuis l'admin · {datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")}
  </p>
</div>
</body></html>"""
    result = await _send_via_brevo(email, subject, html, api_key, sender_email, sender_name)
    return {
        "ok": bool(result.get("ok")),
        "email": email,
        "id": result.get("id"),
        "error": result.get("error"),
        "provider": "brevo",
    }


@api_router.get("/admin/brevo/senders")
async def list_brevo_senders(
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Liste les expéditeurs configurés sur le compte Brevo."""
    await require_admin(x_admin_password)
    api_key = await _brevo_active_key()
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(f"{BREVO_API_BASE}/senders", headers=_brevo_headers(api_key))
    if r.status_code >= 400:
        try:
            err = r.json()
        except Exception:
            err = {"message": r.text}
        raise HTTPException(status_code=r.status_code, detail=err.get("message") or "Brevo API error")
    data = r.json() or {}
    return {"ok": True, "senders": data.get("senders", []), "count": len(data.get("senders", []))}


@api_router.get("/admin/brevo/domains")
async def list_brevo_domains(
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Liste les domaines authentifiés sur le compte Brevo."""
    await require_admin(x_admin_password)
    api_key = await _brevo_active_key()
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(f"{BREVO_API_BASE}/senders/domains", headers=_brevo_headers(api_key))
    if r.status_code >= 400:
        try:
            err = r.json()
        except Exception:
            err = {"message": r.text}
        raise HTTPException(status_code=r.status_code, detail=err.get("message") or "Brevo API error")
    data = r.json() or {}
    return {"ok": True, "domains": data.get("domains", []), "count": data.get("count", len(data.get("domains", [])))}


@api_router.get("/admin/brevo/account")
async def get_brevo_account(
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Détails du compte Brevo : email owner, plan, crédits restants."""
    await require_admin(x_admin_password)
    api_key = await _brevo_active_key()
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(f"{BREVO_API_BASE}/account", headers=_brevo_headers(api_key))
    if r.status_code >= 400:
        try:
            err = r.json()
        except Exception:
            err = {"message": r.text}
        raise HTTPException(status_code=r.status_code, detail=err.get("message") or "Brevo API error")
    return {"ok": True, "account": r.json()}


@api_router.get("/admin/email-provider")
async def get_email_provider_config(
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Config switcher de provider email (resend|brevo) + fallback."""
    await require_admin(x_admin_password)
    settings = await get_notification_settings(db)
    return {
        "email_provider": settings.get("email_provider", "resend"),
        "email_fallback_enabled": settings.get("email_fallback_enabled", True),
        "brevo_sender_email": settings.get("brevo_sender_email") or "noreply@turfex.fr",
        "brevo_sender_name": settings.get("brevo_sender_name") or "TURFEX",
    }


@api_router.patch("/admin/email-provider")
async def update_email_provider_config(
    req: EmailProviderConfigRequest,
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Met à jour la config provider email."""
    await require_admin(x_admin_password)
    patch: Dict[str, Any] = {}
    if req.email_provider is not None:
        prov = (req.email_provider or "").lower().strip()
        if prov not in ("resend", "brevo"):
            raise HTTPException(status_code=400, detail="email_provider doit être 'resend' ou 'brevo'")
        patch["email_provider"] = prov
    if req.email_fallback_enabled is not None:
        patch["email_fallback_enabled"] = bool(req.email_fallback_enabled)
    if req.brevo_sender_email is not None:
        em = (req.brevo_sender_email or "").strip()
        if em and "@" not in em:
            raise HTTPException(status_code=400, detail="brevo_sender_email invalide")
        patch["brevo_sender_email"] = em
    if req.brevo_sender_name is not None:
        patch["brevo_sender_name"] = (req.brevo_sender_name or "").strip()
    if not patch:
        raise HTTPException(status_code=400, detail="Aucun champ à modifier")
    new_settings = await update_notification_settings(db, patch)
    return {
        "ok": True,
        "email_provider": new_settings.get("email_provider"),
        "email_fallback_enabled": new_settings.get("email_fallback_enabled"),
        "brevo_sender_email": new_settings.get("brevo_sender_email"),
        "brevo_sender_name": new_settings.get("brevo_sender_name"),
    }



# ============================================================================
# MAKETOU PAYMENT INTEGRATION
# ============================================================================
class MaketouCheckoutRequest(BaseModel):
    plan: str  # "1m" | "3m" | "1y"
    email: str
    firstName: str
    lastName: str
    phone: Optional[str] = None
    meta: Optional[Dict[str, Any]] = None


class PaymentProvidersConfigRequest(BaseModel):
    providers: List[str]  # ex: ["chariow"], ["maketou"], ["chariow","maketou"]


@api_router.get("/payment/providers")
async def get_payment_providers():
    """Liste publique : quels providers de paiement afficher sur le site + URLs Chariow par plan."""
    settings = await get_notification_settings(db)
    providers = settings.get("payment_providers") or ["chariow", "maketou"]
    # Filtre les valeurs invalides
    valid = [p for p in providers if p in ("chariow", "maketou")]
    if not valid:
        valid = ["chariow"]

    # Charge les URLs Chariow (DB > defaults). Affichées seulement si "chariow" actif.
    chariow_urls = {}
    if "chariow" in valid:
        defaults = {
            "1m": "https://ygsftwvy.mychariow.shop/prd_dh34ze",
            "3m": "https://ygsftwvy.mychariow.shop/prd_sqrv2z",
            "1y": "https://ygsftwvy.mychariow.shop/prd_bquicp",
        }
        for plan_key, default_url in defaults.items():
            doc = await db.app_secrets.find_one({"_id": f"chariow_url_{plan_key}"})
            chariow_urls[plan_key] = ((doc or {}).get("value") or default_url).strip()

    return {
        "providers": valid,
        "plans": [
            {"key": "1m", "label": "1 mois", "price": 30, "discount": 0, "monthly": 30.00},
            {"key": "3m", "label": "3 mois", "price": 80, "discount": 10, "monthly": 26.67},
            {"key": "1y", "label": "1 an", "price": 260, "discount": 100, "monthly": 21.67},
        ],
        "chariowUrls": chariow_urls,
    }


@api_router.post("/payment/maketou/checkout")
async def create_maketou_checkout(req: MaketouCheckoutRequest, request: Request):
    """Crée un panier Maketou et retourne l'URL du checkout (publique, utilisée par le site)."""
    from maketou import create_checkout, PLANS
    if req.plan not in PLANS:
        raise HTTPException(status_code=400, detail=f"Plan invalide. Doit être : {list(PLANS.keys())}")
    if not req.email or "@" not in req.email:
        raise HTTPException(status_code=400, detail="Email invalide")
    if not req.firstName.strip() or not req.lastName.strip():
        raise HTTPException(status_code=400, detail="Prénom et nom requis")

    # Construit la redirect URL absolue : on utilise le Origin/Referer du client
    origin = request.headers.get("origin") or request.headers.get("referer") or "https://turfex.fr"
    origin = origin.rstrip("/")
    redirect_url = f"{origin}/payment-success?provider=maketou"

    meta = dict(req.meta or {})
    meta["plan"] = req.plan
    meta["price"] = PLANS[req.plan]["price"]
    meta["source"] = "turfex_site"

    result = await create_checkout(
        db,
        plan_key=req.plan,
        email=req.email,
        first_name=req.firstName,
        last_name=req.lastName,
        redirect_url=redirect_url,
        phone=req.phone,
        meta=meta,
    )
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("error") or "Maketou checkout failed")

    # Persiste le panier en DB pour audit + activation auto au retour
    await db.maketou_carts.insert_one({
        "id": result["cartId"],
        "plan": req.plan,
        "price": PLANS[req.plan]["price"],
        "email": req.email,
        "firstName": req.firstName,
        "lastName": req.lastName,
        "redirectUrl": result.get("redirectUrl"),
        "status": "waiting_payment",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "meta": meta,
    })
    return {"ok": True, "cartId": result["cartId"], "redirectUrl": result["redirectUrl"]}


PLAN_DURATION_DAYS = {"1m": 30, "3m": 90, "1y": 365}


async def _maketou_provision_access_code(cart_doc: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Génère (ou retourne s'il existe déjà) un code d'accès pour un panier Maketou complété.

    Idempotent : si `cart_doc.accessCodeId` existe, retourne le code associé.
    Sinon génère un nouveau code (mode fixed, durée selon le plan), envoie l'email
    "code activé" + persiste l'ID dans le panier.
    """
    cart_id = cart_doc.get("id")
    plan = cart_doc.get("plan") or "1m"
    duration = PLAN_DURATION_DAYS.get(plan, 30)
    email = (cart_doc.get("email") or "").strip().lower()

    # Si déjà provisionné, retourne le code existant
    existing_id = cart_doc.get("accessCodeId")
    if existing_id:
        existing = await db.access_codes.find_one({"id": existing_id})
        if existing:
            existing.pop("_id", None)
            return existing

    # Génère un code unique
    for _attempt in range(10):
        code_str = generate_code()
        if not await db.access_codes.find_one({"code": code_str}):
            break
    else:
        logger.error(f"maketou: failed to generate unique code for cart {cart_id}")
        return None

    now = datetime.now(timezone.utc)
    expires = now + timedelta(days=duration)
    code_id = str(uuid.uuid4())
    plan_label = {"1m": "1 mois", "3m": "3 mois", "1y": "1 an"}.get(plan, plan)
    doc = {
        "id": code_id,
        "code": code_str,
        "label": f"Maketou · {plan_label}",
        "email": email,
        "mode": "fixed",
        "durationDays": duration,
        "expiresAt": expires.isoformat(),
        "firstUsedAt": None,
        "createdAt": now.isoformat(),
        "active": True,
        "usedCount": 0,
        "maxUses": 0,
        "lastUsedAt": None,
        "source": "maketou",
        "maketouCartId": cart_id,
        "maketouPlan": plan,
    }
    await db.access_codes.insert_one(doc)
    doc.pop("_id", None)

    # Persiste l'ID dans le panier (idempotence)
    await db.maketou_carts.update_one(
        {"id": cart_id},
        {"$set": {"accessCodeId": code_id, "accessCode": code_str, "provisionedAt": now.isoformat()}},
    )

    # Envoie email avec le code (best-effort, non-bloquant pour la réponse)
    try:
        from notifications import _send_to, _wrap
        inner = (
            f'<h2 style="margin:0 0 12px 0; font-size:20px; color:#15803d;">🎉 Bienvenue sur TURFEX !</h2>'
            f'<p style="margin:0 0 16px 0; color:#333; font-size:14px; line-height:1.6;">'
            f"Merci pour ton paiement. Ton abonnement <b>{plan_label}</b> est actif jusqu'au "
            f"<b>{expires.strftime('%d/%m/%Y à %H:%M')}</b> (UTC)."
            "</p>"
            '<div style="background:#f0fdf4; border:2px dashed #22c55e; border-radius:8px; padding:16px; text-align:center; margin:16px 0;">'
            '<div style="font-size:11px; text-transform:uppercase; letter-spacing:0.1em; color:#15803d; margin-bottom:6px;">Ton code d\'accès</div>'
            f'<div style="font-family:monospace; font-size:24px; font-weight:bold; letter-spacing:0.15em; color:#111;">{code_str}</div>'
            "</div>"
            '<p style="margin:0 0 12px 0; color:#333; font-size:14px;">'
            'Connecte-toi sur <a href="https://turfex.fr" style="color:#0284c7; font-weight:bold;">turfex.fr</a> et entre ton code pour activer ton accès.'
            "</p>"
        )
        await _send_to(email, f"[TURFEX] 🎟️ Ton code d'accès — {plan_label}", _wrap("ABONNEMENT ACTIVÉ", inner), db=db)
    except Exception as e:
        logger.warning(f"maketou welcome email failed for {email}: {e}")

    # Notification admin (best-effort)
    try:
        from notifications import on_payment_received
        await on_payment_received(
            db,
            amount=float(cart_doc.get("price") or 0),
            currency="EUR",
            buyer_email=email,
            tx_id=cart_id,
            raw_payload={"provider": "maketou", "plan": plan, "code": code_str},
        )
    except Exception as e:
        logger.warning(f"maketou admin notif failed: {e}")

    return doc


@api_router.get("/payment/maketou/cart/{cart_id}")
async def get_maketou_cart_status(cart_id: str):
    """Vérifie le statut d'un panier Maketou (utilisé par la page /payment-success en polling).

    Lorsqu'un panier devient `completed`, génère automatiquement un code d'accès TURFEX
    (durée selon le plan) et l'envoie par email. Idempotent : un seul code par panier.
    """
    from maketou import get_cart_status
    result = await get_cart_status(db, cart_id)
    if not result.get("ok"):
        err = result.get("error") or ""
        # Si le panier est introuvable ou cartId mal formé côté Maketou,
        # on renvoie un 404 propre pour stopper le polling frontend.
        if "[404]" in err or "[422]" in err or "not found" in err.lower():
            raise HTTPException(status_code=404, detail="Panier introuvable")
        raise HTTPException(status_code=502, detail=err or "Maketou unreachable")

    new_status = result.get("status")
    # Update local cache si statut changé
    try:
        await db.maketou_carts.update_one(
            {"id": cart_id},
            {"$set": {
                "status": new_status,
                "lastSyncAt": datetime.now(timezone.utc).isoformat(),
            }},
        )
    except Exception as e:
        logger.warning(f"maketou cart cache update failed: {e}")

    # Provisioning automatique du code d'accès si paiement complété
    access_code_payload = None
    if new_status == "completed":
        cart_doc = await db.maketou_carts.find_one({"id": cart_id})
        if cart_doc:
            cart_doc.pop("_id", None)
            provisioned = await _maketou_provision_access_code(cart_doc)
            if provisioned:
                access_code_payload = {
                    "code": provisioned.get("code"),
                    "expiresAt": provisioned.get("expiresAt"),
                    "durationDays": provisioned.get("durationDays"),
                    "label": provisioned.get("label"),
                }

    return {
        "ok": True,
        "id": result.get("id"),
        "status": new_status,
        "customerInfo": result.get("customerInfo"),
        "paymentId": result.get("paymentId"),
        "accessCode": access_code_payload,  # null tant que paiement non complété
    }


@api_router.get("/admin/payment/providers")
async def admin_get_payment_providers(
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Lecture admin : config des providers + statut clé Maketou + statut produits."""
    await require_admin(x_admin_password)
    from maketou import _load_maketou_api_key, _load_maketou_product_id, PLANS as MK_PLANS
    settings = await get_notification_settings(db)
    providers = settings.get("payment_providers") or ["chariow", "maketou"]

    # Statut Maketou
    api_key = await _load_maketou_api_key(db)
    products = {}
    for pk in MK_PLANS.keys():
        pid = await _load_maketou_product_id(db, pk)
        products[pk] = {"set": bool(pid), "id": pid[:8] + "…" if pid else None}

    return {
        "providers": providers,
        "available": ["chariow", "maketou"],
        "maketou": {
            "apiKeyConfigured": bool(api_key),
            "apiKeyMasked": (api_key[:8] + "***" + api_key[-4:]) if api_key and len(api_key) > 12 else None,
            "products": products,
        },
    }


@api_router.patch("/admin/payment/providers")
async def admin_set_payment_providers(
    req: PaymentProvidersConfigRequest,
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Met à jour la liste des providers de paiement affichés sur le site."""
    await require_admin(x_admin_password)
    valid = [p for p in (req.providers or []) if p in ("chariow", "maketou")]
    if not valid:
        raise HTTPException(status_code=400, detail="Au moins un provider doit être sélectionné")
    new_settings = await update_notification_settings(db, {"payment_providers": valid})
    return {"ok": True, "providers": new_settings.get("payment_providers")}


class MaketouSecretsRequest(BaseModel):
    apiKey: Optional[str] = None
    product1m: Optional[str] = None
    product3m: Optional[str] = None
    product1y: Optional[str] = None


@api_router.post("/admin/payment/maketou/secrets")
async def admin_set_maketou_secrets(
    req: MaketouSecretsRequest,
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Stocke clé API Maketou et/ou les 3 productDocumentId en MongoDB (collection app_secrets).

    Seuls les champs non-null sont mis à jour. Pour vider un champ, passer "" (chaîne vide).
    """
    await require_admin(x_admin_password)
    now_iso = datetime.now(timezone.utc).isoformat()
    updates: List[str] = []

    field_map = {
        "apiKey": "maketou_api_key",
        "product1m": "maketou_product_1m",
        "product3m": "maketou_product_3m",
        "product1y": "maketou_product_1y",
    }
    for body_key, secret_id in field_map.items():
        val = getattr(req, body_key)
        if val is None:
            continue  # not provided → skip
        clean = val.strip()
        if clean:
            await db.app_secrets.update_one(
                {"_id": secret_id},
                {"$set": {"value": clean, "updatedAt": now_iso, "updatedBy": "admin_ui"}},
                upsert=True,
            )
            updates.append(f"{secret_id}=set")
        else:
            await db.app_secrets.delete_one({"_id": secret_id})
            updates.append(f"{secret_id}=cleared")

    if not updates:
        raise HTTPException(status_code=400, detail="Aucun champ fourni")
    return {"ok": True, "updates": updates}


class MaketouTestRequest(BaseModel):
    plan: str = "1m"
    email: str
    firstName: str = "Test"
    lastName: str = "Admin"


@api_router.post("/admin/payment/maketou/test")
async def admin_test_maketou(
    req: MaketouTestRequest,
    request: Request,
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Crée un panier Maketou de test depuis l'admin pour valider clé + product ID."""
    await require_admin(x_admin_password)
    from maketou import create_checkout, PLANS as MK_PLANS
    if req.plan not in MK_PLANS:
        raise HTTPException(status_code=400, detail=f"Plan invalide ({list(MK_PLANS.keys())})")

    origin = request.headers.get("origin") or request.headers.get("referer") or "https://turfex.fr"
    redirect_url = f"{origin.rstrip('/')}/payment-success?provider=maketou&test=1"
    result = await create_checkout(
        db,
        plan_key=req.plan,
        email=req.email,
        first_name=req.firstName,
        last_name=req.lastName,
        redirect_url=redirect_url,
        meta={"test": True, "source": "admin_ui"},
    )
    return {
        "ok": bool(result.get("ok")),
        "cartId": result.get("cartId"),
        "redirectUrl": result.get("redirectUrl"),
        "error": result.get("error"),
        "plan": req.plan,
        "price": MK_PLANS[req.plan]["price"],
    }


# ============================================================================
# CHARIOW PLANS — 3 URLs configurables (1m / 3m / 1y) — admin
# ============================================================================
CHARIOW_DEFAULT_URLS = {
    "1m": "https://ygsftwvy.mychariow.shop/prd_dh34ze",
    "3m": "https://ygsftwvy.mychariow.shop/prd_sqrv2z",
    "1y": "https://ygsftwvy.mychariow.shop/prd_bquicp",
}


class ChariowUrlsRequest(BaseModel):
    url1m: Optional[str] = None
    url3m: Optional[str] = None
    url1y: Optional[str] = None


@api_router.get("/admin/payment/chariow")
async def admin_get_chariow_urls(
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Lecture admin des 3 URLs Chariow (avec source DB / défaut)."""
    await require_admin(x_admin_password)
    out = {}
    for plan_key, default_url in CHARIOW_DEFAULT_URLS.items():
        doc = await db.app_secrets.find_one({"_id": f"chariow_url_{plan_key}"})
        db_value = ((doc or {}).get("value") or "").strip()
        out[plan_key] = {
            "url": db_value or default_url,
            "source": "db" if db_value else "default",
            "default": default_url,
            "updatedAt": (doc or {}).get("updatedAt"),
        }
    return {"plans": out}


@api_router.post("/admin/payment/chariow")
async def admin_set_chariow_urls(
    req: ChariowUrlsRequest,
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Met à jour 1 ou plusieurs URLs Chariow (None = champ non modifié, "" = retour au défaut)."""
    await require_admin(x_admin_password)
    now_iso = datetime.now(timezone.utc).isoformat()
    field_map = {"url1m": "chariow_url_1m", "url3m": "chariow_url_3m", "url1y": "chariow_url_1y"}
    updates: List[str] = []
    for body_key, secret_id in field_map.items():
        val = getattr(req, body_key)
        if val is None:
            continue
        clean = val.strip()
        if clean:
            if not clean.startswith("http"):
                raise HTTPException(status_code=400, detail=f"{body_key} : URL doit commencer par http(s)://")
            await db.app_secrets.update_one(
                {"_id": secret_id},
                {"$set": {"value": clean, "updatedAt": now_iso, "updatedBy": "admin_ui"}},
                upsert=True,
            )
            updates.append(f"{secret_id}=set")
        else:
            await db.app_secrets.delete_one({"_id": secret_id})
            updates.append(f"{secret_id}=cleared")
    if not updates:
        raise HTTPException(status_code=400, detail="Aucun champ fourni")
    return {"ok": True, "updates": updates}





# ============================================================================
# RESEND DOMAINS MANAGEMENT (admin) — proxy vers l'API Resend pour ajouter,
# vérifier, lister et supprimer les domaines depuis l'UI admin.
# Doc Resend : https://resend.com/docs/api-reference/domains
# ============================================================================
RESEND_API_BASE = "https://api.resend.com"


async def _resend_active_key() -> str:
    """Retourne la clé Resend active (DB override > .env). Lève 400 si absente."""
    from notifications import _load_runtime_secrets, _env as _email_env_fn
    db_key = await _load_runtime_secrets(db)
    if db_key:
        return db_key
    env_key = _email_env_fn().get("api_key") or ""
    if env_key:
        return env_key
    raise HTTPException(status_code=400, detail="Aucune clé Resend configurée (ni DB ni .env)")


def _resend_headers(api_key: str) -> Dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }


class ResendDomainCreateRequest(BaseModel):
    name: str
    region: Optional[str] = "eu-west-1"  # eu-west-1, us-east-1, sa-east-1, ap-northeast-1


@api_router.get("/admin/resend/domains")
async def list_resend_domains(
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Liste les domaines enregistrés sur le compte Resend (avec leur statut)."""
    await require_admin(x_admin_password)
    api_key = await _resend_active_key()
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(f"{RESEND_API_BASE}/domains", headers=_resend_headers(api_key))
    if r.status_code >= 400:
        try:
            err = r.json()
        except Exception:
            err = {"message": r.text}
        raise HTTPException(status_code=r.status_code, detail=err.get("message") or "Resend API error")
    data = r.json() or {}
    return {"ok": True, "domains": data.get("data", []), "count": len(data.get("data", []))}


@api_router.post("/admin/resend/domains")
async def add_resend_domain(
    req: ResendDomainCreateRequest,
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Enregistre un nouveau domaine sur Resend.

    Resend renvoie l'ID + les enregistrements DNS (SPF, DKIM, DMARC) à ajouter
    chez l'hébergeur DNS. Statut initial : 'pending' tant que les DNS ne sont pas posés.
    """
    await require_admin(x_admin_password)
    name = (req.name or "").strip().lower()
    if not name or "." not in name or " " in name:
        raise HTTPException(status_code=400, detail="Nom de domaine invalide")
    api_key = await _resend_active_key()
    payload = {"name": name, "region": req.region or "eu-west-1"}
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(f"{RESEND_API_BASE}/domains", headers=_resend_headers(api_key), json=payload)
    if r.status_code >= 400:
        try:
            err = r.json()
        except Exception:
            err = {"message": r.text}
        raise HTTPException(status_code=r.status_code, detail=err.get("message") or "Resend API error")
    return {"ok": True, "domain": r.json()}


@api_router.get("/admin/resend/domains/{domain_id}")
async def get_resend_domain(
    domain_id: str,
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Détail d'un domaine + records DNS à poser."""
    await require_admin(x_admin_password)
    api_key = await _resend_active_key()
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(f"{RESEND_API_BASE}/domains/{domain_id}", headers=_resend_headers(api_key))
    if r.status_code >= 400:
        try:
            err = r.json()
        except Exception:
            err = {"message": r.text}
        raise HTTPException(status_code=r.status_code, detail=err.get("message") or "Resend API error")
    return {"ok": True, "domain": r.json()}


@api_router.post("/admin/resend/domains/{domain_id}/verify")
async def verify_resend_domain(
    domain_id: str,
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Déclenche une vérification DNS du domaine côté Resend.

    À appeler après avoir posé les enregistrements SPF/DKIM/DMARC chez son DNS.
    """
    await require_admin(x_admin_password)
    api_key = await _resend_active_key()
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(f"{RESEND_API_BASE}/domains/{domain_id}/verify", headers=_resend_headers(api_key))
    if r.status_code >= 400:
        try:
            err = r.json()
        except Exception:
            err = {"message": r.text}
        raise HTTPException(status_code=r.status_code, detail=err.get("message") or "Resend API error")
    return {"ok": True, "result": r.json()}


@api_router.delete("/admin/resend/domains/{domain_id}")
async def delete_resend_domain(
    domain_id: str,
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Supprime un domaine du compte Resend."""
    await require_admin(x_admin_password)
    api_key = await _resend_active_key()
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.delete(f"{RESEND_API_BASE}/domains/{domain_id}", headers=_resend_headers(api_key))
    if r.status_code >= 400:
        try:
            err = r.json()
        except Exception:
            err = {"message": r.text}
        raise HTTPException(status_code=r.status_code, detail=err.get("message") or "Resend API error")
    return {"ok": True, "result": r.json() if r.text else {"deleted": True}}



@api_router.post("/admin/notifications/digest/r1-pronostics")
async def trigger_r1_pronostics(
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Déclenche manuellement l'envoi du digest pronostics R1 aux abonnés actifs.

    Mode FIRE-AND-FORGET : retourne 200 OK immédiat, l'envoi (potentiellement long
    si nombreux destinataires) tourne en arrière-plan pour éviter les timeouts ingress.
    """
    await require_admin(x_admin_password)
    # Pré-check : si daily_r1_pronostics est désactivé, on retourne ok:false IMMÉDIATEMENT
    # (sans spawn la tâche de fond — comportement admin attendu).
    settings_doc = await get_notification_settings(db)
    if settings_doc.get("daily_r1_pronostics") is False:
        return {"ok": False, "error": "disabled", "queued": False}

    # Reset le run du jour pour autoriser un re-trigger manuel
    try:
        from zoneinfo import ZoneInfo
        today = datetime.now(ZoneInfo("Europe/Paris")).strftime("%Y-%m-%d")
    except Exception:
        today = datetime.utcnow().strftime("%Y-%m-%d")
    await db.digest_runs.delete_many({
        "jobName": "r1_pronostics",
        "runAt": {"$regex": f"^{today}"},
    })
    _spawn_r1_bulk_send("manual")
    return {
        "ok": True,
        "queued": True,
        "message": "Envoi lancé en arrière-plan. Rafraîchis l'historique dans 30-60s pour voir les résultats.",
    }


@api_router.post("/admin/notifications/digest/trial-followup")
async def trigger_trial_followup(
    body: Optional[Dict[str, Any]] = None,
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Déclenche manuellement la relance des trials utilisés (fenêtre J-3 à J-1).

    Body optionnel : {"force_all_used": true} pour ignorer la fenêtre temporelle (utile en test).
    """
    await require_admin(x_admin_password)
    force = bool((body or {}).get("force_all_used", False))
    result = await send_trial_followup(db, force_all_used=force)
    await log_digest_run(db, "trial_followup", result, trigger="manual")
    return result


@api_router.post("/admin/notifications/digest/code-expiring")
async def trigger_code_expiring(
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Déclenche manuellement le mailing J-1 pour les codes qui expirent dans les 24h."""
    await require_admin(x_admin_password)
    result = await send_code_expiring_warnings(db)
    await log_digest_run(db, "code_expiring", result, trigger="manual")
    return result


@api_router.get("/admin/notifications/digest/r1-pronostics/export")
async def export_r1_html(
    light: int = 0,
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Export du digest R1 du jour en fichier HTML téléchargeable.

    Génère le HTML complet (FAVORIS + OUTSIDERS par course + stats entraineurs)
    sans envoyer d'email — pour archivage / partage manuel.

    Query params:
      - light=1 → version compacte sans image de fond inline (~80 KB),
        compatible Gmail (qui tronque les emails > 102 KB).
    """
    await require_admin(x_admin_password)
    result = await build_r1_html_only(db, _fetch_course_data, light=bool(light))
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error") or "build failed")

    html = result["html"]
    date = result.get("date", "")
    hippo = (result.get("hippodrome") or "").replace(" ", "-")
    suffix = "-gmail" if light else ""
    filename = f"turfex-r1-{date}-{hippo}{suffix}.html" if hippo else f"turfex-r1-{date}{suffix}.html"
    return Response(
        content=html,
        media_type="text/html; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-TURFEX-Hippodrome": hippo,
            "X-TURFEX-Courses": str(result.get("courses_count", 0)),
            "X-TURFEX-Light": "1" if light else "0",
        },
    )


@api_router.get("/admin/notifications/digest/trial-followup/export")
async def export_trial_followup_html(
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Export HTML de l'email "TURFEX · OFFRE ABONNEMENT" (admin uniquement).

    Génère le HTML brut de la relance trial (avec le code promo, label de réduction
    et CTA Chariow configurés dans les settings) sans envoyer d'email.
    Utile pour archivage, prévisualisation ou partage manuel.
    """
    await require_admin(x_admin_password)
    result = await build_followup_html_only(db)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error") or "build failed")

    html = result["html"]
    try:
        from zoneinfo import ZoneInfo
        date_str = datetime.now(ZoneInfo("Europe/Paris")).strftime("%Y-%m-%d")
    except Exception:
        date_str = datetime.utcnow().strftime("%Y-%m-%d")
    promo = (result.get("promoCode") or "").lower()
    filename = f"turfex-offre-abonnement-{date_str}-{promo}.html" if promo else f"turfex-offre-abonnement-{date_str}.html"
    return Response(
        content=html,
        media_type="text/html; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-TURFEX-Promo": result.get("promoCode") or "",
            "X-TURFEX-Payment-URL": result.get("paymentUrl") or "",
        },
    )



@api_router.get("/admin/notifications/digest/ferran-r1/export")
async def export_ferran_r1_html(
    light: int = 0,
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Export "Couplés Ferran R1" — toutes les courses R1 du jour avec top couplés + tiercés.

    Pour chaque course R1, applique la méthode Ferran (analyze_with_ferran) sur les
    participants PMU live et génère un HTML téléchargeable (full ou version Gmail).

    Query params:
      - light=1 → version compacte sans image de fond inline (~80 KB),
        compatible Gmail (qui tronque les emails > 102 KB).
    """
    await require_admin(x_admin_password)

    # Date du jour Paris
    try:
        from zoneinfo import ZoneInfo
        date_str = datetime.now(ZoneInfo("Europe/Paris")).strftime("%Y-%m-%d")
    except Exception:
        date_str = datetime.utcnow().strftime("%Y-%m-%d")
    pmu_date = _ferran_fmt_date(date_str)

    # Fetch programme et identifie R1
    prog_url = f"{_FERRAN_PMU_OFFLINE}/programme/{pmu_date}?meteo=true&specialisation=INTERNET"
    try:
        prog_data = await _ferran_cached_get(prog_url, f"ferran-prog:{pmu_date}")
    except HTTPException as e:
        raise HTTPException(status_code=502, detail=f"PMU programme fetch failed: {e.detail}")

    reunions = (prog_data or {}).get("programme", {}).get("reunions") or []
    r1 = None
    for r in reunions:
        if r.get("numOfficiel") == 1:
            r1 = r
            break
    if not r1:
        raise HTTPException(status_code=404, detail=f"R1 introuvable pour {date_str}")

    hippo = ((r1.get("hippodrome") or {}).get("libelleLong") or "").strip()
    courses = r1.get("courses") or []
    if not courses:
        raise HTTPException(status_code=404, detail="R1 sans courses")

    # Pour chaque course : fetch participants + analyze_with_ferran
    # Parallélisé avec asyncio.gather pour rapidité (13 courses max)
    async def _analyze_one(course: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        num = course.get("numOrdre")
        if not num:
            return None
        try:
            purl = f"{_FERRAN_PMU_OFFLINE}/programme/{pmu_date}/R1/C{num}/participants"
            pdata = await _ferran_cached_get(purl, f"ferran-parts:{pmu_date}:R1C{num}")
            analysis = analyze_with_ferran(pdata.get("participants", []))
            # Enrichit `course` avec numCourse pour le rendu
            course_meta = {
                "numCourse": num,
                "libelle": course.get("libelle"),
                "heureDepart": course.get("heureDepart"),
                "distance": course.get("distance"),
                "discipline": course.get("discipline"),
            }
            return {"course": course_meta, "analysis": analysis}
        except Exception as e:
            logger.warning(f"Ferran export R1 C{num} failed: {e}")
            return None

    results = await asyncio.gather(*(_analyze_one(c) for c in courses))
    courses_with_analysis = [r for r in results if r]

    if not courses_with_analysis:
        raise HTTPException(status_code=502, detail="Aucune course R1 exploitable (PMU upstream?)")

    html = render_ferran_r1_html(
        date_str=date_str,
        hippodrome=hippo,
        reunion="R1",
        courses_with_analysis=courses_with_analysis,
        light=bool(light),
    )

    hippo_safe = hippo.replace(" ", "-").replace("/", "-")
    suffix = "-gmail" if light else ""
    filename = (
        f"turfex-ferran-r1-{date_str}-{hippo_safe}{suffix}.html"
        if hippo_safe
        else f"turfex-ferran-r1-{date_str}{suffix}.html"
    )
    return Response(
        content=html,
        media_type="text/html; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-TURFEX-Hippodrome": hippo_safe,
            "X-TURFEX-Courses": str(len(courses_with_analysis)),
            "X-TURFEX-Light": "1" if light else "0",
        },
    )


# ===== FERRAN METHOD (Pronostic PMU par élimination) =====
# App portée depuis un projet Vite+FastAPI autonome. Endpoints préfixés /api/ferran
# pour éviter toute collision avec les routes TURFEX existantes (/api/programme, etc.).
# Utilise la même API PMU Turfinfo en upstream + un cache MongoDB dédié (TTL 30s).

_FERRAN_PMU_OFFLINE = "https://offline.turfinfo.api.pmu.fr/rest/client/7"
_FERRAN_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; TURFEX-Ferran/1.0)"}
_FERRAN_CACHE_TTL = 30  # secondes


def _ferran_fmt_date(date_str: str) -> str:
    """Convertit YYYY-MM-DD → DDMMYYYY (format PMU)."""
    try:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid date format '{date_str}'. Expected YYYY-MM-DD.")
    return dt.strftime("%d%m%Y")


async def _ferran_cached_get(url: str, key: str):
    """Cache MongoDB dédié Ferran (collection `ferran_cache`, TTL 30s)."""
    now = datetime.now(timezone.utc)
    doc = await db.ferran_cache.find_one({"_id": key})
    if doc and (now - datetime.fromisoformat(doc["fetched_at"])) < timedelta(seconds=_FERRAN_CACHE_TTL):
        return doc["data"]
    try:
        async with httpx.AsyncClient(timeout=20, headers=_FERRAN_HEADERS) as cli:
            r = await cli.get(url)
            if r.status_code != 200:
                logger.warning(f"Ferran PMU {r.status_code} for {url}")
                if doc:
                    return doc["data"]
                raise HTTPException(status_code=r.status_code, detail=f"PMU upstream error {r.status_code}")
            data = r.json()
    except httpx.HTTPError as e:
        if doc:
            return doc["data"]
        raise HTTPException(status_code=502, detail=f"PMU fetch failed: {e}")
    await db.ferran_cache.update_one(
        {"_id": key},
        {"$set": {"data": data, "fetched_at": now.isoformat()}},
        upsert=True,
    )
    return data


@api_router.get("/ferran/programme/{date}")
async def ferran_get_programme(date: str):
    """Programme du jour (format YYYY-MM-DD) — liste réunions + courses enrichies."""
    pmu_date = _ferran_fmt_date(date)
    url = f"{_FERRAN_PMU_OFFLINE}/programme/{pmu_date}?meteo=true&specialisation=INTERNET"
    data = await _ferran_cached_get(url, f"ferran-prog:{pmu_date}")

    reunions = []
    for r in data.get("programme", {}).get("reunions", []):
        courses = []
        for c in r.get("courses", []):
            courses.append({
                "numCourse": c.get("numOrdre"),
                "numExterne": c.get("numExterne"),
                "libelle": c.get("libelle"),
                "libelleCourt": c.get("libelleCourt"),
                "heureDepart": c.get("heureDepart"),
                "distance": c.get("distance"),
                "distanceUnit": c.get("distanceUnit"),
                "discipline": c.get("discipline"),
                "specialite": c.get("specialite"),
                "nombreDeclaresPartants": c.get("nombreDeclaresPartants"),
                "montantPrix": c.get("montantPrix"),
                "statut": c.get("statut"),
                "categorieParticularite": c.get("categorieParticularite"),
                "arriveeDefinitive": c.get("arriveeDefinitive"),
                "ordreArrivee": c.get("ordreArrivee"),
                "corde": c.get("corde"),
                "parcours": c.get("parcours"),
                "departImminent": c.get("departImminent"),
            })
        reunions.append({
            "numReunion": r.get("numOfficiel"),
            "numExterne": r.get("numExterne"),
            "hippodrome": (r.get("hippodrome") or {}).get("libelleLong"),
            "hippodromeCode": (r.get("hippodrome") or {}).get("code"),
            "pays": (r.get("pays") or {}).get("libelle"),
            "nature": r.get("nature"),
            "statut": r.get("statut"),
            "meteo": r.get("meteo"),
            "specialites": r.get("specialites"),
            "courses": courses,
        })
    return {"date": date, "reunions": reunions}


@api_router.get("/ferran/programme/{date}/R{r}/C{c}/participants")
async def ferran_get_participants(date: str, r: int, c: int):
    """Partants d'une course avec enrichissement (driver, musique, gains, etc.)."""
    pmu_date = _ferran_fmt_date(date)
    url = f"{_FERRAN_PMU_OFFLINE}/programme/{pmu_date}/R{r}/C{c}/participants"
    data = await _ferran_cached_get(url, f"ferran-parts:{pmu_date}:R{r}C{c}")
    parts = []
    for p in data.get("participants", []):
        rapport = p.get("dernierRapportDirect") or p.get("dernierRapportReference") or {}
        parts.append({
            "numPmu": p.get("numPmu"),
            "nom": p.get("nom"),
            "sexe": p.get("sexe"),
            "age": p.get("age"),
            "race": p.get("race"),
            "robe": (p.get("robe") or {}).get("libelleCourt") if isinstance(p.get("robe"), dict) else p.get("robe"),
            "statut": p.get("statut"),
            "oeilleres": p.get("oeilleres"),
            "deferre": p.get("deferre"),
            "driver": p.get("driver"),
            "driverChange": p.get("driverChange"),
            "entraineur": p.get("entraineur"),
            "proprietaire": p.get("proprietaire"),
            "eleveur": p.get("eleveur"),
            "musique": p.get("musique"),
            "nombreCourses": p.get("nombreCourses"),
            "nombreVictoires": p.get("nombreVictoires"),
            "nombrePlaces": p.get("nombrePlaces"),
            "gainsParticipant": (p.get("gainsParticipant") or {}).get("gainsCarriere"),
            "handicapDistance": p.get("handicapDistance"),
            "handicapPoids": p.get("poidsConditionMonteChange"),
            "corde": p.get("placeCorde"),
            "ordreArrivee": p.get("ordreArrivee"),
            "tempsObtenu": p.get("tempsObtenu"),
            "reductionKilometrique": p.get("reductionKilometrique"),
            "rapportDirect": rapport.get("rapport") if rapport else None,
            "indicateurInedit": p.get("indicateurInedit"),
            "nomPere": p.get("nomPere"),
            "nomMere": p.get("nomMere"),
        })
    return {"participants": parts, "count": len(parts)}



@api_router.get("/turfx-zones/{date}/R{r}/C{c}")
async def turfx_zones_analyzer(date: str, r: int, c: int):
    """Analyse VALUE TURFEX ZONES (CX/RTX/OR/IDC/CFP/RATIO + zones A/B/C).

    Inspirée de turf-france.com mais 100% TURFEX-native :
      - réutilise les participants déjà fetchés
      - calcule 6 indicateurs hippiques par cheval
      - répartit les chevaux en 3 zones selon leur cote
      - identifie automatiquement le top value, top potentiel et chevaux à éviter
    """
    from turfx_zones import compute_turfx_zones
    parts_resp = await ferran_get_participants(date, r, c)
    participants = parts_resp.get("participants", []) if isinstance(parts_resp, dict) else []
    result = compute_turfx_zones(participants)
    result["date"] = date
    result["reunion"] = r
    result["course"] = c
    return result



@api_router.get("/ferran/programme/{date}/R{r}/C{c}/rapports")
async def ferran_get_rapports(date: str, r: int, c: int):
    """Rapports définitifs ou probables simple gagnant."""
    pmu_date = _ferran_fmt_date(date)
    url = f"https://online.turfinfo.api.pmu.fr/rest/client/1/programme/{pmu_date}/R{r}/C{c}/rapports-definitifs"
    try:
        data = await _ferran_cached_get(url, f"ferran-rap:{pmu_date}:R{r}C{c}")
    except HTTPException:
        url2 = f"{_FERRAN_PMU_OFFLINE}/programme/{pmu_date}/R{r}/C{c}/rapports/E_SIMPLE_GAGNANT"
        try:
            data = await _ferran_cached_get(url2, f"ferran-rap-prob:{pmu_date}:R{r}C{c}")
        except HTTPException:
            return {"rapports": []}
    return {"rapports": data if isinstance(data, list) else data.get("rapports", [])}


@api_router.get("/ferran/programme/{date}/R{r}/C{c}/arrivee")
async def ferran_get_arrivee(date: str, r: int, c: int):
    """Arrivée définitive depuis le programme."""
    pmu_date = _ferran_fmt_date(date)
    url = f"{_FERRAN_PMU_OFFLINE}/programme/{pmu_date}"
    data = await _ferran_cached_get(url, f"ferran-prog:{pmu_date}")
    for reunion in data.get("programme", {}).get("reunions", []):
        if reunion.get("numOfficiel") == r:
            for course in reunion.get("courses", []):
                if course.get("numOrdre") == c:
                    return {
                        "ordreArrivee": course.get("ordreArrivee"),
                        "arriveeDefinitive": course.get("arriveeDefinitive"),
                        "statut": course.get("statut"),
                    }
    return {"ordreArrivee": None, "arriveeDefinitive": False}


@api_router.get("/ferran/analyze/{date}/R{r}/C{c}")
async def ferran_analyze(date: str, r: int, c: int):
    """Applique la méthode Ferran (élimination + couplés + tiercés + scoring)."""
    pmu_date = _ferran_fmt_date(date)
    parts_url = f"{_FERRAN_PMU_OFFLINE}/programme/{pmu_date}/R{r}/C{c}/participants"
    data = await _ferran_cached_get(parts_url, f"ferran-parts:{pmu_date}:R{r}C{c}")
    participants = data.get("participants", [])
    return analyze_with_ferran(participants)


@api_router.get("/ferran/stats/{date}")
async def ferran_get_stats(date: str):
    """Agrégats du jour : top drivers, top entraineurs, distribs sexe/âge, disciplines."""
    pmu_date = _ferran_fmt_date(date)
    url = f"{_FERRAN_PMU_OFFLINE}/programme/{pmu_date}"
    data = await _ferran_cached_get(url, f"ferran-prog:{pmu_date}")

    drivers: Dict[str, int] = {}
    trainers: Dict[str, int] = {}
    sex_dist: Dict[str, int] = {}
    age_dist: Dict[str, int] = {}
    fav_count = 0
    total_partants = 0
    total_courses = 0
    discipline_dist: Dict[str, int] = {}

    fetch_tasks = []
    course_meta = []
    for reunion in data.get("programme", {}).get("reunions", []):
        for course in reunion.get("courses", []):
            total_courses += 1
            disc = course.get("discipline") or "INCONNU"
            discipline_dist[disc] = discipline_dist.get(disc, 0) + 1
            r_num = reunion.get("numOfficiel")
            c_num = course.get("numOrdre")
            purl = f"{_FERRAN_PMU_OFFLINE}/programme/{pmu_date}/R{r_num}/C{c_num}/participants"
            fetch_tasks.append(_ferran_cached_get(purl, f"ferran-parts:{pmu_date}:R{r_num}C{c_num}"))
            course_meta.append((r_num, c_num))

    results = await asyncio.gather(*fetch_tasks, return_exceptions=True)
    for (r_num, c_num), pdata in zip(course_meta, results):
        if isinstance(pdata, Exception):
            logger.warning(f"ferran stats sub-fetch failed R{r_num}C{c_num}: {pdata}")
            continue
        for p in pdata.get("participants", []):
            if p.get("statut") != "PARTANT":
                continue
            total_partants += 1
            d = p.get("driver")
            if d:
                drivers[d] = drivers.get(d, 0) + 1
            t = p.get("entraineur")
            if t:
                trainers[t] = trainers.get(t, 0) + 1
            s = p.get("sexe") or "INCONNU"
            sex_dist[s] = sex_dist.get(s, 0) + 1
            a = str(p.get("age") or "?")
            age_dist[a] = age_dist.get(a, 0) + 1
            rap = (p.get("dernierRapportDirect") or {}).get("rapport")
            if rap and rap < 5:
                fav_count += 1

    top_drivers = sorted(drivers.items(), key=lambda x: -x[1])[:10]
    top_trainers = sorted(trainers.items(), key=lambda x: -x[1])[:10]
    return {
        "date": date,
        "totalCourses": total_courses,
        "totalPartants": total_partants,
        "totalReunions": len(data.get("programme", {}).get("reunions", [])),
        "topDrivers": [{"name": n, "count": c} for n, c in top_drivers],
        "topTrainers": [{"name": n, "count": c} for n, c in top_trainers],
        "sexDistribution": sex_dist,
        "ageDistribution": age_dist,
        "disciplineDistribution": discipline_dist,
        "favoritesUnder5": fav_count,
    }


# ===== CRON EXTERNE (token) =====
# Permet à un service externe (cron-job.org, GitHub Actions, UptimeRobot) de déclencher
# les digests même si le pod Emergent dort la nuit. URL recommandée :
#   GET  {REACT_APP_BACKEND_URL}/api/cron/r1-pronostics?token=<CRON_TOKEN>
#   GET  {REACT_APP_BACKEND_URL}/api/cron/trial-followup?token=<CRON_TOKEN>
# Le token se lit dans l'env CRON_TOKEN (non vide requis pour activer).

def _require_cron_token(token: Optional[str]):
    expected = os.environ.get("CRON_TOKEN", "").strip().strip('"').strip("'")
    if not expected:
        raise HTTPException(status_code=503, detail="Cron token not configured")
    if not token or not secrets.compare_digest(str(token), expected):
        raise HTTPException(status_code=401, detail="Invalid cron token")


async def _idempotent_run(job_name: str, runner_coro, trigger: str = "external_cron"):
    """Wrapper idempotent : si le job a déjà tourné avec succès aujourd'hui (Paris), skip."""
    try:
        from zoneinfo import ZoneInfo
        today_paris = datetime.now(ZoneInfo("Europe/Paris")).strftime("%Y-%m-%d")
    except Exception:
        today_paris = datetime.utcnow().strftime("%Y-%m-%d")

    async for r in db.digest_runs.find({"jobName": job_name, "ok": True}).sort("runAt", -1).limit(3):
        run_at = r.get("runAt", "")
        try:
            rat = datetime.fromisoformat(run_at.replace("Z", "+00:00"))
            from zoneinfo import ZoneInfo
            rat_paris = rat.astimezone(ZoneInfo("Europe/Paris"))
            if rat_paris.strftime("%Y-%m-%d") == today_paris:
                return {"ok": True, "skipped": True, "reason": "already_ran_today", "lastRun": run_at}
        except Exception:
            continue

    result = await runner_coro()
    await log_digest_run(db, job_name, result, trigger=trigger)
    return result


# Lock simple en mémoire pour éviter qu'un cron-job.org qui retry
# ne déclenche 2 jobs en parallèle (cas où il timeout puis re-ping).
_cron_running_locks: Dict[str, bool] = {}


async def _idempotent_run_background(job_name: str, runner_coro, trigger: str = "external_cron"):
    """Variante fire-and-forget : retourne immédiatement, exécute en background.

    Empêche les CRON externes (cron-job.org, GitHub Actions) avec timeout court
    (30s typiquement) de couper l'exécution alors que l'envoi de N emails Resend
    avec throttle 600ms peut prendre plusieurs minutes.

    Garanties :
    - Idempotent : skip si run OK aujourd'hui (Paris) déjà loggé
    - Anti-double-exec : lock mémoire si un run du même job est déjà en cours
    - Logging garanti : log_digest_run appelé même en cas d'exception
    """
    try:
        from zoneinfo import ZoneInfo
        today_paris = datetime.now(ZoneInfo("Europe/Paris")).strftime("%Y-%m-%d")
    except Exception:
        today_paris = datetime.utcnow().strftime("%Y-%m-%d")

    # Check idempotence — si déjà OK aujourd'hui Paris, on skip sans rien lancer
    async for r in db.digest_runs.find({"jobName": job_name, "ok": True}).sort("runAt", -1).limit(3):
        run_at = r.get("runAt", "")
        try:
            rat = datetime.fromisoformat(run_at.replace("Z", "+00:00"))
            from zoneinfo import ZoneInfo
            rat_paris = rat.astimezone(ZoneInfo("Europe/Paris"))
            if rat_paris.strftime("%Y-%m-%d") == today_paris:
                return {"queued": False, "skipped": True, "reason": "already_ran_today", "lastRun": run_at}
        except Exception:
            continue

    # Anti double-exec
    if _cron_running_locks.get(job_name):
        return {"queued": False, "skipped": True, "reason": "already_running"}

    async def _runner():
        _cron_running_locks[job_name] = True
        try:
            result = await runner_coro()
        except Exception as e:
            logger.exception(f"[cron-bg] {job_name} failed")
            result = {"ok": False, "error": str(e)}
        finally:
            _cron_running_locks[job_name] = False
        try:
            await log_digest_run(db, job_name, result, trigger=trigger)
        except Exception as e:
            logger.warning(f"[cron-bg] log_digest_run failed: {e}")

    asyncio.create_task(_runner())
    return {"queued": True, "jobName": job_name, "trigger": trigger, "queuedAt": datetime.now(timezone.utc).isoformat()}


def _check_admin_manual_only():
    """Bloque les envois automatiques (CRON) quand ADMIN_MANUAL_ONLY=true."""
    if os.environ.get("ADMIN_MANUAL_ONLY", "").strip().lower() in ("true", "1", "yes"):
        raise HTTPException(
            status_code=503,
            detail=(
                "ADMIN_MANUAL_ONLY enabled — les envois automatiques sont désactivés. "
                "Seul l'admin peut déclencher les envois via l'interface."
            ),
        )


@api_router.get("/cron/r1-pronostics")
async def cron_r1_pronostics(token: Optional[str] = None):
    """Endpoint fire-and-forget pour cron externe (timeout-safe, 30s OK).

    Configure un cron externe (cron-job.org, GitHub Actions) à 08h05 Paris :
      GET https://tondomaine/api/cron/r1-pronostics?token=<CRON_TOKEN>

    Retourne immédiatement {queued: true} ; le job tourne en background.
    L'envoi réel + le résultat sont consultables dans /admin/notifications/digest/history.
    """
    _require_cron_token(token)
    _check_admin_manual_only()
    return await _idempotent_run_background(
        "r1_pronostics",
        lambda: send_daily_r1_pronostics(db, _fetch_course_data),
    )


@api_router.get("/cron/trial-followup")
async def cron_trial_followup(token: Optional[str] = None):
    """Endpoint fire-and-forget pour cron externe — relance trial J+2."""
    _require_cron_token(token)
    _check_admin_manual_only()
    return await _idempotent_run_background("trial_followup", lambda: send_trial_followup(db))


@api_router.get("/cron/code-expiring")
async def cron_code_expiring(token: Optional[str] = None):
    """Endpoint fire-and-forget pour cron externe — mailing J-1 expiration codes."""
    _require_cron_token(token)
    _check_admin_manual_only()
    return await _idempotent_run_background("code_expiring", lambda: send_code_expiring_warnings(db))


# ===== HISTORIQUE DES ENVOIS =====

@api_router.get("/admin/notifications/digest/history")
async def digest_history(
    limit: int = 50,
    job: Optional[str] = None,
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Historique des exécutions des digests (pour audit/diagnostic)."""
    await require_admin(x_admin_password)
    query: Dict[str, Any] = {}
    if job:
        query["jobName"] = job

    items = []
    async for r in db.digest_runs.find(query).sort("runAt", -1).limit(min(limit, 200)):
        r.pop("_id", None)
        items.append(r)

    # Stats par job
    from collections import Counter
    by_job = Counter((r.get("jobName") or "?") for r in items)
    last_by_job: Dict[str, Optional[Dict[str, Any]]] = {}
    for j in ["r1_pronostics", "trial_followup", "code_expiring", "daily_digest", "weekly_digest"]:
        last = await get_last_digest_run(db, j)
        last_by_job[j] = last

    # CRON externe URL (masked)
    cron_token = os.environ.get("CRON_TOKEN", "").strip().strip('"').strip("'")
    cron_configured = bool(cron_token)

    return {
        "items": items,
        "countByJob": dict(by_job),
        "lastSuccessByJob": last_by_job,
        "cronConfigured": cron_configured,
        "cronTokenPreview": (cron_token[:6] + "…" + cron_token[-4:]) if cron_token else "",
    }


# ===== EMAIL LOG (audit BCC fallback) =====

@api_router.get("/admin/notifications/email-log")
async def email_log(
    limit: int = 100,
    status: Optional[str] = None,
    recipient: Optional[str] = None,
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Historique détaillé des envois individuels (succès, échecs Resend, BCC fallbacks).

    status ∈ {ok, failed, bcc_fallback, bcc_failed} (optionnel).
    """
    await require_admin(x_admin_password)
    query: Dict[str, Any] = {}
    if status:
        query["status"] = status
    if recipient:
        query["recipient"] = recipient.lower().strip()

    items: List[Dict[str, Any]] = []
    async for r in db.email_log.find(query).sort("sentAt", -1).limit(min(limit, 500)):
        r.pop("_id", None)
        items.append(r)

    # Stats
    from collections import Counter
    total_by_status = Counter()
    async for r in db.email_log.find({}, {"_id": 0, "status": 1}):
        total_by_status[r.get("status", "?")] += 1

    return {
        "items": items,
        "totalByStatus": dict(total_by_status),
        "count": len(items),
    }


# ===== AI ANALYSIS (Claude Sonnet 4.5 — analyse de chevaux et top 8) =====

class AIHorseRequest(BaseModel):
    horse: Dict[str, Any]
    courseContext: Dict[str, Any] = Field(default_factory=dict)


class AITop8Request(BaseModel):
    top8: List[Dict[str, Any]]
    courseContext: Dict[str, Any] = Field(default_factory=dict)


@api_router.post("/ai/analyze-horse")
async def ai_analyze_horse_endpoint(req: AIHorseRequest):
    """Analyse IA d'un cheval — accessible aux utilisateurs validés (rate limiting via Cloudflare/proxy).

    Cache 24h activé pour limiter le coût LLM.
    """
    if not isinstance(req.horse, dict) or not req.horse:
        raise HTTPException(status_code=400, detail="horse data required")
    result = await ai_analyze_horse(db, req.horse, req.courseContext or {})
    if not result.get("ok"):
        # On retourne 200 avec ok=false pour ne pas casser le frontend (loading state)
        return result
    return result


@api_router.post("/ai/analyze-top8")
async def ai_analyze_top8_endpoint(req: AITop8Request):
    """Analyse IA du top 8 d'une course — synthèse + outsider + conseil de jeu."""
    if not isinstance(req.top8, list) or len(req.top8) == 0:
        raise HTTPException(status_code=400, detail="top8 list required")
    if len(req.top8) > 12:
        raise HTTPException(status_code=400, detail="top8 max 12 horses")
    result = await ai_analyze_top8(db, req.top8, req.courseContext or {})
    return result


@api_router.get("/admin/ai/usage")
async def admin_ai_usage(
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Stats d'usage IA (admin) — appels par jour, ratio cache, coût estimé."""
    await require_admin(x_admin_password)
    stats = await ai_usage_stats(db)
    return stats


@api_router.delete("/admin/ai/cache")
async def admin_ai_clear_cache(
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Vide le cache des analyses IA (forcer un re-call LLM)."""
    await require_admin(x_admin_password)
    res = await db.ai_analysis_cache.delete_many({})
    return {"ok": True, "deleted": res.deleted_count}


# ---- SUBSCRIBERS (emails) ----

class CreateSubscriberRequest(BaseModel):
    email: str
    note: Optional[str] = ""


@api_router.get("/admin/subscribers")
async def list_subscribers(
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Liste les emails abonnés (source manuelle + ceux liés à un code actif)."""
    await require_admin(x_admin_password)
    manual = []
    async for s in db.email_subscribers.find().sort("createdAt", -1):
        s.pop("_id", None)
        manual.append(s)
    # Emails liés à des codes (info seulement, source='code')
    from_codes = []
    async for c in db.access_codes.find({"email": {"$exists": True, "$ne": ""}}):
        c.pop("_id", None)
        from_codes.append({
            "email": c.get("email"),
            "code": c.get("code"),
            "label": c.get("label"),
            "active": c.get("active", True),
            "expiresAt": c.get("expiresAt"),
        })
    active = await get_active_subscribers(db)
    return {
        "manual": manual,
        "fromCodes": from_codes,
        "activeRecipients": [r["email"] for r in active],
        "activeRecipientsDetail": active,  # avec source
        "activeCount": len(active),
    }


@api_router.post("/admin/subscribers")
async def create_subscriber(
    req: CreateSubscriberRequest,
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Ajoute manuellement un email à la liste d'abonnés (indépendant des codes)."""
    await require_admin(x_admin_password)
    em = (req.email or "").strip().lower()
    if not em or "@" not in em or " " in em:
        raise HTTPException(status_code=400, detail="Email invalide")
    existing = await db.email_subscribers.find_one({"email": em})
    if existing:
        raise HTTPException(status_code=409, detail="Cet email est déjà dans la liste")
    doc = {
        "id": str(uuid.uuid4()),
        "email": em,
        "note": (req.note or "").strip(),
        "active": True,
        "createdAt": datetime.utcnow().isoformat(),
    }
    await db.email_subscribers.insert_one(doc)
    doc.pop("_id", None)
    return {"ok": True, "subscriber": doc}


@api_router.patch("/admin/subscribers/{sid}")
async def update_subscriber(
    sid: str,
    body: Dict[str, Any],
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    await require_admin(x_admin_password)
    allowed = {}
    if "active" in body:
        allowed["active"] = bool(body["active"])
    if "note" in body:
        allowed["note"] = str(body["note"] or "")
    if not allowed:
        return {"ok": True, "updated": 0}
    res = await db.email_subscribers.update_one({"id": sid}, {"$set": allowed})
    return {"ok": True, "updated": res.modified_count}


@api_router.delete("/admin/subscribers/{sid}")
async def delete_subscriber(
    sid: str,
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    await require_admin(x_admin_password)
    res = await db.email_subscribers.delete_one({"id": sid})
    return {"ok": True, "deleted": res.deleted_count}


# ---- VISITOR TRIALS (public signup + admin management) ----

class VisitorTrialRequest(BaseModel):
    email: str


@api_router.post("/visitor/trial")
async def create_visitor_trial(req: VisitorTrialRequest, request: Request):
    """Endpoint public : un visiteur s'inscrit pour recevoir 1 jour de pronostics R1 gratuit.

    Limites :
    - Hard cap : 5 créations RÉUSSIES par IP par heure (mesuré via DB sur `ip` + `createdAt`)
    - Rate limiter mémoire : escalating lockout sur tentatives invalides répétées
    - 1 seul trial par email (refus 409 si déjà existant)
    - L'envoi se fera le lendemain matin à 08h00 Paris (trialDate = J+1)

    AUDIT : chaque tentative (créée, rejetée, rate-limitée) est enregistrée en
    `visitor_trial_events` pour traçabilité complète côté admin.
    """
    ip = get_client_ip(request)
    em_raw = (req.email or "").strip().lower()
    ua = request.headers.get("user-agent", "—")[:300]

    async def _audit(outcome: str, extra: Optional[Dict[str, Any]] = None):
        """Logue chaque tentative dans visitor_trial_events (best-effort)."""
        try:
            await db.visitor_trial_events.insert_one({
                "id": str(uuid.uuid4()),
                "email": em_raw or None,
                "ip": ip,
                "userAgent": ua,
                "outcome": outcome,  # created | already_subscriber | already_code | already_trial | invalid_email | rate_limited_ip | rate_limited_burst
                "extra": extra or {},
                "createdAt": datetime.utcnow().isoformat(),
            })
        except Exception as e:
            logger.warning(f"_audit visitor_trial_events failed: {e}")

    # Rate limit mémoire escalading
    try:
        await enforce_rate_limit(trial_limiter, ip, "trial")
    except HTTPException as e:
        await _audit("rate_limited_burst", {"detail": str(e.detail)[:200]})
        raise

    if not em_raw or "@" not in em_raw or " " in em_raw or "." not in em_raw.split("@")[-1]:
        await _audit("invalid_email")
        await punish(trial_limiter, ip, 400, "Email invalide", "trial")

    # Refuse si déjà subscriber actif (ils reçoivent déjà)
    existing_sub = await db.email_subscribers.find_one({"email": em_raw, "active": True})
    if existing_sub:
        await _audit("already_subscriber")
        return {"ok": True, "already": "subscriber", "message": "Tu reçois déjà nos pronostics quotidiens."}

    # Refuse si email lié à un code actif
    code_link = await db.access_codes.find_one({"email": em_raw, "active": True})
    if code_link:
        await _audit("already_code")
        return {"ok": True, "already": "code", "message": "Cet email est déjà lié à un code d'accès actif."}

    # Refuse si déjà un trial existant (un seul par email)
    existing_trial = await db.visitor_trials.find_one({"email": em_raw})
    if existing_trial:
        await _audit("already_trial", {"trialUsed": existing_trial.get("trialUsed", False)})
        return {
            "ok": True,
            "already": "trial",
            "trialUsed": existing_trial.get("trialUsed", False),
            "trialDate": existing_trial.get("trialDate"),
            "message": "Ton email est déjà inscrit. Un seul jour de test gratuit par email.",
        }

    # Hard cap : max 5 créations RÉUSSIES par IP / heure (anti-abus DB-backed)
    one_hour_ago = (datetime.utcnow() - timedelta(hours=1)).isoformat()
    recent_count = await db.visitor_trials.count_documents({
        "ip": ip,
        "createdAt": {"$gte": one_hour_ago},
    })
    if recent_count >= 5:
        await _audit("rate_limited_ip", {"recent_count": recent_count})
        raise HTTPException(
            status_code=429,
            detail={
                "error": "Trop d'inscriptions depuis cette IP. Réessaye dans 1 heure.",
                "retryAfter": 3600,
                "scope": "trial",
            },
        )

    # Crée le trial — envoi le lendemain matin Europe/Paris
    try:
        from zoneinfo import ZoneInfo
        tomorrow = (datetime.now(ZoneInfo("Europe/Paris")) + timedelta(days=1)).strftime("%Y-%m-%d")
    except Exception:
        tomorrow = (datetime.utcnow() + timedelta(days=1)).strftime("%Y-%m-%d")

    doc = {
        "id": str(uuid.uuid4()),
        "email": em_raw,
        "active": True,
        "trialUsed": False,
        "trialDate": tomorrow,
        "trialUsedAt": None,
        "ip": ip,
        "userAgent": ua,
        "source": "login_page",
        "createdAt": datetime.utcnow().isoformat(),
        "note": "",
    }
    await db.visitor_trials.insert_one(doc)
    await _audit("created", {"trialDate": tomorrow, "trialId": doc["id"]})
    doc.pop("_id", None)
    return {
        "ok": True,
        "created": True,
        "trialDate": tomorrow,
        "message": "Bienvenue ! Tu recevras les pronostics R1 demain matin à 08h00.",
    }


@api_router.get("/admin/trials/events")
async def list_trial_events(
    limit: int = 100,
    outcome: Optional[str] = None,
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Historique complet des tentatives d'inscription au trial (audit).

    outcome ∈ {created, already_trial, already_subscriber, already_code,
               invalid_email, rate_limited_ip, rate_limited_burst} (optionnel)
    """
    await require_admin(x_admin_password)
    query: Dict[str, Any] = {}
    if outcome:
        query["outcome"] = outcome

    items: List[Dict[str, Any]] = []
    async for r in db.visitor_trial_events.find(query).sort("createdAt", -1).limit(min(limit, 500)):
        r.pop("_id", None)
        items.append(r)

    # Stats agrégées
    from collections import Counter
    total_by_outcome = Counter()
    async for r in db.visitor_trial_events.find({}, {"_id": 0, "outcome": 1}):
        total_by_outcome[r.get("outcome", "?")] += 1

    return {
        "items": items,
        "totalByOutcome": dict(total_by_outcome),
        "count": len(items),
    }


class AdminAddTrialRequest(BaseModel):
    email: str
    sendNow: bool = False


@api_router.post("/admin/trials/add")
async def admin_add_trial(
    req: AdminAddTrialRequest,
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Inscription manuelle d'un trial par l'admin. Option `sendNow`: envoi immédiat du digest R1.

    Crée le trial avec source="admin_manual" et trialDate=aujourd'hui si sendNow=true, sinon J+1.
    """
    await require_admin(x_admin_password)
    em = (req.email or "").strip().lower()
    if not em or "@" not in em or " " in em or "." not in em.split("@")[-1]:
        raise HTTPException(status_code=400, detail="Email invalide")

    try:
        from zoneinfo import ZoneInfo
        today = datetime.now(ZoneInfo("Europe/Paris")).strftime("%Y-%m-%d")
        tomorrow = (datetime.now(ZoneInfo("Europe/Paris")) + timedelta(days=1)).strftime("%Y-%m-%d")
    except Exception:
        today = datetime.utcnow().strftime("%Y-%m-%d")
        tomorrow = (datetime.utcnow() + timedelta(days=1)).strftime("%Y-%m-%d")

    trial_date = today if req.sendNow else tomorrow

    existing = await db.visitor_trials.find_one({"email": em})
    if existing:
        # Reset pour rendre éligible
        await db.visitor_trials.update_one(
            {"email": em},
            {"$set": {
                "active": True,
                "trialUsed": False,
                "trialDate": trial_date,
                "trialUsedAt": None,
                "note": "admin re-inscrit",
            }}
        )
        status_msg = "reactivated"
    else:
        doc = {
            "id": str(uuid.uuid4()),
            "email": em,
            "active": True,
            "trialUsed": False,
            "trialDate": trial_date,
            "trialUsedAt": None,
            "ip": "admin",
            "userAgent": "admin-manual",
            "source": "admin_manual",
            "createdAt": datetime.utcnow().isoformat(),
            "note": "added via admin panel",
        }
        await db.visitor_trials.insert_one(doc)
        status_msg = "created"

    # Envoi immédiat si demandé (FIRE-AND-FORGET pour éviter timeouts ingress)
    send_result = None
    if req.sendNow:
        # Reset le run digest_runs r1_pronostics du jour pour autoriser
        await db.digest_runs.delete_many({
            "jobName": "r1_pronostics",
            "runAt": {"$regex": f"^{today}"},
        })
        _spawn_r1_bulk_send("manual_add_send")
        send_result = {
            "ok": True,
            "queued": True,
            "message": "Envoi lancé en arrière-plan (~30-60s).",
        }

    return {
        "ok": True,
        "status": status_msg,
        "email": em,
        "trialDate": trial_date,
        "sendResult": send_result,
    }


@api_router.get("/admin/trials")
async def list_trials(
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Liste tous les trials visiteurs avec stats."""
    await require_admin(x_admin_password)
    items = []
    async for t in db.visitor_trials.find().sort("createdAt", -1).limit(500):
        t.pop("_id", None)
        items.append(t)

    # Stats globales
    total = len(items)
    active = sum(1 for t in items if t.get("active"))
    used = sum(1 for t in items if t.get("trialUsed"))
    pending = sum(1 for t in items if not t.get("trialUsed") and t.get("active"))
    disabled = sum(1 for t in items if not t.get("active"))

    # Calcule trialDateToday vs futur vs passé pour chaque
    try:
        from zoneinfo import ZoneInfo
        today = datetime.now(ZoneInfo("Europe/Paris")).strftime("%Y-%m-%d")
    except Exception:
        today = datetime.utcnow().strftime("%Y-%m-%d")

    return {
        "items": items,
        "stats": {
            "total": total,
            "active": active,
            "used": used,
            "pending": pending,
            "disabled": disabled,
        },
        "today": today,
    }


@api_router.patch("/admin/trials/{tid}")
async def update_trial(
    tid: str,
    body: Dict[str, Any],
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Active/désactive ou met à jour la note d'un trial."""
    await require_admin(x_admin_password)
    allowed = {}
    if "active" in body:
        allowed["active"] = bool(body["active"])
    if "note" in body:
        allowed["note"] = str(body["note"] or "")
    if "trialUsed" in body:
        allowed["trialUsed"] = bool(body["trialUsed"])
        if not body["trialUsed"]:
            allowed["trialUsedAt"] = None
    if "trialDate" in body:
        allowed["trialDate"] = str(body["trialDate"] or "")
    if not allowed:
        return {"ok": True, "updated": 0}
    res = await db.visitor_trials.update_one({"id": tid}, {"$set": allowed})
    return {"ok": True, "updated": res.modified_count}


@api_router.delete("/admin/trials/{tid}")
async def delete_trial(
    tid: str,
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    await require_admin(x_admin_password)
    res = await db.visitor_trials.delete_one({"id": tid})
    return {"ok": True, "deleted": res.deleted_count}


@api_router.post("/admin/trials/{tid}/promote")
async def promote_trial_to_subscriber(
    tid: str,
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Convertit un trial en abonné permanent (email_subscribers)."""
    await require_admin(x_admin_password)
    trial = await db.visitor_trials.find_one({"id": tid})
    if not trial:
        raise HTTPException(status_code=404, detail="Trial introuvable")
    em = (trial.get("email") or "").strip().lower()
    existing = await db.email_subscribers.find_one({"email": em})
    if existing:
        return {"ok": True, "already": True}
    sub = {
        "id": str(uuid.uuid4()),
        "email": em,
        "note": f"Promu depuis trial du {trial.get('createdAt', '')[:10]}",
        "active": True,
        "createdAt": datetime.utcnow().isoformat(),
    }
    await db.email_subscribers.insert_one(sub)
    sub.pop("_id", None)
    return {"ok": True, "subscriber": sub}


@api_router.post("/admin/trials/send-now")
async def admin_trials_send_now(
    body: Optional[Dict[str, Any]] = None,
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Renvoie le digest R1 du jour à un trial spécifique (par id) OU à tous les
    trials en attente aujourd'hui (mode bulk).

    Body :
      - {"trial_id": "<uuid>"}  -> 1 seul trial (synchrone, retour avec compte)
      - {"all_pending": true}   -> tous les trials actifs (FIRE-AND-FORGET, retour 200 OK
                                   immédiat — l'envoi tourne en tâche de fond pour éviter
                                   les timeouts ingress Kubernetes)
      - {"reset_used": true}    -> (avec all_pending) reset trialUsed=false avant envoi

    Force l'envoi même si déjà envoyé aujourd'hui (skip idempotence digest_runs).
    """
    await require_admin(x_admin_password)
    body = body or {}
    trial_id = body.get("trial_id")
    all_pending = bool(body.get("all_pending", False))
    reset_used = bool(body.get("reset_used", False))

    try:
        from zoneinfo import ZoneInfo
        today = datetime.now(ZoneInfo("Europe/Paris")).strftime("%Y-%m-%d")
    except Exception:
        today = datetime.utcnow().strftime("%Y-%m-%d")

    if trial_id:
        # Reset 1 trial ciblé pour qu'il soit éligible aujourd'hui
        await db.visitor_trials.update_one(
            {"id": trial_id},
            {"$set": {"trialDate": today, "trialUsed": False, "active": True}},
        )
        target = await db.visitor_trials.find_one({"id": trial_id})
        if not target:
            raise HTTPException(status_code=404, detail="Trial introuvable")
        # Reset run + envoi en arrière-plan CIBLÉ (target_email filtre recipients)
        await db.digest_runs.delete_many({
            "jobName": "r1_pronostics",
            "runAt": {"$regex": f"^{today}"},
        })
        _spawn_r1_bulk_send("manual_resend_single", target_email=target.get("email"))
        return {
            "ok": True,
            "scope": "single",
            "queued": True,
            "trial_email": target.get("email"),
            "message": "Envoi lancé en arrière-plan (~10-30s).",
        }

    if all_pending:
        # Reset trialDate=today pour tous les trials actifs
        query = {"active": True}
        if reset_used:
            query_set = {"trialDate": today, "trialUsed": False}
        else:
            query_set = {"trialDate": today}
        update_result = await db.visitor_trials.update_many(query, {"$set": query_set})
        targeted = update_result.modified_count

        # Reset le run digest_runs du jour pour permettre un nouvel envoi
        await db.digest_runs.delete_many({
            "jobName": "r1_pronostics",
            "runAt": {"$regex": f"^{today}"},
        })

        # FIRE-AND-FORGET — réponse immédiate, envoi en tâche de fond
        _spawn_r1_bulk_send("manual_bulk_bg")

        return {
            "ok": True,
            "scope": "all_pending",
            "queued": True,
            "targeted_count": targeted,
            "message": (
                f"{targeted} trial(s) ciblé(s) — envoi lancé en arrière-plan. "
                "Rafraîchis la liste dans 30-60s pour voir les résultats."
            ),
        }

    raise HTTPException(status_code=400, detail="Provide either trial_id or all_pending")


class ChariowWebhookRequest(BaseModel):
    amount: Optional[float] = 0.0
    currency: Optional[str] = "EUR"
    buyer_email: Optional[str] = ""
    transaction_id: Optional[str] = ""
    event: Optional[str] = "payment_success"


@api_router.post("/webhook/chariow")
async def chariow_webhook(body: Dict[str, Any], request: Request):
    """Webhook public pour Chariow — notifie l'admin en cas de paiement réussi.

    Format souple (Chariow peut envoyer différents formats). On extrait au mieux :
    - amount / currency / buyer_email / transaction_id / event

    Configure l'URL de webhook côté Chariow :
      {REACT_APP_BACKEND_URL}/api/webhook/chariow

    Sécurité optionnelle : si CHARIOW_WEBHOOK_SECRET est défini en .env, le webhook
    n'accepte que les requêtes avec un header X-Chariow-Secret correspondant
    (compare_digest). Sinon (par défaut) il est public — protège-le ASAP en prod.
    """
    secret = os.environ.get("CHARIOW_WEBHOOK_SECRET", "").strip()
    if secret:
        provided = request.headers.get("x-chariow-secret", "")
        if not provided or not secrets.compare_digest(str(provided), str(secret)):
            raise HTTPException(status_code=401, detail="Invalid webhook secret")

    event = str(body.get("event") or body.get("type") or "").lower()
    if event and "fail" in event:
        return {"ok": True, "ignored": "failed payment"}

    try:
        amount = float(body.get("amount") or body.get("total") or body.get("price") or 0)
    except Exception:
        amount = 0.0
    currency = str(body.get("currency") or "EUR").upper()
    buyer_email = str(body.get("buyer_email") or body.get("email") or body.get("customer_email") or "")
    tx_id = str(body.get("transaction_id") or body.get("id") or body.get("order_id") or "")

    # Log pour traçabilité
    await db.payments.insert_one({
        "id": str(uuid.uuid4()),
        "amount": amount,
        "currency": currency,
        "buyer_email": buyer_email,
        "tx_id": tx_id,
        "event": event or "payment_success",
        "raw": body,
        "createdAt": datetime.utcnow().isoformat(),
    })

    notif = await on_payment_received(db, amount=amount, currency=currency, buyer_email=buyer_email, tx_id=tx_id, raw_payload=body)
    return {"ok": True, "notification": notif}



@api_router.post("/admin/codes")
async def create_codes(
    req: CreateCodeRequest,
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    await require_admin(x_admin_password)

    # Détermine le mode :
    #   - si expiresAt fourni → mode "fixed" (date absolue, comptage immédiat)
    #   - sinon → mode "fromFirstUse" (durée stockée, expiresAt calculé à la 1ère utilisation)
    mode = "fixed"
    duration_days = max(1, int(req.durationDays or 30))
    fixed_expiry_iso = None

    if req.expiresAt:
        try:
            exp_dt = datetime.fromisoformat(req.expiresAt.replace("Z", "+00:00"))
            fixed_expiry_iso = exp_dt.isoformat()
            mode = "fixed"
        except Exception:
            raise HTTPException(status_code=400, detail="Format expiresAt invalide (ISO requis)")
    else:
        mode = "fromFirstUse"

    count = max(1, min(100, int(req.count or 1)))
    max_uses = max(0, int(req.maxUses or 0))

    created = []
    for _ in range(count):
        # Génère un code unique
        for _attempt in range(10):
            code = generate_code()
            existing = await db.access_codes.find_one({"code": code})
            if not existing:
                break
        else:
            raise HTTPException(status_code=500, detail="Impossible de générer un code unique")

        doc = {
            "id": str(uuid.uuid4()),
            "code": code,
            "label": req.label or "",
            "email": (req.email or "").strip().lower(),
            "mode": mode,
            "durationDays": duration_days if mode == "fromFirstUse" else None,
            "expiresAt": fixed_expiry_iso,  # null si fromFirstUse, sera défini à la 1ère utilisation
            "firstUsedAt": None,
            "createdAt": datetime.utcnow().isoformat(),
            "active": True,
            "usedCount": 0,
            "maxUses": max_uses,
            "lastUsedAt": None,
        }
        await db.access_codes.insert_one(doc)
        doc.pop("_id", None)
        created.append(doc)

    return {"ok": True, "codes": created}


@api_router.get("/admin/codes")
async def list_codes(
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    await require_admin(x_admin_password)
    items = await db.access_codes.find().sort("createdAt", -1).to_list(500)
    now = datetime.utcnow()
    out = []
    for it in items:
        it.pop("_id", None)
        # Backward-compat: codes sans champ "mode"
        if "mode" not in it:
            it["mode"] = "fixed"
        # Calcul de l'état d'expiration
        it["expired"] = False
        it["pending"] = False  # pas encore activé (mode fromFirstUse + jamais utilisé)
        if it.get("mode") == "fromFirstUse" and not it.get("firstUsedAt"):
            it["pending"] = True
        else:
            try:
                exp_str = it.get("expiresAt") or ""
                if exp_str:
                    exp = datetime.fromisoformat(exp_str.replace("Z", "+00:00"))
                    it["expired"] = exp < now
            except Exception:
                pass
        out.append(it)
    return {"items": out}


@api_router.patch("/admin/codes/{cid}")
async def update_code(
    cid: str,
    body: Dict[str, Any],
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    await require_admin(x_admin_password)

    doc = await db.access_codes.find_one({"id": cid})
    if not doc:
        raise HTTPException(status_code=404, detail="Code introuvable")

    allowed: Dict[str, Any] = {}

    if "active" in body:
        allowed["active"] = bool(body["active"])
    if "label" in body:
        allowed["label"] = str(body["label"] or "")
    if "email" in body:
        allowed["email"] = (str(body["email"] or "")).strip().lower()
    if "maxUses" in body:
        allowed["maxUses"] = max(0, int(body["maxUses"] or 0))

    # 1) Définir une nouvelle date d'expiration absolue
    if "expiresAt" in body and body["expiresAt"]:
        try:
            datetime.fromisoformat(str(body["expiresAt"]).replace("Z", "+00:00"))
            allowed["expiresAt"] = body["expiresAt"]
        except Exception:
            raise HTTPException(status_code=400, detail="expiresAt invalide")

    # 2) Étendre la durée de N jours (à partir de l'expiration courante ou maintenant si déjà expiré)
    if "extendDays" in body and body["extendDays"]:
        try:
            extend = int(body["extendDays"])
        except Exception:
            raise HTTPException(status_code=400, detail="extendDays invalide")
        now = datetime.utcnow()
        # Pour les codes "fromFirstUse" pas encore utilisés : on ne fait que modifier durationDays
        mode = doc.get("mode", "fixed")
        if mode == "fromFirstUse" and not doc.get("firstUsedAt"):
            new_dur = max(1, int(doc.get("durationDays") or 0) + extend)
            allowed["durationDays"] = new_dur
        else:
            try:
                cur_str = doc.get("expiresAt") or ""
                cur = datetime.fromisoformat(cur_str.replace("Z", "+00:00")) if cur_str else now
            except Exception:
                cur = now
            base = cur if cur > now else now  # repart de maintenant si déjà expiré
            new_exp = base + timedelta(days=extend)
            allowed["expiresAt"] = new_exp.isoformat()

    # 3) Modifier la durée d'activation (uniquement pour codes fromFirstUse pas encore utilisés)
    if "durationDays" in body and body["durationDays"] is not None and "extendDays" not in body:
        mode = doc.get("mode", "fixed")
        if mode != "fromFirstUse":
            raise HTTPException(status_code=400, detail="durationDays applicable uniquement aux codes 'fromFirstUse'")
        if doc.get("firstUsedAt"):
            raise HTTPException(status_code=400, detail="Ce code est déjà activé : utilise extendDays pour prolonger")
        try:
            d = int(body["durationDays"])
            if d < 1:
                raise ValueError()
            allowed["durationDays"] = d
        except Exception:
            raise HTTPException(status_code=400, detail="durationDays invalide (>= 1)")

    if not allowed:
        return {"ok": True, "updated": 0}

    res = await db.access_codes.update_one({"id": cid}, {"$set": allowed})
    return {"ok": True, "updated": res.modified_count, "fields": list(allowed.keys())}


@api_router.delete("/admin/codes/{cid}")
async def delete_code(
    cid: str,
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    await require_admin(x_admin_password)
    res = await db.access_codes.delete_one({"id": cid})
    return {"ok": True, "deleted": res.deleted_count}


@api_router.post("/auth/validate-code")
async def validate_code(req: ValidateCodeRequest, request: Request):
    ip = get_client_ip(request)
    await enforce_rate_limit(user_limiter, ip, "user")

    code = (req.code or "").strip().upper()
    if not code:
        await punish(user_limiter, ip, 400, "Code requis", "user")

    doc = await db.access_codes.find_one({"code": code})
    if not doc:
        await punish(user_limiter, ip, 401, "Code invalide", "user")

    if not doc.get("active", True):
        await punish(user_limiter, ip, 403, "Code désactivé", "user")

    # Mode "fromFirstUse" : si pas encore utilisé, on déclenche l'activation maintenant
    mode = doc.get("mode", "fixed")
    activated_now = False
    expires_iso = doc.get("expiresAt")

    if mode == "fromFirstUse" and not doc.get("firstUsedAt"):
        duration_days = int(doc.get("durationDays") or 30)
        now = datetime.utcnow()
        new_expiry = now + timedelta(days=duration_days)
        expires_iso = new_expiry.isoformat()
        await db.access_codes.update_one(
            {"id": doc["id"]},
            {"$set": {
                "firstUsedAt": now.isoformat(),
                "expiresAt": expires_iso,
                "activatedAt": now.isoformat(),
            }},
        )
        doc["firstUsedAt"] = now.isoformat()
        doc["expiresAt"] = expires_iso
        activated_now = True

    # Vérifie expiration (pour mode fixed ou fromFirstUse déjà activé)
    if not activated_now:
        expired = False
        exp = None
        try:
            exp_str = doc.get("expiresAt") or ""
            if exp_str:
                exp = datetime.fromisoformat(exp_str.replace("Z", "+00:00"))
                if exp < datetime.utcnow():
                    expired = True
        except Exception:
            pass
        if expired:
            await punish(
                user_limiter, ip, 403,
                f"Code expiré le {exp.strftime('%d/%m/%Y %H:%M')}" if exp else "Code expiré",
                "user",
            )

    # Vérifie max uses
    max_uses = int(doc.get("maxUses", 0) or 0)
    used = int(doc.get("usedCount", 0) or 0)
    if max_uses > 0 and used >= max_uses:
        await punish(user_limiter, ip, 403, "Quota d'utilisations atteint pour ce code", "user")

    # Succès : reset rate limit
    await user_limiter.record_success(ip)
    await asyncio.sleep(0.25)

    # Incrémente compteur d'utilisations
    await db.access_codes.update_one(
        {"id": doc["id"]},
        {"$set": {"lastUsedAt": datetime.utcnow().isoformat()}, "$inc": {"usedCount": 1}},
    )

    # Notification email si activation à la 1ère utilisation
    if activated_now:
        asyncio.create_task(on_code_activated(
            db,
            code=doc.get("code", ""),
            label=doc.get("label", ""),
            duration_days=doc.get("durationDays"),
            expires_at=expires_iso,
        ))

    return {
        "ok": True,
        "expiresAt": expires_iso,
        "label": doc.get("label", ""),
        "remainingUses": (max_uses - used - 1) if max_uses > 0 else None,
        "activatedNow": activated_now,
        "durationDays": doc.get("durationDays"),
    }


# ===== HEARTBEAT : vérification continue de la validité du code =====
# Le frontend poll toutes les 60s pour détecter rapidement si l'admin
# désactive ou supprime un code → l'utilisateur est déconnecté automatiquement.
# Endpoint léger : pas de rate-limit (sinon blocage tous les utilisateurs simultanément).

class CheckCodeRequest(BaseModel):
    code: str


@api_router.post("/auth/check-code")
async def check_code(req: CheckCodeRequest, request: Request):
    """Vérifie en lecture seule qu'un code est toujours actif et non expiré.

    À CHAQUE ping (toutes les 60s côté frontend via useCodeWatchdog), on met à jour
    `online_users[code].lastPing` → permet de compter les utilisateurs en ligne en
    temps réel (présence < 5 min).

    Retourne {valid: bool, reason: str, expiresAt?: str}
      reason ∈ {"ok", "not_found", "inactive", "expired", "quota_exceeded"}
    """
    code = (req.code or "").strip().upper()
    if not code:
        return {"valid": False, "reason": "not_found"}

    doc = await db.access_codes.find_one({"code": code})
    if not doc:
        return {"valid": False, "reason": "not_found"}

    if not doc.get("active", True):
        return {"valid": False, "reason": "inactive"}

    # Expiration
    exp_str = doc.get("expiresAt") or ""
    if exp_str:
        try:
            exp = datetime.fromisoformat(exp_str.replace("Z", "+00:00"))
            now_aware = datetime.now(timezone.utc) if exp.tzinfo else datetime.utcnow()
            if exp < now_aware:
                return {"valid": False, "reason": "expired", "expiresAt": exp_str}
        except Exception:
            pass

    # Quota
    max_uses = int(doc.get("maxUses", 0) or 0)
    used = int(doc.get("usedCount", 0) or 0)
    if max_uses > 0 and used > max_uses:
        return {"valid": False, "reason": "quota_exceeded"}

    # Heartbeat — track la présence (utilisé par /admin/online-users)
    try:
        ip = get_client_ip(request)
        now_iso = datetime.now(timezone.utc).isoformat()
        await db.online_users.update_one(
            {"code": code},
            {
                "$set": {
                    "code": code,
                    "label": doc.get("label", ""),
                    "lastPing": now_iso,
                    "ip": ip,
                    "userAgent": (request.headers.get("user-agent") or "")[:200],
                },
                "$setOnInsert": {
                    "firstPing": now_iso,
                },
                "$inc": {"pingCount": 1},
            },
            upsert=True,
        )
    except Exception as e:
        logger.warning(f"online_users heartbeat failed: {e}")

    return {
        "valid": True,
        "reason": "ok",
        "expiresAt": exp_str or None,
        "label": doc.get("label", ""),
    }


@api_router.get("/admin/online-users")
async def get_online_users(
    window_minutes: int = 5,
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Liste des utilisateurs en ligne actuellement (heartbeat watchdog < window_minutes).

    Le watchdog frontend ping `/api/auth/check-code` toutes les 60s tant que
    l'utilisateur a un onglet ouvert avec son code activé. On considère
    "en ligne" si lastPing < window_minutes (par défaut 5 min).
    """
    await require_admin(x_admin_password)
    window_minutes = max(1, min(60, int(window_minutes)))
    now = datetime.now(timezone.utc)
    cutoff = (now - timedelta(minutes=window_minutes)).isoformat()

    online = []
    async for u in db.online_users.find({"lastPing": {"$gte": cutoff}}).sort("lastPing", -1):
        last_ping = u.get("lastPing", "")
        try:
            d = datetime.fromisoformat(last_ping.replace("Z", "+00:00"))
            seconds_ago = int((now - d).total_seconds())
        except Exception:
            seconds_ago = None
        online.append({
            "code": u.get("code"),
            "label": u.get("label"),
            "lastPing": last_ping,
            "secondsAgo": seconds_ago,
            "ip": u.get("ip"),
            "pingCount": u.get("pingCount", 0),
            "firstPing": u.get("firstPing"),
        })

    total_known = await db.online_users.count_documents({})
    last_hour_cutoff = (now - timedelta(hours=1)).isoformat()
    last_hour = await db.online_users.count_documents({"lastPing": {"$gte": last_hour_cutoff}})
    last_24h_cutoff = (now - timedelta(hours=24)).isoformat()
    last_24h = await db.online_users.count_documents({"lastPing": {"$gte": last_24h_cutoff}})

    return {
        "online": online,
        "onlineCount": len(online),
        "windowMinutes": window_minutes,
        "totalKnown": total_known,
        "activeLastHour": last_hour,
        "activeLast24h": last_24h,
        "checkedAt": now.isoformat(),
    }


@api_router.get("/admin/security")
async def get_security_status(
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Liste les IPs sous surveillance / verrouillées (rate limiter)."""
    await require_admin(x_admin_password)
    now = time.time()
    out = {"user": [], "admin": []}
    for scope, lim in (("user", user_limiter), ("admin", admin_limiter)):
        for ip, st in lim._state.items():
            attempts_in_window = [t for t in st["attempts"] if t > now - lim.window]
            locked_remaining = max(0, st["lockout_until"] - now)
            if not attempts_in_window and locked_remaining <= 0 and st["total_failed"] == 0:
                continue
            out[scope].append({
                "ip": ip,
                "recentAttempts": len(attempts_in_window),
                "totalFailed": st["total_failed"],
                "lockedRemainingSecs": int(locked_remaining),
                "lockoutLevel": st["lockout_level"],
                "isLocked": locked_remaining > 0,
            })
    return out


@api_router.post("/admin/security/unlock")
async def unlock_ip(
    body: Dict[str, Any],
    x_admin_password: Optional[str] = Header(default=None, alias="X-Admin-Password"),
):
    """Déverrouille manuellement une IP."""
    await require_admin(x_admin_password)
    ip = body.get("ip")
    scope = body.get("scope", "user")
    if not ip:
        raise HTTPException(status_code=400, detail="ip requis")
    lim = admin_limiter if scope == "admin" else user_limiter
    if ip in lim._state:
        lim._state[ip]["attempts"] = []
        lim._state[ip]["lockout_until"] = 0.0
        lim._state[ip]["lockout_level"] = 0
    return {"ok": True}


# Coordonnées des principaux hippodromes français pour la météo
HIPPODROME_COORDS = {
    "PARIS-VINCENNES": (48.8255, 2.4481),
    "VINCENNES": (48.8255, 2.4481),
    "PARIS-LONGCHAMP": (48.8606, 2.2338),
    "LONGCHAMP": (48.8606, 2.2338),
    "AUTEUIL": (48.8499, 2.2578),
    "PARIS-AUTEUIL": (48.8499, 2.2578),
    "SAINT-CLOUD": (48.8451, 2.2172),
    "CHANTILLY": (49.1864, 2.4561),
    "DEAUVILLE": (49.3569, 0.0731),
    "MAISONS-LAFFITTE": (48.9483, 2.1536),
    "ENGHIEN": (48.9706, 2.3167),
    "CAGNES-SUR-MER": (43.6628, 7.1517),
    "LYON-LA-SOIE": (45.7578, 4.9078),
    "LYON-PARILLY": (45.7178, 4.9000),
    "VICHY": (46.1108, 3.4283),
    "BORDEAUX": (44.8636, -0.5822),
    "MARSEILLE-BORELY": (43.2617, 5.3750),
    "CABOURG": (49.2858, -0.1219),
    "LE-CROISE-LAROCHE": (50.6667, 3.0833),
    "NANTES": (47.2500, -1.5833),
    "TOULOUSE": (43.6000, 1.4333),
    "LAVAL": (48.0733, -0.7700),
    "MEAUX": (48.9525, 2.8783),
    "AMIENS": (49.8942, 2.2958),
    "ANGERS": (47.4736, -0.5544),
    "REIMS": (49.2583, 4.0317),
    "STRASBOURG": (48.5839, 7.7514),
    "POMPADOUR": (45.4283, 1.3589),
    "LE-MANS": (48.0061, 0.1996),
    "COMPIEGNE": (49.4150, 2.8350),
    "FONTAINEBLEAU": (48.4100, 2.7017),
}


def find_hippodrome_coords(name: Optional[str]) -> Optional[tuple]:
    if not name:
        return None
    up = name.upper().replace(" ", "-").replace("_", "-")
    # correspondance exacte
    if up in HIPPODROME_COORDS:
        return HIPPODROME_COORDS[up]
    # correspondance partielle
    for key in HIPPODROME_COORDS:
        if key in up or up in key:
            return HIPPODROME_COORDS[key]
    # correspondance par début
    parts = up.split("-")
    for key in HIPPODROME_COORDS:
        if parts and key.startswith(parts[0]) and len(parts[0]) >= 4:
            return HIPPODROME_COORDS[key]
    return None


@api_router.get("/weather")
async def get_weather(hippodrome: Optional[str] = None, date: Optional[str] = None):
    """Météo Open-Meteo (gratuit, sans clé) pour un hippodrome.
    date au format DDMMYYYY (si absent = aujourd'hui)."""
    coords = find_hippodrome_coords(hippodrome)
    if not coords:
        return {"error": "Hippodrome inconnu", "hippodrome": hippodrome, "supported": sorted(HIPPODROME_COORDS.keys())}

    lat, lon = coords
    # Date requise
    if date and len(date) == 8:
        dd, mm, yyyy = date[:2], date[2:4], date[4:8]
        target_iso = f"{yyyy}-{mm}-{dd}"
    else:
        target_iso = datetime.utcnow().strftime("%Y-%m-%d")

    cache_key = f"weather:{lat}:{lon}:{target_iso}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    # Choisit endpoint : historique si date passée > 2 jours, forecast sinon
    now_date = datetime.utcnow().date()
    try:
        target_date = datetime.strptime(target_iso, "%Y-%m-%d").date()
    except Exception:
        target_date = now_date

    delta_days = (now_date - target_date).days
    if delta_days > 2:
        base_url = "https://archive-api.open-meteo.com/v1/archive"
    else:
        base_url = "https://api.open-meteo.com/v1/forecast"

    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": target_iso,
        "end_date": target_iso,
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max,weathercode",
        "timezone": "Europe/Paris",
    }

    async with httpx.AsyncClient() as http:
        try:
            res = await http.get(base_url, params=params, timeout=15.0)
        except Exception as e:
            return {"error": f"Météo fetch error: {e}"}

        if res.status_code != 200:
            return {"error": f"Météo {res.status_code}"}
        try:
            data = res.json()
        except Exception:
            return {"error": "Invalid weather JSON"}

    daily = data.get("daily") or {}
    def first(k):
        arr = daily.get(k) or []
        return arr[0] if arr else None

    weather_codes = {
        0: ("☀️", "Ciel dégagé"),
        1: ("🌤️", "Principalement dégagé"),
        2: ("⛅", "Partiellement nuageux"),
        3: ("☁️", "Couvert"),
        45: ("🌫️", "Brouillard"),
        48: ("🌫️", "Brouillard givrant"),
        51: ("🌦️", "Bruine légère"),
        53: ("🌦️", "Bruine modérée"),
        55: ("🌧️", "Bruine dense"),
        61: ("🌧️", "Pluie légère"),
        63: ("🌧️", "Pluie modérée"),
        65: ("🌧️", "Pluie forte"),
        71: ("🌨️", "Neige légère"),
        73: ("🌨️", "Neige modérée"),
        75: ("❄️", "Neige forte"),
        77: ("🌨️", "Grains de neige"),
        80: ("🌦️", "Averses légères"),
        81: ("🌧️", "Averses modérées"),
        82: ("⛈️", "Averses violentes"),
        95: ("⛈️", "Orage"),
        96: ("⛈️", "Orage avec grêle"),
        99: ("⛈️", "Orage violent"),
    }
    wcode = first("weathercode")
    icon, label = weather_codes.get(int(wcode) if wcode is not None else -1, ("❓", "Inconnu"))

    # Estimation de l'état du terrain selon précipitations des 3 derniers jours
    terrain = "bon"
    precip = first("precipitation_sum") or 0
    if precip > 15:
        terrain = "très lourd"
    elif precip > 7:
        terrain = "lourd"
    elif precip > 3:
        terrain = "souple"
    elif precip > 1:
        terrain = "bon"
    else:
        terrain = "sec"

    result = {
        "hippodrome": hippodrome,
        "coords": {"lat": lat, "lon": lon},
        "date": target_iso,
        "tempMax": first("temperature_2m_max"),
        "tempMin": first("temperature_2m_min"),
        "precipitation": precip,
        "windMax": first("windspeed_10m_max"),
        "weatherCode": wcode,
        "weatherIcon": icon,
        "weatherLabel": label,
        "terrainEstime": terrain,
    }
    cache_set(cache_key, result, ttl=1800)
    return result


# Include the router in the main app
app.include_router(api_router)

# Module Turf Astro (numérologie de course) — préfixe /api/astro/*
from turf_astro import build_astro_router  # noqa: E402
app.include_router(build_astro_router(db), prefix="/api")

# Module 'Le Pari de la Fortune' (méthode WAGUE) — préfixe /api/fortune/*
from fortune import build_fortune_router  # noqa: E402
app.include_router(build_fortune_router(db), prefix="/api")

# Module 'Odds Detective' (intégration app standalone) — préfixe /api/odds/*
from odds_detective import build_odds_router, _seed_odds_admin  # noqa: E402
app.include_router(build_odds_router(db), prefix="/api")

# Module 'Export du code source complet' (admin only) — /api/admin/source-export
from source_export import build_source_export_router  # noqa: E402
app.include_router(build_source_export_router(require_admin), prefix="/api")


@app.on_event("startup")
async def _odds_seed_on_startup():
    try:
        await _seed_odds_admin(db)
    except Exception as e:
        logger.warning(f"odds_detective: seed admin failed: {e}")

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=[
        "http://localhost:3000",
        "https://frontend-bk9lodoar-wague.vercel.app", 
        "https://turfex-e7elsevyi-wague.vercel.app"
    ],
    allow_origin_regex="https://.*\.vercel\.app",
    allow_methods=["*"],
    allow_headers=["*"],
)

# ===== SCHEDULER (digests quotidien & hebdomadaire) =====
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

scheduler: Optional[AsyncIOScheduler] = None


@app.on_event("startup")
async def start_scheduler():
    global scheduler

    # === MODE ADMIN MANUEL UNIQUEMENT ===
    # Quand ADMIN_MANUAL_ONLY=true dans .env, on DÉSACTIVE tous les envois automatiques :
    #   - APScheduler jobs (daily/weekly digest, R1 pronostics, trial followup, code expiring)
    #   - CATCH-UP au démarrage
    # Seuls les boutons manuels admin (POST /admin/trials/send-now, etc.) restent actifs.
    # Utile quand le quota Resend gratuit (100/jour) est saturé → l'admin décide quand envoyer.
    admin_manual_only = os.environ.get("ADMIN_MANUAL_ONLY", "").strip().lower() in ("true", "1", "yes")
    if admin_manual_only:
        logger.warning(
            "[ADMIN_MANUAL_ONLY] Scheduler & CATCH-UP désactivés — "
            "envois uniquement via boutons admin manuels. "
            "Désactive ADMIN_MANUAL_ONLY dans .env pour réactiver les CRON."
        )
        # Crée quand même un scheduler vide (shutdown propre, pas d'erreur app.state.jobs)
        scheduler = AsyncIOScheduler(timezone="UTC")
        scheduler.start()
        app.state.jobs = {}
        return

    scheduler = AsyncIOScheduler(timezone="UTC")

    async def _daily_job(trigger: str = "cron"):
        try:
            r = await send_daily_digest(db)
            logger.info(f"daily digest ({trigger}): {r}")
            await log_digest_run(db, "daily_digest", r, trigger=trigger)
        except Exception as e:
            logger.warning(f"daily digest failed: {e}")
            await log_digest_run(db, "daily_digest", {"ok": False, "error": str(e)}, trigger=trigger)

    async def _weekly_job(trigger: str = "cron"):
        try:
            r = await send_weekly_digest(db)
            logger.info(f"weekly digest ({trigger}): {r}")
            await log_digest_run(db, "weekly_digest", r, trigger=trigger)
        except Exception as e:
            logger.warning(f"weekly digest failed: {e}")
            await log_digest_run(db, "weekly_digest", {"ok": False, "error": str(e)}, trigger=trigger)

    async def _r1_pronostics_job(trigger: str = "cron"):
        try:
            r = await send_daily_r1_pronostics(db, _fetch_course_data)
            logger.info(f"R1 pronostics digest ({trigger}): ok={r.get('ok')} sent={r.get('sent')} err={r.get('error')}")
            await log_digest_run(db, "r1_pronostics", r, trigger=trigger)
        except Exception as e:
            logger.warning(f"R1 pronostics digest failed: {e}")
            await log_digest_run(db, "r1_pronostics", {"ok": False, "error": str(e)}, trigger=trigger)

    async def _trial_followup_job(trigger: str = "cron"):
        try:
            r = await send_trial_followup(db)
            logger.info(f"Trial followup ({trigger}): ok={r.get('ok')} sent={r.get('sent')} eligible={r.get('eligible')} err={r.get('error')}")
            await log_digest_run(db, "trial_followup", r, trigger=trigger)
        except Exception as e:
            logger.warning(f"Trial followup failed: {e}")
            await log_digest_run(db, "trial_followup", {"ok": False, "error": str(e)}, trigger=trigger)

    async def _code_expiring_job(trigger: str = "cron"):
        try:
            r = await send_code_expiring_warnings(db)
            logger.info(f"Code expiring ({trigger}): ok={r.get('ok')} sent={r.get('sent')} eligible={r.get('eligible')} err={r.get('error')}")
            await log_digest_run(db, "code_expiring", r, trigger=trigger)
        except Exception as e:
            logger.warning(f"Code expiring failed: {e}")
            await log_digest_run(db, "code_expiring", {"ok": False, "error": str(e)}, trigger=trigger)

    # Expose jobs au niveau module pour que les endpoints cron puissent les appeler
    app.state.jobs = {
        "daily_digest": _daily_job,
        "weekly_digest": _weekly_job,
        "r1_pronostics": _r1_pronostics_job,
        "trial_followup": _trial_followup_job,
        "code_expiring": _code_expiring_job,
    }

    # Tous les jours à 09:00 UTC (codes expirés)
    scheduler.add_job(_daily_job, CronTrigger(hour=9, minute=0), id="daily_digest", replace_existing=True)
    # Tous les lundis à 09:00 UTC (bilan hebdo)
    scheduler.add_job(_weekly_job, CronTrigger(day_of_week="mon", hour=9, minute=0), id="weekly_digest", replace_existing=True)
    # Tous les jours à 08:00 heure de Paris (pronostics R1 aux abonnés)
    scheduler.add_job(
        _r1_pronostics_job,
        CronTrigger(hour=8, minute=0, timezone="Europe/Paris"),
        id="r1_pronostics_daily",
        replace_existing=True,
    )
    # Tous les jours à 10:00 heure de Paris (relance trials J-3..J-1)
    scheduler.add_job(
        _trial_followup_job,
        CronTrigger(hour=10, minute=0, timezone="Europe/Paris"),
        id="trial_followup_daily",
        replace_existing=True,
    )
    # Tous les jours à 09:30 heure de Paris (warning J-1 expiration code)
    scheduler.add_job(
        _code_expiring_job,
        CronTrigger(hour=9, minute=30, timezone="Europe/Paris"),
        id="code_expiring_daily",
        replace_existing=True,
    )

    scheduler.start()
    logger.info("Scheduler started: daily_digest @09:00 UTC, weekly_digest @Mon 09:00 UTC, r1_pronostics @08:00 Europe/Paris, trial_followup @10:00 Europe/Paris, code_expiring @09:30 Europe/Paris")

    # === CATCH-UP au démarrage ===
    # Si un job aurait dû tourner aujourd'hui Paris et n'a pas encore tourné → on le déclenche.
    async def _catchup_missed():
        try:
            # R1 pronostics (8h Paris)
            if await should_run_catchup(db, "r1_pronostics", cron_hour_paris=8):
                logger.info("CATCH-UP: r1_pronostics hasn't run today yet — launching now")
                await _r1_pronostics_job(trigger="startup_catchup")
            # Trial followup (10h Paris)
            if await should_run_catchup(db, "trial_followup", cron_hour_paris=10):
                logger.info("CATCH-UP: trial_followup hasn't run today yet — launching now")
                await _trial_followup_job(trigger="startup_catchup")
            # Code expiring (9h30 Paris)
            if await should_run_catchup(db, "code_expiring", cron_hour_paris=9):
                logger.info("CATCH-UP: code_expiring hasn't run today yet — launching now")
                await _code_expiring_job(trigger="startup_catchup")
        except Exception as e:
            logger.warning(f"catchup_missed failed: {e}")

    asyncio.create_task(_catchup_missed())


@app.on_event("shutdown")
async def shutdown_db_client():
    global scheduler
    if scheduler:
        try:
            scheduler.shutdown(wait=False)
        except Exception:
            pass
    client.close()


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("server:app", host="0.0.0.0", port=port)
