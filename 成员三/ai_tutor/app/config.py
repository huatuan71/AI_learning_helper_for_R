"""Shared application paths, version and environment settings."""
import os
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
STATIC_ROOT = ROOT / 'static'
COURSE_PATH = ROOT / 'data' / 'course.json'
APP_VERSION = '1.2.1'
DEVELOPMENT_ORIGINS = ('http://localhost:5173', 'http://127.0.0.1:5173')


def is_production():
    return os.getenv('APP_ENV', '').lower() == 'production' or bool(os.getenv('RENDER'))


def cors_origins():
    return list(DEVELOPMENT_ORIGINS) if os.getenv('APP_ENV') != 'production' else []
