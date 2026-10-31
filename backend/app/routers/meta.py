from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from ..tz import SUPPORTED_ZONES, LocalTimeError, iso, local_status, zone

router = APIRouter(tags=["meta"])


@router.get("/health")
def health():
    return {"status": "ok", "time_utc": iso(datetime.now(timezone.utc))}


@router.get("/timezones")
def timezones():
    return list(SUPPORTED_ZONES)


@router.get("/tz/check")
def tz_check(local: datetime, tz: str):
    """Explain how a wall-clock time in one zone maps to UTC (DST demo)."""
    try:
        z = zone(tz)
    except LocalTimeError as e:
        raise HTTPException(400, str(e))
    naive = local.replace(tzinfo=None)
    status = local_status(naive, tz)
    folds = [] if status == "nonexistent" else ([0, 1] if status == "ambiguous" else [0])
    interpretations = []
    for fold in folds:
        aware = naive.replace(tzinfo=z, fold=fold)
        instant = aware.astimezone(timezone.utc)
        interpretations.append(
            {
                "occurrence": "first" if fold == 0 else "second",
                "utc": iso(instant),
                "offset": aware.strftime("%z"),
                "abbreviation": aware.tzname(),
                "in_zones": {
                    other: instant.astimezone(zone(other)).strftime("%Y-%m-%d %H:%M %Z") for other in SUPPORTED_ZONES
                },
            }
        )
    messages = {
        "ok": "This local time exists exactly once.",
        "nonexistent": "This local time is skipped when clocks spring forward. SlotZero rejects it.",
        "ambiguous": "This local time happens twice when clocks fall back. SlotZero uses the first occurrence "
        "(blocked periods extend their end to the second occurrence).",
    }
    return {"local": naive.isoformat(timespec="minutes"), "timezone": tz, "status": status,
            "message": messages[status], "interpretations": interpretations}
