import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.engine import DATA, KNOWLEDGE

client = TestClient(app)


def test_data():
    assert [len(DATA[k]) for k in ['knowledge','questions','errors','relations']]==[43,24,14,95]
    assert all('\n' in k['fields']['运行示例'] for k in KNOWLEDGE.values())
    assert all(r['from'] in KNOWLEDGE and r['to'] in KNOWLEDGE for r in DATA['relations'])
    assert all(k['sources'] and all(p in KNOWLEDGE for p in k['prerequisites']) for k in KNOWLEDGE.values())


def test_routes():
    health = client.get('/api/health').json()
    assert health['mode']=='mock'
    assert health['version']=='1.2.1'
    assert len(client.get('/api/knowledge').json()['items'])==43
    assert client.get('/api/knowledge/K06').json()['id']=='K06'
    assert client.get('/').status_code==200
    assert client.get('/static/app.js').status_code==200
    assert client.get('/docs').status_code==200
    schema=client.get('/openapi.json').json()
    assert len([p for p in schema['paths'] if p.startswith('/api/')])==12


@pytest.mark.parametrize('case', DATA['questions'], ids=lambda q:q['id'])
def test_questions(case):
    response=client.post('/api/chat',json={'question':case['question'],'teaching_mode':'solution'})
    assert response.status_code==200
    r=response.json()
    assert r['status']=='ok' and r['matched_case_id']==case['id']
    assert set(case['knowledge_ids'])<=set(r['related_knowledge'])
    assert r['answer']['execution_status']=='not_executed'
    assert r['answer']['summary'] and r['citations']
    assert r['answer']['example_code'] or r['answer']['corrected_code']


@pytest.mark.parametrize('case', DATA['errors'], ids=lambda q:q['id'])
def test_errors(case):
    r=client.post('/api/review',json={'code':case['fields']['复现代码']}).json()
    assert r['matched_case_id']==case['id']
    assert r['answer']['corrected_code']==case['fields']['修正代码']
    assert r['answer']['issues'][0]['kind'] in ['error','warning','logic']
    assert r['answer']['code_kind']=='reference_example'


@pytest.mark.parametrize('body',[{}, {'question':'   '}, {'question':'x'*2001}, {'code':'x'*10001},
    {'question':'NA','task_type':'bad'}, {'question':'NA','history':[{'role':'system','content':'x'}]},
    {'question':'NA','history':[{'role':'user','content':'x'}]*13},
    {'question':'NA','history':[{'role':'user','content':'x'*12000}]*3},
    {'question':'NA','unknown':True}])
def test_validation(body):
    r=client.post('/api/chat',json=body)
    assert r.status_code==422 and r.json()['error']['code']=='VALIDATION_ERROR'
    assert r.json()['request_id']


def test_unknown():
    assert client.get('/api/knowledge/K99').status_code==404
    assert client.post('/api/chat',json={'question':'NA','knowledge_id':'K99'}).status_code==404
    assert client.post('/api/chat',content='{bad',headers={'Content-Type':'application/json'}).status_code==422
    assert client.post('/api/review',json={'knowledge_id':'K06'}).status_code==422
    for body in [{'question':'明天天气如何'}, {'code':'unknown_function(z)'}]:
        path='/api/review' if 'code' in body else '/api/chat'
        r=client.post(path,json=body).json()
        assert r['status']=='no_match' and not r['citations']


def test_follow_and_switch():
    r=client.post('/api/chat',json={'question':'空值怎么判断'}).json()
    assert 'K06' in r['related_knowledge']
    for text in ['举个例子','有什么易错点','给我练习']:
        r=client.post('/api/chat',json={'question':text,'knowledge_id':'K06'}).json()
        assert r['status']=='ok' and r['related_knowledge'][0]=='K06'
    r=client.post('/api/chat',json={'question':'矩阵乘法怎么做','knowledge_id':'K06'}).json()
    assert r['related_knowledge'][0]=='K21'
    r=client.post('/api/chat',json={'question':'举个例子','history':[{'role':'user','content':'缺失值'}]}).json()
    assert 'K06' in r['related_knowledge']


def test_exercise_hint():
    q=DATA['questions'][18]['question']
    hint=client.post('/api/chat',json={'question':q}).json()
    solution=client.post('/api/chat',json={'question':q,'teaching_mode':'solution'}).json()
    assert hint['task_type']=='exercise' and not hint['answer']['example_code']
    assert solution['answer']['example_code']


def test_debug_line_and_false_positive():
    r=client.post('/api/review',json={'code':'x <- c(1, NA, 3)\nx[x == NA]'}).json()
    assert r['matched_case_id']=='E04' and r['answer']['issues'][0]['line']==2
    for code in ['# x == NA', 'print("x == NA")', 'x <- 1 # x == NA', 'x <- "“R”"', 'if (na) 1 else 0']:
        assert client.post('/api/review',json={'code':code}).json()['status']=='no_match'


def test_cors():
    for origin in ['http://localhost:5173','http://127.0.0.1:5173']:
        r=client.options('/api/chat',headers={'Origin':origin,'Access-Control-Request-Method':'POST'})
        assert r.headers['access-control-allow-origin']==origin
    r=client.get('/api/health',headers={'Origin':'https://example.org'})
    assert 'access-control-allow-origin' not in r.headers


def test_injected_failure(monkeypatch):
    def fail(*args): raise RuntimeError('test-only simulated failure')
    monkeypatch.setattr('app.api.chat.answer',fail)
    r=client.post('/api/chat',json={'question':'NA'})
    assert r.status_code==500 and r.json()['error']['code']=='INTERNAL_ERROR'
