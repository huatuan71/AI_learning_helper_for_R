"""Course import compatibility, deterministic inputs and publication failure recovery."""
import hashlib
import importlib.util
import json
from pathlib import Path
from zipfile import ZipFile

from openpyxl import load_workbook, Workbook
import pytest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('course_import', ROOT / 'scripts/import_data.py')
importer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(importer)


@pytest.fixture
def source_files():
    return (importer.resolve_input(None, None, '.docx'),
            importer.resolve_input(None, None, '.xlsx'))


@pytest.fixture
def previous_output(tmp_path):
    (tmp_path / 'course.json').write_bytes(b'{"version":"previous"}\n')
    (tmp_path / 'import_report.json').write_bytes(b'{"version":"previous","audit":true}\n')
    return {name: (tmp_path / name).read_bytes()
            for name in ('course.json', 'import_report.json')}


def test_default_import_reproduces_course_and_records_sources(tmp_path, source_files, capsys):
    importer.main(['--output-dir', str(tmp_path)])
    assert (tmp_path / 'course.json').read_bytes() == (ROOT / 'data/course.json').read_bytes()
    report = json.loads((tmp_path / 'import_report.json').read_text(encoding='utf-8'))
    previous = json.loads((ROOT / 'data/import_report.json').read_text(encoding='utf-8'))
    assert {key: report[key] for key in previous} == previous
    assert report['source_files'] == [
        {'file': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
         'size_bytes': path.stat().st_size} for path in source_files]
    assert json.loads(capsys.readouterr().out) == report


def test_explicit_files_override_discovery(tmp_path, source_files, capsys):
    doc, book = source_files
    importer.main(['--source-dir', str(tmp_path / 'absent'), '--docx', str(doc),
                   '--xlsx', str(book), '--output-dir', str(tmp_path / 'output')])
    assert (tmp_path / 'output/course.json').read_bytes() == (ROOT / 'data/course.json').read_bytes()
    capsys.readouterr()


def test_discovery_follows_nearest_source_directory_after_app_move(tmp_path, monkeypatch):
    moved_root = tmp_path / 'project/apps/nested/tutor'
    source = tmp_path / 'project/content/sources'
    source.mkdir(parents=True)
    document = source / 'course.docx'
    document.touch()
    monkeypatch.setattr(importer, 'ROOT', moved_root)
    assert importer.resolve_input(None, None, '.docx') == document.resolve()


def test_default_source_paths_use_the_ascii_catalog(source_files):
    assert source_files == (ROOT.parent / 'content/sources/course-knowledge.docx',
                            ROOT.parent / 'content/sources/knowledge-catalog.xlsx')
    data, _ = importer.build_course(*source_files)
    assert data['source_files'] == ['course-knowledge.docx', 'knowledge-catalog.xlsx']
    assert data['version'] == hashlib.sha256(b''.join(path.read_bytes() for path in source_files)).hexdigest()[:12]
    for collection in ('knowledge', 'questions', 'errors'):
        for item in data[collection]:
            for source in item['sources']:
                assert set(source) == {'source_id', 'file', 'locator', 'raw'}
                if source['file'].endswith('.pdf'):
                    assert source['file'].isascii()
                    assert (ROOT.parent / 'content/sources' / source['file']).is_file()


@pytest.mark.parametrize('suffix,option', [('.docx', '--docx'), ('.xlsx', '--xlsx')])
def test_discovery_rejects_ambiguous_files(tmp_path, suffix, option):
    (tmp_path / ('first' + suffix)).touch()
    (tmp_path / ('second' + suffix)).touch()
    with pytest.raises(ValueError, match=option):
        importer.resolve_input(tmp_path, None, suffix)


def test_discovery_ignores_office_lock_files(tmp_path):
    chosen = tmp_path / 'course.docx'
    chosen.touch()
    (tmp_path / '~$course.docx').touch()
    assert importer.resolve_input(tmp_path, None, '.docx') == chosen.resolve()


def test_missing_and_wrong_type_inputs_are_explicit(tmp_path):
    with pytest.raises(ValueError, match='0 个 .docx'):
        importer.resolve_input(tmp_path, None, '.docx')
    with pytest.raises(ValueError, match='目录不存在'):
        importer.resolve_input(tmp_path / 'absent', None, '.docx')
    with pytest.raises(ValueError, match='存在的 .docx 文件'):
        importer.resolve_input(None, tmp_path / 'absent.docx', '.docx')
    wrong_type = tmp_path / 'course.txt'
    wrong_type.touch()
    with pytest.raises(ValueError, match='存在的 .docx 文件'):
        importer.resolve_input(None, wrong_type, '.docx')


