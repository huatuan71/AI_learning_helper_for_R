"""Rebuild the published course snapshot from explicit or discovered source files."""
import argparse
import hashlib
from io import BytesIO
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import xml.etree.ElementTree as ET
from zipfile import BadZipFile, ZipFile

from openpyxl import load_workbook
from openpyxl.utils.exceptions import InvalidFileException


ROOT = Path(__file__).resolve().parents[1]
NS = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
FILES = {'S1': 'r-installation-ch11.pdf', 'S2': 'r-installation-ch12.pdf',
         'S3': 'r-data-operations-ch02.pdf', 'S4': 'r-for-data-science-zh.pdf'}
COUNTS = {'knowledge': 43, 'questions': 24, 'errors': 14, 'relations': 95}


def resolve_input(source_dir, explicit, suffix):
    if explicit is not None:
        path = Path(explicit).resolve()
        if not path.is_file() or path.suffix.lower() != suffix:
            raise ValueError(f'请指定存在的 {suffix} 文件，收到 {path}')
        return path
    if source_dir is None:
        source_dir = next((parent / 'content' / 'sources' for parent in ROOT.parents
                           if (parent / 'content' / 'sources').is_dir()), None)
        if source_dir is None:
            raise ValueError('未找到课程资料目录，请使用 --source-dir 或显式文件参数')
    source_dir = Path(source_dir).resolve()
    if not source_dir.is_dir():
        raise ValueError(f'课程资料目录不存在 {source_dir}')
    candidates = sorted(path for path in source_dir.iterdir()
                        if path.is_file() and path.suffix.lower() == suffix
                        and not path.name.startswith('~$'))
    if len(candidates) != 1:
        option = '--docx' if suffix == '.docx' else '--xlsx'
        names = '、'.join(path.name for path in candidates) or '无'
        raise ValueError(f'{source_dir} 中找到 {len(candidates)} 个 {suffix} 文件（{names}），'
                         f'请用 {option} 指定唯一输入')
    return candidates[0]


def paragraphs(content):
    with ZipFile(BytesIO(content)) as package:
        root = ET.fromstring(package.read('word/document.xml'))
    for paragraph in root.findall('.//w:p', NS):
        text = ''.join('\n' if node.tag == f"{{{NS['w']}}}br" else
                       '\t' if node.tag == f"{{{NS['w']}}}tab" else
                       (node.text or '') if node.tag == f"{{{NS['w']}}}t" else ''
                       for node in paragraph.iter())
        if text.strip():
            yield text.strip()


def sources(raw):
    result = []
    raw = re.split('先修：|关联条目：|核验：', raw)[0].strip('。 ')
    for match in re.finditer(r'(S[1-5])\s*([^；]+)', raw):
        source_id, locator = match.groups()
        result.append({'source_id': source_id, 'file': FILES.get(source_id, '现代接口官方文档补充'),
                       'locator': locator.strip(), 'raw': raw})
    return result


def validate_course(data):
    for key, expected in COUNTS.items():
        actual = len(data[key])
        if actual != expected:
            raise ValueError(f'{key} 应有 {expected} 条，实际为 {actual} 条')
    knowledge_ids = {item['id'] for item in data['knowledge']}
    expected_ids = {f'K{number:02d}' for number in range(1, COUNTS['knowledge'] + 1)}
    if knowledge_ids != expected_ids:
        raise ValueError('知识点编号必须完整覆盖 K01 至 K43')
    for key in ('knowledge', 'questions', 'errors'):
        if len({item['id'] for item in data[key]}) != len(data[key]):
            raise ValueError(f'{key} 含重复编号')
        for item in data[key]:
            if not item['sources']:
                raise ValueError(f"{item['id']} 缺少有效来源")
            if not set(item['knowledge_ids']) <= knowledge_ids:
                raise ValueError(f"{item['id']} 引用了不存在的知识点")
    for item in data['knowledge']:
        if not set(item['prerequisites']) <= knowledge_ids:
            raise ValueError(f"{item['id']} 引用了不存在的先修知识点")
        for field in ('解释', '函数语法', '参数说明', '运行示例', '易错提醒', '练习提示'):
            if not item['fields'].get(field):
                raise ValueError(f"{item['id']} 缺少必填字段 {field}")


