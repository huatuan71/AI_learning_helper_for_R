from fastapi import APIRouter
from starlette.exceptions import HTTPException

from ..config import APP_VERSION
from ..engine import DATA, KNOWLEDGE


router = APIRouter()


@router.get('/api/health')
def health():
    return {'status':'ok','mode':'mock','version':APP_VERSION,'available_modes':['mock','ai','search'],'knowledge_version':DATA['version'],
            'counts':{k:len(DATA[k]) for k in ['knowledge','questions','errors','relations']}}


@router.get('/api/knowledge')
def catalog():
    return {'items':[{k:x[k] for k in ['id','title','chapter','prerequisites']} for x in KNOWLEDGE.values()],
            'relations':DATA['relations'],'knowledge_version':DATA['version']}


@router.get('/api/knowledge/{knowledge_id}')
def knowledge(knowledge_id: str):
    if knowledge_id not in KNOWLEDGE:
        raise HTTPException(404, '知识点不存在，请从课程目录选择')
    return KNOWLEDGE[knowledge_id]