def test_invalid_word_preserves_previous_outputs(tmp_path, previous_output, source_files, capsys):
    document = tmp_path / 'invalid.docx'
    with ZipFile(document, 'w') as package:
        package.writestr('word/document.xml',
                        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>')
    with pytest.raises(SystemExit) as error:
        importer.main(['--docx', str(document), '--xlsx', str(source_files[1]),
                       '--output-dir', str(tmp_path)])
    assert error.value.code == 2
    assert '未找到 K01' in capsys.readouterr().err
    assert {name: (tmp_path / name).read_bytes() for name in previous_output} == previous_output


def test_invalid_workbook_preserves_previous_outputs(tmp_path, previous_output, source_files, capsys):
    book = tmp_path / 'invalid.xlsx'
    workbook = Workbook()
    workbook.save(book)
    workbook.close()
    with pytest.raises(SystemExit) as error:
        importer.main(['--docx', str(source_files[0]), '--xlsx', str(book),
                       '--output-dir', str(tmp_path)])
    assert error.value.code == 2
    assert '知识目录' in capsys.readouterr().err
    assert {name: (tmp_path / name).read_bytes() for name in previous_output} == previous_output


def test_invalid_relation_is_rejected(tmp_path, source_files):
    workbook = load_workbook(source_files[1])
    workbook['知识关联']['A6'] = 'K99'
    broken = tmp_path / 'invalid-relation.xlsx'
    workbook.save(broken)
    workbook.close()
    with pytest.raises(ValueError, match='知识关联含无效行'):
        importer.build_course(source_files[0], broken)


def test_missing_required_content_is_rejected():
    data = json.loads((ROOT / 'data/course.json').read_text(encoding='utf-8'))
    del data['knowledge'][0]['fields']['解释']
    with pytest.raises(ValueError, match='缺少必填字段 解释'):
        importer.validate_course(data)


def test_staging_failure_preserves_previous_outputs(tmp_path, previous_output, monkeypatch):
    write_text = Path.write_text

    def fail_report_write(path, *args, **kwargs):
        if path.name == 'import_report.json' and path.parent.name.startswith('.import-'):
            raise OSError('injected staging failure')
        return write_text(path, *args, **kwargs)

    monkeypatch.setattr(Path, 'write_text', fail_report_write)
    with pytest.raises(OSError, match='injected staging failure'):
        importer.write_outputs(tmp_path, {'version': 'new'}, {'version': 'new'})
    assert {name: (tmp_path / name).read_bytes() for name in previous_output} == previous_output
    assert not list(tmp_path.glob('.import-*'))


@pytest.mark.parametrize('failing_target', ['import_report.json', 'course.json'])
def test_failed_publication_restores_previous_pair(tmp_path, previous_output, monkeypatch, failing_target):
    replace = importer.os.replace

    def fail_publish(source, destination):
        if Path(source).name == failing_target:
            raise OSError('injected publication failure')
        replace(source, destination)

    monkeypatch.setattr(importer.os, 'replace', fail_publish)
    with pytest.raises(OSError, match='injected publication failure'):
        importer.write_outputs(tmp_path, {'version': 'new'}, {'version': 'new'})
    assert {name: (tmp_path / name).read_bytes() for name in previous_output} == previous_output
    assert not list(tmp_path.glob('.import-*'))


def test_failed_first_publication_removes_new_report(tmp_path, monkeypatch):
    replace = importer.os.replace

    def fail_course(source, destination):
        if Path(source).name == 'course.json':
            raise OSError('injected course failure')
        replace(source, destination)

    monkeypatch.setattr(importer.os, 'replace', fail_course)
    with pytest.raises(OSError, match='injected course failure'):
        importer.write_outputs(tmp_path, {'version': 'new'}, {'version': 'new'})
    assert not (tmp_path / 'course.json').exists()
    assert not (tmp_path / 'import_report.json').exists()


def test_rollback_failure_retains_recovery_files(tmp_path, previous_output, monkeypatch):
    replace = importer.os.replace

    def fail_course_and_restore(source, destination):
        if Path(source).name in {'course.json', 'previous-import_report.json'}:
            raise OSError('injected replacement failure')
        replace(source, destination)

    monkeypatch.setattr(importer.os, 'replace', fail_course_and_restore)
    with pytest.raises(OSError, match='恢复文件保留于'):
        importer.write_outputs(tmp_path, {'version': 'new'}, {'version': 'new'})
    assert (tmp_path / 'course.json').read_bytes() == previous_output['course.json']
    recovery, = tmp_path.glob('.import-*')
    assert (recovery / 'previous-import_report.json').read_bytes() == previous_output['import_report.json']


def test_same_process_can_publish_repeatedly(tmp_path):
    for version in ('first', 'second'):
        importer.write_outputs(tmp_path, {'version': version}, {'version': version})
        for name in ('course.json', 'import_report.json'):
            assert json.loads((tmp_path / name).read_text(encoding='utf-8')) == {'version': version}


def test_competing_writer_is_rejected_without_replacing_data(tmp_path, monkeypatch):
    replace = importer.os.replace
    attempted = False

    def check_competing_writer(source, destination):
        nonlocal attempted
        if not attempted:
            attempted = True
            with pytest.raises(ValueError, match='导入写锁'):
                importer.write_outputs(tmp_path, {'version': 'competing'}, {'version': 'competing'})
        replace(source, destination)

    monkeypatch.setattr(importer.os, 'replace', check_competing_writer)
    importer.write_outputs(tmp_path, {'version': 'first'}, {'version': 'first'})
    assert attempted
    for name in ('course.json', 'import_report.json'):
        assert json.loads((tmp_path / name).read_text(encoding='utf-8')) == {'version': 'first'}
