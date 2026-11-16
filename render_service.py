"""Build and run the tutor from the repository root on Render."""
import argparse
import os
from pathlib import Path
import subprocess
import sys


APP_ROOT = Path(__file__).resolve().parent / 'ai_tutor'


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['build', 'start'])
    args = parser.parse_args(argv)
    if args.command == 'build':
        subprocess.run([sys.executable, '-m', 'pip', 'install', '-r',
                        str(APP_ROOT / 'requirements.txt')], check=True)
        return

    import uvicorn

    uvicorn.run('app.main:app', app_dir=str(APP_ROOT), host='0.0.0.0',
                port=int(os.environ.get('PORT', '8000')), workers=1,
                proxy_headers=True, forwarded_allow_ips='*', access_log=False)


if __name__ == '__main__':
    main()
