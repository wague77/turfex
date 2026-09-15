
"""Module d'analyse IA des chevaux et top 8 via Gemini 3.5 Flash."""

- Cache MongoDB (collection `ai_analysis_cache`) avec TTL 24h pour limiter coût LLM.
- Logging usage quotidien dans `ai_usage_log` pour budget admin.
- Toutes les analyses sont en français, ton tipster pro PMU mais clair.
"""
import os
import hashlib
import json
import logging
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# Cache TTL (heures)
CACHE_TTL_HOURS = 24

# Modèle utilisé
LLM_PROVIDER = "google"
LLM_MODEL = "gemini-3.5-flash"

SYSTEM_PROMPT_HORSE = (
    "Tu es un tipster turf professionnel français spécialisé en pronostics PMU. "
    "Tu analyses un cheval en te basant sur ses données récentes (forme, cote, driver, entraineur, "
    "expérience piste, fraîcheur). Ton style est CONCIS, factuel et expert. "
    "Tu écris 2 à 3 phrases courtes (max 60 mots total) en français, sans balises, sans listes. "
    "Tu mets en avant l'angle d'attaque le plus fort. Pas de bullshit, pas de superlatifs creux. "
    "Tu ne dis JAMAIS 'je pense' ni 'à mon avis' — tu fais ta synthèse et tu trances."
)

SYSTEM_PROMPT_TOP8 = (
    "Tu es un tipster turf professionnel français. On te donne le top 8 d'une course PMU avec "
    "leurs scores et critères. Synthétise en 4 à 6 phrases courtes (max 100 mots) en français : "
    "1) Quels sont les 2-3 chevaux à privilégier (avec un mot d'argument). "
    "2) Le piège ou outsider à surveiller. "
    "3) Conseil de jeu (tiercé/quarté/simple gagnant) si évident. "
    "Style direct, concret, expert. Pas de balises, pas de listes. "
)


def _input_hash(payload: Dict[str, Any]) -> str:
    """Hash stable d'un dict pour clé de cache."""
    s = json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


async def _get_cache(db, key: str) -> Optional[str]:
    if db is None:
        return None
    try:
        doc = await db.ai_analysis_cache.find_one({"key": key})
        if not doc:
            return None
        # Check TTL
        try:
            cached_at = datetime.fromisoformat(doc.get("cachedAt", "").replace("Z", "+00:00"))
            if datetime.now(timezone.utc) - cached_at > timedelta(hours=CACHE_TTL_HOURS):
                return None
        except Exception:
            return None
        return doc.get("analysis")
    except Exception as e:
        logger.warning(f"_get_cache failed: {e}")
        return None


async def _set_cache(db, key: str, kind: str, analysis: str, prompt_preview: str) -> None:
    if db is None:
        return
    try:
        await db.ai_analysis_cache.update_one(
            {"key": key},
            {"$set": {
                "key": key,
                "kind": kind,  # "horse" | "top8"
                "analysis": analysis,
                "promptPreview": prompt_preview[:200],
                "cachedAt": datetime.now(timezone.utc).isoformat(),
            }},
            upsert=True,
        )
    except Exception as e:
        logger.warning(f"_set_cache failed: {e}")


async def _log_usage(db, kind: str, cached: bool, error: Optional[str] = None) -> None:
    """Logue chaque appel (cached ou non) pour le dashboard budget admin."""
    if db is None:
        return
    try:
        await db.ai_usage_log.insert_one({
            "id": str(uuid.uuid4()),
            "kind": kind,
            "cached": cached,
            "error": error,
            "model": LLM_MODEL,
            "loggedAt": datetime.now(timezone.utc).isoformat(),
        })
    except Exception as e:
        logger.warning(f"_log_usage failed: {e}")


def _build_horse_user_message(horse: Dict[str, Any], course_context: Dict[str, Any]) -> str:
    """Construit le message user pour l'analyse d'1 cheval."""
    lines = []
    lines.append(f"COURSE : {course_context.get('libelle', '?')} ({course_context.get('hippodrome', '?')})")
    if course_context.get("discipline"):
        lines.append(f"Discipline : {course_context['discipline']}")
    if course_context.get("distance"):
        lines.append(f"Distance : {course_context['distance']}m")
    if course_context.get("terrain"):
        lines.append(f"Terrain : {course_context['terrain']}")
    lines.append("")
    lines.append(f"CHEVAL #{horse.get('numero', '?')} : {horse.get('nom', '?')}")
    if horse.get("driver"):
        lines.append(f"Driver : {horse['driver']}")
    if horse.get("entraineur"):
        lines.append(f"Entraineur : {horse['entraineur']}")
    if horse.get("cote") is not None:
        lines.append(f"Cote : {horse['cote']}")
    if horse.get("formScore") is not None:
        lines.append(f"Form score : {horse['formScore']}/100")
    if horse.get("grade"):
        lines.append(f"Grade : {horse['grade']}")
    if horse.get("reasons"):
        lines.append(f"Critères forts : {', '.join(horse['reasons'][:5])}")
    if horse.get("recentResults"):
        lines.append(f"3 dernières courses : {horse['recentResults']}")
    return "\n".join(lines)


