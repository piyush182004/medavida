"""AI helpers for medical documents and notes, via any OpenAI-compatible API (OpenRouter by default).

The model only ever summarises or transcribes what it is given. Every output is
labelled as AI-generated in the UI, and extracted prescriptions are reviewed by
the doctor before a patient sees them.
"""

import base64
import json
import os
import re

import fitz  # PyMuPDF
import httpx

DEFAULT_MODEL = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free"
MAX_PDF_TEXT_CHARS = 30_000
MAX_PDF_IMAGE_PAGES = 4

SYSTEM = (
    "You are a careful clinical documentation assistant inside SlotZero, a doctor-appointment platform. "
    "Work ONLY from the material provided. Never invent diagnoses, values, drug names or doses. "
    "If anything is unclear, illegible or missing, say so explicitly instead of guessing. "
    "You do not give medical advice or diagnoses; you organise information for a qualified doctor or a patient. "
    "Be concise. Use plain text with short '-' bullet points and no markdown headings or tables."
)


class AIError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def config() -> dict:
    return {
        "key": os.getenv("OPENROUTER_API_KEY") or os.getenv("AI_API_KEY") or "",
        "model": os.getenv("AI_MODEL") or DEFAULT_MODEL,
        "base": (os.getenv("AI_BASE_URL") or "https://openrouter.ai/api/v1").rstrip("/"),
    }


def enabled() -> bool:
    return bool(config()["key"])


def _chat(content: list[dict], max_tokens: int = 3000) -> str:
    cfg = config()
    if not cfg["key"]:
        raise AIError(503, "AI features aren't switched on for this server. Add OPENROUTER_API_KEY to backend/.env and restart.")
    # Free reasoning models occasionally spend the whole budget thinking and return
    # nothing; retry once with a bigger budget before giving up.
    last: AIError | None = None
    for budget in (max_tokens, max_tokens * 2):
        try:
            return _chat_once(cfg, content, budget)
        except AIError as e:
            if e.status != 502:
                raise
            last = e
    raise last  # type: ignore[misc]