def build_course(doc, book):
    # Parse and hash the same captured bytes even if source files change during an import.
    doc_bytes, book_bytes = doc.read_bytes(), book.read_bytes()
    rows = list(paragraphs(doc_bytes))
    start = next((index for index, paragraph in enumerate(rows[:-1])
                  if re.match(r'^K01\s', paragraph) and rows[index + 1].startswith('【来源】')), None)
    if start is None:
        raise ValueError(f'{doc.name} 中未找到 K01 知识条目')
    blocks = []
    for paragraph in rows[start:]:
        match = re.match(r'^([KQE]\d{2})\s+(.+)', paragraph)
        if match:
            blocks.append({'id': match[1], 'title': match[2], 'body': []})
        elif blocks and not re.match(r'^[四五]、', paragraph):
            blocks[-1]['body'].append(paragraph)
    data = {'knowledge': [], 'questions': [], 'errors': [], 'relations': [], 'warnings': []}
    for block in blocks:
        fields, field = {}, 'intro'
        for paragraph in block.pop('body'):
            match = re.match(r'^【([^】]+)】(.*)', paragraph, re.S)
            if match:
                field = match[1]
                fields[field] = match[2]
            elif paragraph == '参考输出':
                field = '参考输出'
                fields[field] = ''
            else:
                fields[field] = (fields.get(field, '') + '\n' + paragraph).strip()
        block['fields'] = fields
        block['sources'] = sources(fields.get('来源', '').split('\n')[0])
        block['knowledge_ids'] = re.findall(r'K\d{2}', fields.get('来源', '').split('\n')[0])
        if block['id'].startswith('K'):
            block['knowledge_ids'] = [block['id']]
            block['prerequisites'] = re.findall(r'K\d{2}', fields.get('来源', ''))
            block['chapter'] = ''
            block['keywords'] = sorted(set(re.findall(r'[A-Za-z][A-Za-z0-9_.]*',
                block['title'] + ' ' + fields.get('函数语法', ''))))
            block['verification'] = '来源文档的核验记录；本应用未执行R代码'
            data['knowledge'].append(block)
        elif block['id'].startswith('Q'):
            block['question'] = fields.get('intro', '')
            data['questions'].append(block)
        else:
            data['errors'].append(block)
    workbook = load_workbook(BytesIO(book_bytes), read_only=True, data_only=True)
    try:
        sheets = {sheet.title: list(sheet.values) for sheet in workbook}
    finally:
        workbook.close()
    for name in ('知识目录', '知识关联'):
        if name not in sheets or len(sheets[name]) < 5:
            raise ValueError(f'{book.name} 缺少有效的 {name} 工作表及第5行表头')
    if any(len(rows) < 5 for rows in sheets.values()):
        raise ValueError(f'{book.name} 的工作表缺少第5行表头')
    index = {item['id']: item for item in data['knowledge']}
    # Source workbooks also contain explanatory rows after the knowledge catalog.
    for row in sheets['知识目录'][5:]:
        if str(row[0]) in index:
            if len(row) < 3:
                raise ValueError(f'{book.name} 的知识目录行缺少层级字段')
            index[row[0]]['catalog_row'] = [str(value or '') for value in row]
            index[row[0]]['level'] = str(row[2] or '')
    chapters = [(3, '环境与自助学习'), (8, '类型与缺失'), (18, '向量与字符串'),
                (24, '矩阵与数组'), (30, '数据框'), (34, '列表与批量处理'),
                (38, '函数与控制'), (43, '综合与包扩展')]
    for item in index.values():
        chapter = next((title for end, title in chapters if int(item['id'][1:]) <= end), None)
        if chapter is None:
            raise ValueError(f"知识点编号超出课程范围 {item['id']}")
        item['chapter'] = chapter
    for row in sheets['知识关联'][5:]:
        if not any(row):
            continue
        if len(row) < 4 or str(row[0]) not in index or str(row[1]) not in index:
            raise ValueError(f'{book.name} 的知识关联含无效行 {row}')
        data['relations'].append({'from': row[0], 'to': row[1], 'type': str(row[2]),
                                  'description': str(row[3] or '')})
    validate_course(data)
    data['warnings'] = ['Excel说明标记39个条目已运行、4个包扩展待实测；保留Word逐条核验原文，不将全部条目视为已执行。',
                        '本次只核查资料结构、来源字段和代码换行，没有重新运行R代码或逐页审计PDF。']
    data['version'] = hashlib.sha256(doc_bytes + book_bytes).hexdigest()[:12]
    data['source_files'] = [doc.name, book.name]
    audit = {'counts': {key: len(data[key]) for key in COUNTS},
             'version': data['version'], 'warnings': data['warnings'],
             'excel_headers': {key: list(rows[4]) for key, rows in sheets.items()},
             'multiline_examples': sum('\n' in item['fields']['运行示例'] for item in data['knowledge']),
             'source_files': [{'file': path.name, 'sha256': hashlib.sha256(content).hexdigest(),
                               'size_bytes': len(content)}
                              for path, content in ((doc, doc_bytes), (book, book_bytes))]}
    return data, audit


