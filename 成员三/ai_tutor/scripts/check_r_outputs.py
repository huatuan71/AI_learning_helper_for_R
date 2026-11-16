"""Run every R example in the knowledge drafts and compare it with the expected output written below it.

Usage (from the ai_tutor directory, R must be installed):
    python scripts/check_r_outputs.py                 # check all drafts marked 待R实测
    python scripts/check_r_outputs.py K09 K10          # check selected drafts (any status)
    python scripts/check_r_outputs.py --all            # also re-check drafts already marked 已实测
    python scripts/check_r_outputs.py K09 --write      # if K09 fully passes, mark it 已实测 and save a log
    python scripts/check_r_outputs.py --rscript "C:/Program Files/R/R-4.6.1/bin/Rscript.exe"

Pairing rule: an ```r block is checked against the next ```text block that sits under a heading
starting with 预期输出 or 实际错误或异常结果, before the following ```r block.
Normal output must match line by line (trailing spaces ignored). Error/Warning lines are matched
against stderr by content, with "..." as a wildcard, because R wraps these messages differently
across platforms. After --write, rerun scripts/import_enrichment.py.
"""
from datetime import date
from pathlib import Path
import argparse
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
DRAFTS = ROOT.parent / '知识库补充草稿'
CODE_DIR = ROOT / 'content_assets' / 'code'
EXPECT_HEADINGS = ('预期输出', '实际错误或异常结果')
PENDING = '（待R实测）'
DIAGNOSTIC_START = re.compile(r'^(Error|Warning|In |Calls:|Execution halted|Additional warning)')


def code_pairs(text):
    """Return [(line_no, r_code, expected_text_or_None)] in document order."""
    pairs, heading, block, fence_lang, start = [], '', None, None, 0
    for no, line in enumerate(text.splitlines(), 1):
        if block is None:
            if line.startswith('#'):
                heading = line.lstrip('#').strip()
            m = re.match(r'^```(\w*)\s*$', line)
            if m:
                block, fence_lang, start = [], m.group(1).lower(), no
            continue
        if line.strip() == '```':
            body = '\n'.join(block)
            if fence_lang == 'r':
                pairs.append([start, body, None])
            elif fence_lang == 'text' and heading.startswith(EXPECT_HEADINGS) and pairs and pairs[-1][2] is None:
                pairs[-1][2] = body
            block = None
            continue
        block.append(line)
    return [tuple(p) for p in pairs]


def split_expected(expected):
    """Separate ordinary printed lines from Error/Warning diagnostics."""
    printed, diagnostics, in_diag = [], [], False
    for line in expected.splitlines():
        if DIAGNOSTIC_START.match(line) or (in_diag and line[:1].isspace()):
            diagnostics.append(line.strip())
            in_diag = True
        else:
            printed.append(line.rstrip())
            in_diag = False
    while printed and not printed[-1]:
        printed.pop()
    return printed, [d for d in diagnostics if d]


def diagnostic_pattern(line):
    parts = [re.escape(p) for p in line.split('...')]
    return re.compile(r'\s+'.join('.*?'.join(parts).split(r'\ ')), re.S)


def compare(expected, stdout, stderr):
    """Return a list of human-readable problems; empty means pass."""
    printed, diagnostics = split_expected(expected)
    actual = [line.rstrip() for line in stdout.replace('\r\n', '\n').splitlines()]
    while actual and not actual[-1]:
        actual.pop()
    problems = []
    if actual != printed:
        problems.append('输出不一致\n  预期:\n    ' + '\n    '.join(printed or ['(无输出)']) +
                        '\n  实际:\n    ' + '\n    '.join(actual or ['(无输出)']))
    flat = ' '.join(stderr.split())
    for line in diagnostics:
        if not diagnostic_pattern(line).search(flat):
            problems.append(f'没有出现预期的提示：{line}')
    if not diagnostics and re.search(r'\b(Error|Warning)', stderr):
        problems.append('出现了预期之外的错误或警告：\n    ' + stderr.strip().replace('\n', '\n    '))
    return problems


