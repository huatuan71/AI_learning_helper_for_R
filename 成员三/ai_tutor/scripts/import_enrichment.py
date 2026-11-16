"""Import the knowledge supplement drafts (成员三/知识库补充草稿/Kxx.md) into data/enrichment.json.

The drafts stay the editable source. This script only reads them, rewrites links so the web page
can open the bundled code and images, and refuses to write output when a referenced asset is missing.
Run from the ai_tutor directory:  python scripts/import_enrichment.py
"""
from pathlib import Path
import hashlib
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
DRAFTS = ROOT.parent / '知识库补充草稿'
ASSETS = ROOT / 'content_assets'
OUTPUT = ROOT / 'data' / 'enrichment.json'
VERSION = '1.0.0'

# Sections shown to learners, in display order. 基本信息 is parsed into metadata instead,
# 追问建议 is guidance for writers and the AI, not page content.
DISPLAY = ['学习目标', '先备检查', '直观理解', '为什么', '基础例题', '应用例题', '图解方案',
           '易错案例', '完整练习', '自测题', '来源与验证']
HIDDEN = {'基本信息', '追问建议'}
ASSET_LINK = re.compile(r'(!?)\[([^\]]*)\]\(\.\./ai_tutor/content_assets/(code|images)/([A-Za-z0-9_.-]+)\)')
OTHER_LINK = re.compile(r'(?<!!)\[([^\]]+)\]\((?!/content/)[^)]*\)')
SAFE_NAME = re.compile(r'^K\d{2}_[A-Za-z0-9_]+\.(R|txt|svg)$')


def split_sections(text):
    """Split on level-2 headings that are outside fenced code blocks."""
    title, sections, current, fence = None, [], None, None
    for line in text.splitlines():
        marker = re.match(r'^(```+|~~~+)', line)
        if marker:
            token = marker.group(1)
            if fence is None:
                fence = token[0] * len(token)
            elif line.strip().startswith(fence) and line.strip().strip(fence[0]) == '':
                fence = None
        if fence is None and not marker:
            if line.startswith('# ') and title is None:
                title = line[2:].strip()
                continue
            if line.startswith('## '):
                current = {'title': line[3:].strip(), 'lines': []}
                sections.append(current)
                continue
        if current is not None:
            current['lines'].append(line)
    if fence is not None:
        raise ValueError('代码块未闭合')
    return title, [{'title': s['title'], 'markdown': '\n'.join(s['lines']).strip()} for s in sections]


def metadata(basic):
    meta = {}
    for key, pattern in {'unit': r'所属单元为(.+?)。', 'difficulty': r'难度为(.+?)。', 'verification': r'验证状态为(.+?)。',
                         'prerequisites': r'前置知识为(.+?)。', 'related': r'关联知识为(.+?)。'}.items():
        m = re.search(pattern, basic)
        if m:
            value = m.group(1).strip()
            meta[key] = re.findall(r'K\d{2}', value) if key in ('prerequisites', 'related') else value
    return meta


def rewrite_links(markdown, kid, used, problems):
    def asset(m):
        bang, label, kind, name = m.groups()
        path = ASSETS / kind / name
        if not SAFE_NAME.match(name) or not name.startswith(kid + '_'):
            problems.append(f'{kid}: 资源文件名不符合规则 {kind}/{name}')
        elif not path.is_file():
            problems.append(f'{kid}: 缺少资源 {kind}/{name}')
        used.add(f'{kind}/{name}')
        return f'{bang}[{label}](/content/{kind}/{name})'
    markdown = ASSET_LINK.sub(asset, markdown)
    # Course PDFs are not served by the app; keep the citation text, drop the file link.
    return OTHER_LINK.sub(lambda m: m.group(1), markdown)


def load_draft(path, known_ids):
    kid = path.stem
    text = path.read_text(encoding='utf-8')
    title, sections = split_sections(text)
    problems, used = [], set()
    if kid not in known_ids:
        problems.append(f'{kid}: course.json中没有这个知识编号')
    if not title or not title.startswith(kid + ' '):
        problems.append(f'{kid}: 一级标题应以“{kid} ”开头')
    names = [s['title'] for s in sections]
    for required in ['学习目标', '直观理解', '基础例题', '易错案例', '完整练习']:
        if required not in names:
            problems.append(f'{kid}: 缺少必填章节“{required}”')
    unknown = [n for n in names if n not in DISPLAY and n not in HIDDEN]
    if unknown:
        problems.append(f'{kid}: 无法识别的章节 {unknown}')
    stray = re.findall(r'\]\(\.\./ai_tutor/content_assets/[^)]*\)', text)
    if len(stray) != len(ASSET_LINK.findall(text)):
        problems.append(f'{kid}: 有资源链接无法识别，检查链接文字或图片描述中是否含有方括号')
    by_name = {s['title']: s['markdown'] for s in sections}
    shown = [{'title': n, 'markdown': rewrite_links(by_name[n], kid, used, problems)}
             for n in DISPLAY if by_name.get(n)]
    meta = metadata(by_name.get('基本信息', ''))
    # Drafts state 验证状态为待R实测/已实测; older drafts only record the result under 来源与验证.
    verified = (meta['verification'].startswith('已') if 'verification' in meta
                else '代码验证结果为通过' in by_name.get('来源与验证', ''))
    record = {'id': kid, 'title': title[len(kid):].strip() if title else '',
              **meta, 'verified': verified,
              'sections': shown,
              'follow_ups': re.findall(r'^- (.+)$', by_name.get('追问建议', ''), re.M),
              'assets': sorted(used),
              'source_file': f'知识库补充草稿/{path.name}',
              'sha256': hashlib.sha256(text.encode('utf-8')).hexdigest()}
    return record, problems


def build(drafts=DRAFTS, course=ROOT / 'data' / 'course.json'):
    known = {k['id'] for k in json.loads(Path(course).read_text(encoding='utf-8'))['knowledge']}
    items, problems = {}, []
    for path in sorted(Path(drafts).glob('K[0-9][0-9].md')):
        record, issues = load_draft(path, known)
        items[record['id']] = record
        problems += issues
    return {'version': VERSION, 'count': len(items), 'items': items}, problems


def main():
    data, problems = build()
    if problems:
        print('导入中止，请先修正草稿：', *problems, sep='\n- ')
        return 1
    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'已导入{data["count"]}个知识点补充内容：{", ".join(data["items"])} -> {OUTPUT.relative_to(ROOT)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