def _build_top8_user_message(top8: List[Dict[str, Any]], course_context: Dict[str, Any]) -> str:
    """Construit le message user pour l'analyse du top 8 d'une course."""
    lines = []
    lines.append(f"COURSE : {course_context.get('libelle', '?')} ({course_context.get('hippodrome', '?')})")
    if course_context.get("distance"):
        lines.append(f"Distance : {course_context['distance']}m · {course_context.get('discipline', '')}")
    if course_context.get("terrain"):
        lines.append(f"Terrain : {course_context['terrain']}")
    lines.append("")
    lines.append("TOP 8 (rang. cheval · cote · grade · score · critères) :")
    for idx, h in enumerate(top8, 1):
        crits = ", ".join((h.get("reasons") or [])[:3])
        lines.append(
            f"{idx}. #{h.get('numero','?')} {h.get('nom','?')} · "
            f"{h.get('cote', '?')}/1 · grade {h.get('grade','?')} · "
            f"{h.get('formScore', h.get('score','?'))}/100 · {crits}"
        )
    return "\n".join(lines)


async def analyze_horse(db, horse: Dict[str, Any], course_context: Dict[str, Any]) -> Dict[str, Any]:
    """Analyse un cheval. Retourne {analysis, cached, error?}."""
    payload = {"horse": horse, "course": course_context}
    key = _input_hash({"kind": "horse", **payload})

    cached = await _get_cache(db, key)
    if cached:
        await _log_usage(db, "horse", cached=True)
        return {"ok": True, "analysis": cached, "cached": True}

    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        await _log_usage(db, "horse", cached=False, error="missing_gemini_api_key")
        return {"ok": False, "error": "GEMINI_API_KEY not configured"}

    user_text = _build_horse_user_message(horse, course_context)

    try:
        from google import genai
        import asyncio
        client = genai.Client(api_key=api_key)
        
        def _call():
            return client.interactions.create(
                model=LLM_MODEL,
                input=user_text,
                system_instruction=SYSTEM_PROMPT_HORSE,
                generation_config={"max_output_tokens": 300}
            )
        
        response = await asyncio.to_thread(_call)
        analysis = (response.output_text or "").strip()
        if not analysis:
            await _log_usage(db, "horse", cached=False, error="empty_response")
            return {"ok": False, "error": "empty response from LLM"}
        await _set_cache(db, key, "horse", analysis, user_text)
        await _log_usage(db, "horse", cached=False)
        return {"ok": True, "analysis": analysis, "cached": False}
    except Exception as e:
        err = str(e)
        logger.warning(f"analyze_horse LLM error: {err}")
        await _log_usage(db, "horse", cached=False, error=err)
        return {"ok": False, "error": err}


async def analyze_top8(db, top8: List[Dict[str, Any]], course_context: Dict[str, Any]) -> Dict[str, Any]:
    """Analyse synthétique d'un top 8."""
    payload = {"top8": top8, "course": course_context}
    key = _input_hash({"kind": "top8", **payload})

    cached = await _get_cache(db, key)
    if cached:
        await _log_usage(db, "top8", cached=True)
        return {"ok": True, "analysis": cached, "cached": True}

    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        await _log_usage(db, "top8", cached=False, error="missing_gemini_api_key")
        return {"ok": False, "error": "GEMINI_API_KEY not configured"}

    user_text = _build_top8_user_message(top8, course_context)

    try:
        from google import genai
        import asyncio
        client = genai.Client(api_key=api_key)
        
        def _call():
            return client.interactions.create(
                model=LLM_MODEL,
                input=user_text,
                system_instruction=SYSTEM_PROMPT_TOP8,
                generation_config={"max_output_tokens": 500}
            )
        
        response = await asyncio.to_thread(_call)
        analysis = (response.output_text or "").strip()
        if not analysis:
            await _log_usage(db, "top8", cached=False, error="empty_response")
            return {"ok": False, "error": "empty response from LLM"}
        await _set_cache(db, key, "top8", analysis, user_text)
        await _log_usage(db, "top8", cached=False)
        return {"ok": True, "analysis": analysis, "cached": False}
    except Exception as e:
        err = str(e)
        logger.warning(f"analyze_top8 LLM error: {err}")
        await _log_usage(db, "top8", cached=False, error=err)
        return {"ok": False, "error": err}


async def get_usage_stats(db) -> Dict[str, Any]:
    """Calcule l'usage IA pour le panel admin."""
    if db is None:
        return {"daily": {}, "totals": {"calls": 0, "cached": 0, "real": 0, "errors": 0}}

    # 7 derniers jours
    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    daily: Dict[str, Dict[str, int]] = {}
    totals = {"calls": 0, "cached": 0, "real": 0, "errors": 0}

    async for log in db.ai_usage_log.find({"loggedAt": {"$gte": week_ago}}):
        date_str = (log.get("loggedAt", "") or "")[:10]
        if not date_str:
            continue
        d = daily.setdefault(date_str, {"calls": 0, "cached": 0, "real": 0, "errors": 0})
        d["calls"] += 1
        totals["calls"] += 1
        if log.get("error"):
            d["errors"] += 1
            totals["errors"] += 1
        elif log.get("cached"):
            d["cached"] += 1
            totals["cached"] += 1
        else:
            d["real"] += 1
            totals["real"] += 1

    # Estimation coût : Claude Sonnet 4.5 ≈ $3/M input tokens + $15/M output tokens
    # Approx 800 tokens IN + 200 tokens OUT par appel "horse" (et ~1500 IN + 300 OUT pour "top8")
    # → moyenne ~$0.006 par appel réel
    cost_per_real = 0.006
    estimated_cost_eur = totals["real"] * cost_per_real * 0.92  # USD→EUR rough

    cache_count = await db.ai_analysis_cache.count_documents({})

    return {
        "daily": daily,
        "totals": totals,
        "cacheEntries": cache_count,
        "estimatedCostEur7d": round(estimated_cost_eur, 3),
        "model": LLM_MODEL,
        "cacheTtlHours": CACHE_TTL_HOURS,
    }