def r_environment():
    env = dict(os.environ, LANGUAGE='en', R_KEEP_PKG_SOURCE='no')
    if platform.system() != 'Windows':  # Windows R >= 4.2 is UTF-8 already
        env['LC_ALL'] = 'en_US.UTF-8' if platform.system() == 'Darwin' else 'C.UTF-8'
    return env


def run_r(rscript, code, workdir):
    script = Path(workdir) / 'block.R'
    script.write_text('options(width = 80)\n' + code + '\n', encoding='utf-8')
    done = subprocess.run([rscript, '--vanilla', str(script)], cwd=workdir, env=r_environment(),
                          capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=120)
    return done.stdout, done.stderr


def r_version(rscript):
    out = subprocess.run([rscript, '--vanilla', '-e', 'cat(R.version.string, R.version$platform, sep="\\n")'],
                         capture_output=True, text=True, env=r_environment(), timeout=60)
    return out.stdout.strip().splitlines()


def mark_verified(path, version_line, log_name):
    text = path.read_text(encoding='utf-8')
    short = re.search(r'R version (\S+)', version_line)
    label = f'（本次R {short.group(1) if short else ""}实际运行记录）'
    text = text.replace(PENDING, label)
    text = re.sub(r'验证状态为待R实测。', f'验证状态为已实测（{version_line}，{date.today().isoformat()}）。', text)
    if log_name not in text:
        text = text.rstrip('\n') + f'\n- 自动核对记录见[{log_name}](../ai_tutor/content_assets/code/{log_name})。\n'
    path.write_text(text, encoding='utf-8')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('ids', nargs='*', help='知识编号，例如 K09；省略时检查所有待R实测草稿')
    parser.add_argument('--all', action='store_true', help='包括已标记为已实测的草稿')
    parser.add_argument('--write', action='store_true', help='全部通过的草稿改为已实测并保存核对记录')
    parser.add_argument('--rscript', default=os.environ.get('RSCRIPT') or shutil.which('Rscript') or 'Rscript')
    args = parser.parse_args(argv)

    drafts = sorted(DRAFTS.glob('K[0-9][0-9].md'))
    if args.ids:
        wanted = {i.upper() for i in args.ids}
        drafts = [d for d in drafts if d.stem in wanted]
    elif not args.all:
        drafts = [d for d in drafts if '验证状态为待R实测' in d.read_text(encoding='utf-8')]
    if not drafts:
        print('没有需要核对的草稿。')
        return 0
    try:
        version = r_version(args.rscript)
    except (OSError, subprocess.SubprocessError):
        print(f'找不到可运行的Rscript：{args.rscript}\n请安装R，或用 --rscript 指定 Rscript 的完整路径。')
        return 2
    print('使用', ' / '.join(version))

    failed_total = 0
    for path in drafts:
        pairs = [p for p in code_pairs(path.read_text(encoding='utf-8')) if p[2] is not None]
        log = [f'{path.stem} 自动核对记录', f'日期 {date.today().isoformat()}', *version, '']
        failures = 0
        with tempfile.TemporaryDirectory() as tmp:
            for line_no, code, expected in pairs:
                stdout, stderr = run_r(args.rscript, code, tmp)
                problems = compare(expected, stdout, stderr)
                failures += bool(problems)
                status = '通过' if not problems else '未通过'
                log += [f'## 第{line_no}行代码块：{status}', code, '--- stdout', stdout.rstrip(),
                        '--- stderr', stderr.rstrip(), '']
                if problems:
                    print(f'{path.stem} 第{line_no}行代码块未通过：')
                    for p in problems:
                        print('  ' + p.replace('\n', '\n  '))
        print(f'{path.stem}: {len(pairs) - failures}/{len(pairs)} 个代码块通过')
        failed_total += failures
        if args.write and not failures and pairs:
            log_name = f'{path.stem}_validation.txt'
            (CODE_DIR / log_name).write_text('\n'.join(log) + '\n', encoding='utf-8')
            mark_verified(path, version[0], log_name)
            print(f'  已标记为已实测，记录保存到 content_assets/code/{log_name}')
    if args.write:
        print('完成后运行 python scripts/import_enrichment.py 更新应用数据。')
    return 1 if failed_total else 0


if __name__ == '__main__':
    sys.exit(main())
