from fastapi import APIRouter
from fastapi.responses import FileResponse

from ..config import COURSE_PATH, STATIC_ROOT


router = APIRouter()


@router.get('/', include_in_schema=False)
def index():
    return FileResponse(STATIC_ROOT / 'index.html')


@router.get('/sw.js', include_in_schema=False)
def service_worker():
    return FileResponse(STATIC_ROOT / 'service-worker.js', media_type='application/javascript',
                        headers={'Service-Worker-Allowed': '/',
                                 'Cache-Control': 'no-cache, no-store, must-revalidate'})


@router.get('/offline-course.json', include_in_schema=False)
def offline_course():
    return FileResponse(COURSE_PATH, media_type='application/json',
                        headers={'Cache-Control': 'no-cache, no-store, must-revalidate'})
