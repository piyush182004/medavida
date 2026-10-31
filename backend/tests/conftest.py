import os
import tempfile

# Runs before any test module imports the app.
# TEST_DATABASE_URL=postgresql://... runs the suite against PostgreSQL; otherwise a temp SQLite file.
os.environ["DATABASE_URL"] = os.getenv("TEST_DATABASE_URL") or f"sqlite:///{os.path.join(tempfile.mkdtemp(), 'test.db')}"
# Tests never call the real AI service.
os.environ["OPENROUTER_API_KEY"] = ""
os.environ["AI_API_KEY"] = ""


def fresh_database():
    from app.db import Base, engine

    Base.metadata.drop_all(engine)