def write_outputs(output_dir, data, audit):
    output_dir = Path(output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    with (output_dir / '.import.lock').open('a+b') as lock:
        # OS locks are released when the handle closes, including after a process exits.
        if os.name == 'nt':
            import msvcrt
            if lock.tell() == 0:
                lock.write(b'\0')
                lock.flush()
            lock.seek(0)
            try:
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError as error:
                raise ValueError('无法获得课程导入写锁，请确认其他导入已结束') from error
        else:
            import fcntl
            try:
                fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as error:
                raise ValueError('无法获得课程导入写锁，请确认其他导入已结束') from error
        staging = Path(tempfile.mkdtemp(prefix='.import-', dir=output_dir))
        keep_staging = False
        report_path = output_dir / 'import_report.json'
        backup = staging / 'previous-import_report.json'
        report_published = False
        try:
            (staging / 'course.json').write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
            (staging / 'import_report.json').write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding='utf-8')
            if report_path.exists():
                backup.write_bytes(report_path.read_bytes())
            os.replace(staging / 'import_report.json', report_path)
            report_published = True
            # Publish the dataset last so readers always receive a complete validated snapshot.
            os.replace(staging / 'course.json', output_dir / 'course.json')
        except OSError as error:
            if report_published:
                try:
                    if backup.exists():
                        os.replace(backup, report_path)
                    else:
                        report_path.unlink()
                except OSError as rollback_error:
                    keep_staging = True
                    raise OSError(f'课程发布失败且报告回滚失败，恢复文件保留于 {staging}') from rollback_error
            raise error
        finally:
            if not keep_staging:
                shutil.rmtree(staging, ignore_errors=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path, help='课程资料目录，自动发现唯一的 Word 和 Excel 文件')
    parser.add_argument('--docx', type=Path, help='显式指定课程 Word 文件')
    parser.add_argument('--xlsx', type=Path, help='显式指定知识目录 Excel 文件')
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'data', help='课程快照与导入报告的输出目录')
    args = parser.parse_args(argv)
    try:
        doc = resolve_input(args.source_dir, args.docx, '.docx')
        book = resolve_input(args.source_dir, args.xlsx, '.xlsx')
        data, audit = build_course(doc, book)
        write_outputs(args.output_dir, data, audit)
    except (ValueError, OSError, BadZipFile, ET.ParseError, KeyError, InvalidFileException) as error:
        parser.error(f'导入失败，{error}')
    print(json.dumps(audit, ensure_ascii=False))


if __name__ == '__main__':
    main()
