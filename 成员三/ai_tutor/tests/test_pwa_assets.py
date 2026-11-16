"""Public PWA endpoints preserve the existing ten-path OpenAPI contract."""
import json
import re
import struct
import zlib
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import pytest
from fastapi.testclient import TestClient

from app.main import app

ROOT = Path(__file__).resolve().parents[1]
client = TestClient(app)
WORKER = (ROOT / 'static/service-worker.js').read_text(encoding='utf-8')
ASSETS = re.findall(r"'([^']+)'", WORKER.split('const ASSETS = [', 1)[1].split('];', 1)[0])


def test_public_endpoints():
    response = client.get('/sw.js')
    assert response.status_code == 200
    assert 'javascript' in response.headers['content-type']
    assert response.headers['service-worker-allowed'] == '/'
    assert 'no-store' in response.headers['cache-control']
    assert 'no-cache' in response.headers['cache-control']
    assert response.content == (ROOT / 'static/service-worker.js').read_bytes()
    response = client.get('/offline-course.json')
    assert response.status_code == 200
    assert response.headers['content-type'] == 'application/json'
    assert 'no-store' in response.headers['cache-control']
    assert response.content == (ROOT / 'data/course.json').read_bytes()
    assert response.json() == json.loads((ROOT / 'data/course.json').read_text(encoding='utf-8'))
    assert response.headers['x-content-type-options'] == 'nosniff'


def test_openapi_unchanged():
    schema = client.get('/openapi.json').json()
    assert schema['info']['version'] == '1.2.1'
    assert len(schema['paths']) == 10
    assert all(path.startswith('/api/') for path in schema['paths'])
    assert client.get('/api/health').json()['version'] == '1.2.1'


def test_manifest():
    response = client.get('/static/manifest.webmanifest')
    assert response.status_code == 200
    assert 'json' in response.headers['content-type']
    manifest = response.json()
    assert manifest['name'] == 'R语言学习助手'
    assert manifest['short_name']
    assert manifest['id'] == manifest['scope'] == '/'
    assert manifest['start_url'] == '/#/home'
    assert manifest['display'] == 'standalone'
    assert re.fullmatch(r'#[0-9a-fA-F]{6}', manifest['theme_color'])
    assert {icon['sizes'] for icon in manifest['icons']} == {'192x192', '512x512'}
    assert all(icon['src'] in ASSETS and icon['type'] == 'image/png' for icon in manifest['icons'])


@pytest.mark.parametrize('name,size', [('icon-192.png', 192), ('icon-512.png', 512), ('apple-touch-icon.png', 180)])
def test_real_png(name, size):
    response = client.get('/static/icons/' + name)
    assert response.status_code == 200
    assert response.headers['content-type'] == 'image/png'
    raw = response.content
    assert raw[:8] == b'\x89PNG\r\n\x1a\n'
    assert struct.unpack('>II', raw[16:24]) == (size, size)
    offset, compressed = 8, b''
    while offset < len(raw):
        length = struct.unpack('>I', raw[offset:offset + 4])[0]
        kind = raw[offset + 4:offset + 8]
        data = raw[offset + 8:offset + 8 + length]
        crc = struct.unpack('>I', raw[offset + 8 + length:offset + 12 + length])[0]
        assert zlib.crc32(kind + data) & 0xffffffff == crc
        if kind == b'IDAT':
            compressed += data
        offset += 12 + length
    assert len(zlib.decompress(compressed)) >= size * size * 3


def test_whitelist_and_dependency_inventory():
    assert len(ASSETS) == len(set(ASSETS))
    assert '/offline-course.json' in ASSETS and '/' in ASSETS
    assert not any('/api/' in asset or '://' in asset for asset in ASSETS)
    for asset in set(ASSETS) - {'/', '/offline-course.json'}:
        assert (ROOT / asset.lstrip('/')).is_file(), asset
        assert client.get(asset).status_code == 200
    # Follow literal module imports, CSS URLs and HTML asset links used by this checkout.
    for path in (ROOT / 'static').glob('*'):
        if path.suffix not in {'.js', '.css', '.html'} or path.name == 'service-worker.js':
            continue
        content = path.read_text(encoding='utf-8')
        dependencies = re.findall(r'''(?:\bfrom\s+|^\s*import\s*(?:\(\s*)?|\bimport\s*\(\s*)["']([^"']+)["']''', content, re.MULTILINE)
        dependencies += re.findall(r'''(?:src|href)=["'](/static/[^"']+)["']''', content)
        dependencies += re.findall(r'''url\(["']?([^\s)'";]+)''', content)
        for dependency in dependencies:
            if dependency.startswith('data:'):
                continue
            asset = urlsplit(urljoin('/static/' + path.name, dependency)).path
            assert asset in ASSETS, (path.name, dependency)


def test_bootstrap_contract():
    bootstrap = (ROOT / 'static/bootstrap.js').read_text(encoding='utf-8')
    assert 'void registerOffline()' in bootstrap
    assert bootstrap.index('void registerOffline()') < bootstrap.index('await import(')
    assert "await import('./app.js?v=structure-v1')" in bootstrap
    assert 'window.' not in bootstrap
    app = (ROOT / 'static/app.js').read_text(encoding='utf-8')
    assert 'new window.' not in app
    assert "from './api-client.js?v=structure-v1'" in app
    assert "from './answer-renderer.js?v=structure-v1'" in app
