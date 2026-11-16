from pathlib import Path
import sys
import argparse
import uvicorn

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8000)
    args = parser.parse_args()
    uvicorn.run('app.main:app', host='127.0.0.1', port=args.port, workers=1, log_level='info')
