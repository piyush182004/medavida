from pathlib import Path

from dotenv import load_dotenv

# Load backend/.env before any module reads configuration. Real environment
# variables (e.g. on Render, or set by tests) always win over the file.
load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=False)
