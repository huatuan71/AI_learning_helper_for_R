"""Pure logic of scripts/check_r_outputs.py; running R itself is not needed here."""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('check_r_outputs', ROOT/'scripts/check_r_outputs.py')
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)

DRAFT = """## 基础例题

```r
print(1)
```

### 预期输出（待R实测）

```text
[1] 1
```

### 逐步讲解

```r
print("no expectation")
```

```sh
Rscript x.R
```

## 易错案例

```r
print(1:5 + 1:2)
```

### 实际错误或异常结果（待R实测）

```text
[1] 2 4 4 6 6
Warning message:
In 1:5 + 1:2 :
  longer object length is not a multiple of shorter object length
```
"""
WARNING = 'Warning message:\nIn 1:5 + 1:2 : longer object length is not a multiple of shorter object length\n'


def test_pairs_follow_expectation_headings_only():
    pairs = checker.code_pairs(DRAFT)
    assert [p[1] for p in pairs] == ['print(1)', 'print("no expectation")', 'print(1:5 + 1:2)']
    assert pairs[0][2] == '[1] 1' and pairs[1][2] is None and pairs[2][2].startswith('[1] 2 4')


def test_every_shipped_pending_draft_pairs_cleanly():
    for path in sorted((ROOT.parent/'知识库补充草稿').glob('K*.md')):
        text = path.read_text(encoding='utf-8')
        if '验证状态为待R实测' in text:
            pairs = checker.code_pairs(text)
            assert pairs and all(p[2] is not None for p in pairs), path.name


def test_compare_ignores_trailing_spaces_and_matches_wrapped_warnings():
    expected = checker.code_pairs(DRAFT)[2][2]
    assert checker.compare(expected, '[1] 2 4 4 6 6   \n\n', WARNING) == []
    assert checker.compare('[1] 1', '[1] 1\n', '') == []


def test_compare_reports_wrong_output_missing_and_unexpected_diagnostics():
    expected = checker.code_pairs(DRAFT)[2][2]
    problems = checker.compare(expected, '[1] 2 4 4 6 7\n', '')
    assert any('输出不一致' in p for p in problems)
    assert any('longer object length' in p for p in problems)
    assert any('预期之外' in p for p in checker.compare('[1] 1', '[1] 1\n', 'Warning message:\nboom'))


def test_ellipsis_is_a_wildcard_in_error_lines():
    stderr = "Error in cut.default(x, breaks = b, labels = l) : \n  number of intervals and length of 'labels' differ"
    assert checker.compare("Error in cut.default(...) :\n  number of intervals...differ", '', stderr) == []
