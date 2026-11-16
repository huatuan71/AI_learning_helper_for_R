"""Regress Render's ASCII root-directory requirement and root entry points."""
import importlib.util
from pathlib import Path
import sys

import uvicorn


REPO = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('render_service', REPO / 'render_service.py')
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)


def test_render_configuration_has_ascii_entry_points():
    config = (REPO / 'render.yaml').read_text(encoding='utf-8')
    assert config.isascii()
    assert 'rootDir: .' in config
    assert 'buildCommand: python render_service.py build' in config
    assert 'startCommand: python render_service.py start' in config
    assert (service.APP_ROOT / 'app/main.py').is_file()


def test_render_build_locates_existing_requirements(monkeypatch):
    calls = []
    monkeypatch.setattr(service.subprocess, 'run', lambda args, **kwargs: calls.append((args, kwargs)))
    service.main(['build'])
    assert calls == [([sys.executable, '-m', 'pip', 'install', '-r',
                      str(service.APP_ROOT / 'requirements.txt')], {'check': True})]


def test_render_start_uses_port_and_application_directory(monkeypatch):
    calls = []
    monkeypatch.setenv('PORT', '8002')
    monkeypatch.setattr(uvicorn, 'run', lambda *args, **kwargs: calls.append((args, kwargs)))
    service.main(['start'])
    assert calls == [(('app.main:app',), {'app_dir': str(service.APP_ROOT),
                     'host': '0.0.0.0', 'port': 8002, 'workers': 1,
                     'proxy_headers': True, 'forwarded_allow_ips': '*', 'access_log': False})]


def test_report_outputs_stay_in_member_delivery_directory():
    from scripts import evaluate, generate_api_docs, publish_info

    for script in (evaluate, generate_api_docs, publish_info):
        assert script.DELIVERABLES_ROOT == REPO / '成员三'