def _chat_once(cfg: dict, content: list[dict], max_tokens: int) -> str:
    payload = {
        "model": cfg["model"],
        "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": content}],
        "temperature": 0.1,
        "max_tokens": max_tokens,
        # Reasoning models: keep thinking short and don't return it.
        "reasoning": {"effort": "low", "exclude": True},
    }
    try:
        r = httpx.post(
            f"{cfg['base']}/chat/completions",
            json=payload,
            headers={
                "Authorization": f"Bearer {cfg['key']}",
                "HTTP-Referer": os.getenv("PUBLIC_SITE_URL", "https://slotzero.app"),
                "X-Title": "SlotZero",
            },
            timeout=120,
        )
    except httpx.HTTPError:
        raise AIError(504, "The AI service didn't respond in time. Please try again.")
    if r.status_code in (401, 403):
        raise AIError(503, "The AI service rejected the API key. Check OPENROUTER_API_KEY in backend/.env.")
    if r.status_code == 429:
        raise AIError(429, "The free AI model is busy right now (rate limited). Please try again in a minute.")
    if r.status_code >= 400:
        raise AIError(502, f"The AI service returned an error ({r.status_code}). Please try again.")
    try:
        text = r.json()["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, ValueError):
        raise AIError(502, "The AI service sent an unexpected response. Please try again.")
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()
    if not text:
        raise AIError(502, "The AI returned an empty answer. Please try again.")
    return text


def _image_part(data: bytes, content_type: str) -> dict:
    """Downscale large photos so uploads stay fast; send as a data URI."""
    try:
        pix = fitz.Pixmap(data)
        if pix.alpha:
            pix = fitz.Pixmap(pix, 0)
        if pix.colorspace and pix.colorspace.n not in (1, 3):
            pix = fitz.Pixmap(fitz.csRGB, pix)
        while max(pix.width, pix.height) > 1800:
            pix.shrink(1)
        data, content_type = pix.tobytes("jpeg", jpg_quality=85), "image/jpeg"
    except Exception:
        pass  # send the original bytes
    b64 = base64.b64encode(data).decode()
    return {"type": "image_url", "image_url": {"url": f"data:{content_type};base64,{b64}"}}


def document_parts(data: bytes, content_type: str) -> list[dict]:
    """Turn an upload into model input: images as-is, PDFs as text (or page images if scanned)."""
    if content_type.startswith("image/"):
        return [_image_part(data, content_type)]
    if content_type == "application/pdf":
        try:
            doc = fitz.open(stream=data, filetype="pdf")
        except Exception:
            raise AIError(400, "That PDF couldn't be opened. It may be damaged or password-protected.")
        text = "\n".join(page.get_text() for page in doc.pages(0, min(len(doc), 20)))
        if len(text.strip()) >= 200:
            return [{"type": "text", "text": f"<document pages=\"{len(doc)}\">\n{text[:MAX_PDF_TEXT_CHARS]}\n</document>"}]
        # Scanned / handwritten PDF: render the first pages as images.
        parts = []
        for page in doc.pages(0, min(len(doc), MAX_PDF_IMAGE_PAGES)):
            png = page.get_pixmap(dpi=120).tobytes("png")
            parts.append(_image_part(png, "image/png"))
        return parts
    raise AIError(400, "Only PDF and image files can be read by the AI.")


FORMAT_RULES = (
    "Output ONLY the sections listed, in that order, each heading on its own line ending with ':' and followed by "
    "'-' bullets. Write '- None noted' under a section with nothing to report. Do not add other sections, do not "
    "repeat these instructions, and do not copy the raw document text."
)


def summarize_document(data: bytes, content_type: str, filename: str, audience: str) -> str:
    if audience == "doctor":
        ask = (
            f"Summarise the attached medical document ('{filename}') for the treating doctor before a consultation. "
            "Report findings exactly as written with their values and reference ranges. Do not suggest causes, "
            "diagnoses or treatment — that is the doctor's job.\n"
            "Sections:\nDocument type:\nKey findings:\nAbnormal values / red flags:\nMedications mentioned:\n"
            "Dates:\nUnclear or illegible:\n\n" + FORMAT_RULES
        )
    else:
        ask = (
            f"Explain the attached medical document ('{filename}') to the patient in simple, friendly words with no "
            "jargon. Describe what it says; do not diagnose or recommend treatment.\n"
            "Sections:\nWhat this document is:\nThe main points:\nAnything marked outside the normal range:\n"
            "Questions you could ask your doctor:\n\n" + FORMAT_RULES
        )
    return _chat([{"type": "text", "text": ask}, *document_parts(data, content_type)])


def appointment_brief(note: str, file_summaries: list[tuple[str, str]], patient: str) -> str:
    material = f"<patient_note>\n{note.strip() or '(no note)'}\n</patient_note>\n"
    for name, summary in file_summaries:
        material += f"<document_summary name=\"{name}\">\n{summary}\n</document_summary>\n"
    ask = (
        f"Write a one-page pre-visit brief for the doctor about {patient}, using only the material below. "
        "Do not suggest diagnoses or treatment.\n"
        "Sections:\nReason for visit:\nSymptoms and duration:\nRelevant history, allergies and current medicines:\n"
        "Abnormal results:\nPoints to check in the consultation:\nMissing information:\n\n"
        + FORMAT_RULES + "\n\n" + material
    )
    return _chat([{"type": "text", "text": ask}])


def _parse_json(text: str) -> dict:
    text = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.M).strip()
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise AIError(502, "The AI couldn't structure that prescription. Try a clearer photo or type the medicines in.")
    try:
        return json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        raise AIError(502, "The AI couldn't structure that prescription. Try a clearer photo or type the medicines in.")


def extract_prescription(data: bytes, content_type: str) -> dict:
    ask = (
        "Transcribe this prescription (it may be handwritten) into JSON. Copy medicine names exactly as written, "
        "including brand names and strengths. Do not guess: if a word is unreadable write it as '[unclear]' and "
        "list it under 'unclear'. Return ONLY this JSON object:\n"
        '{"medicines": [{"name": "", "dosage": "", "frequency": "", "duration": "", "instructions": ""}], '
        '"notes": "advice or follow-up written on the prescription", "unclear": ["anything you could not read"]}'
    )
    raw = _parse_json(_chat([{"type": "text", "text": ask}, *document_parts(data, content_type)]))
    meds = []
    for m in raw.get("medicines") or []:
        if not isinstance(m, dict) or not str(m.get("name", "")).strip():
            continue
        meds.append({k: str(m.get(k, "") or "").strip()[:300 if k == "instructions" else 120] for k in ("name", "dosage", "frequency", "duration", "instructions")})
    return {
        "medicines": meds[:20],
        "notes": str(raw.get("notes", "") or "").strip()[:2000],
        "unclear": [str(x)[:200] for x in (raw.get("unclear") or []) if str(x).strip()][:10],
    }
