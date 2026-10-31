"""Time-zone helpers. Only IANA zones, never fixed offsets.

Policy
------
* Nonexistent local times (inside a spring-forward gap) are rejected.
* Ambiguous local times (the repeated hour on fall-back) resolve to the
  FIRST occurrence (fold=0, still on daylight time) unless the caller asks
  for the later one. Blocked periods resolve their *end* to the later
  occurrence so a block always covers the whole ambiguous hour.
"""

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

SUPPORTED_ZONES = ("Asia/Kolkata", "Europe/London", "America/New_York")


class LocalTimeError(ValueError):
    pass


def zone(name: str) -> ZoneInfo:
    if name not in SUPPORTED_ZONES:
        raise LocalTimeError(
            f"Unsupported time zone '{name}'. Use one of: {', '.join(SUPPORTED_ZONES)}."
        )
    return ZoneInfo(name)


def local_status(naive: datetime, tz_name: str) -> str:
    """Return 'ok', 'ambiguous' or 'nonexistent' for a wall-clock time."""
    tz = zone(tz_name)
    first = naive.replace(tzinfo=tz, fold=0)
    round_trip = first.astimezone(timezone.utc).astimezone(tz).replace(tzinfo=None)
    if round_trip != naive:
        return "nonexistent"
    if first.utcoffset() != naive.replace(tzinfo=tz, fold=1).utcoffset():
        return "ambiguous"
    return "ok"


def to_utc(naive: datetime, tz_name: str, prefer: str = "earlier") -> datetime:
    """Convert a wall-clock time in tz_name to an aware UTC instant."""
    if naive.tzinfo is not None:
        raise LocalTimeError("Expected a local wall-clock time without an offset.")
    status = local_status(naive, tz_name)
    if status == "nonexistent":
        raise LocalTimeError(
            f"{naive:%d %b %Y %H:%M} does not exist in {tz_name}: clocks jump forward "
            "for daylight saving at that moment. Pick a time outside the skipped hour."
        )
    fold = 1 if (status == "ambiguous" and prefer == "later") else 0
    return naive.replace(tzinfo=zone(tz_name), fold=fold).astimezone(timezone.utc)


def ensure_aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise LocalTimeError(
            "Times sent to the API must include a UTC offset, e.g. 2026-11-02T09:00:00Z."
        )
    return value.astimezone(timezone.utc)


def iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
