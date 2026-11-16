"""Factory instances own their sessions and expose the existing HTTP contract."""
from fastapi.testclient import TestClient

from app.main import ChatRequest, ChatResponse, app, create_app
from app.schemas import ChatRequest as RequestModel, ChatResponse as ResponseModel


def test_legacy_model_exports():
    assert ChatRequest is RequestModel
    assert ChatResponse is ResponseModel


def test_factory_sessions_and_configuration_are_isolated():
    first_app = create_app()
    second_app = create_app()
    assert first_app.state.sessions is not second_app.state.sessions
    assert first_app.state.sessions is not app.state.sessions

    with TestClient(first_app) as first, TestClient(second_app) as second:
        first.get('/api/ai/config')
        configured = first.put('/api/ai/config', json={
            'mode': 'ai', 'provider': 'deepseek', 'model': 'test-model',
            'api_key': 'factory-test-key-1234',
        })
        assert configured.status_code == 200
        assert configured.json()['configured'] is True
        assert second.get('/api/ai/config').json()['configured'] is False

        cookie = first.cookies.get('r_tutor_session')
        second.cookies.clear()
        second.cookies.set('r_tutor_session', cookie)
        recovered = second.get('/api/ai/config').json()
        assert recovered['expired'] is True
        assert recovered['configured'] is False
        assert first.get('/api/ai/config').json()['configured'] is True


def test_factory_registers_routes_middleware_and_handlers():
    instance = create_app()
    assert instance.openapi() == app.openapi()
    with TestClient(instance) as client:
        response = client.post('/api/chat', json={})
        assert response.status_code == 422
        assert response.json()['error']['code'] == 'VALIDATION_ERROR'
        assert response.headers['x-request-id'] == response.json()['request_id']
        assert response.headers['x-content-type-options'] == 'nosniff'
        assert client.get('/api/knowledge/K06').json()['id'] == 'K06'
        assert client.get('/sw.js').headers['service-worker-allowed'] == '/'
