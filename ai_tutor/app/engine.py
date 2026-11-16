"""Deterministic course retrieval. No model calls and no R execution."""
import json
import re
from difflib import SequenceMatcher
from .config import COURSE_PATH

DATA = json.loads(COURSE_PATH.read_text(encoding='utf-8'))
KNOWLEDGE = {x['id']: x for x in DATA['knowledge']}
QUESTIONS = DATA['questions']
ERRORS = DATA['errors']
ALIASES = {
 'K01': ['安装R', 'RStudio', '对象不存在'], 'K02': ['安装包', '加载包', 'library'],
 'K04': ['数据类型', '数值类型', '字符类型', 'numeric', 'character', 'typeof'],
 'K05': ['逻辑运算', '&&', '逻辑条件'], 'K06': ['缺失', '空值', 'NA', 'NaN', 'na.rm', 'is.na'],
 'K07': ['因子', 'factor', 'levels'], 'K08': ['日期', '时间', 'as.Date'],
 'K09': ['向量', '创建向量', '随机抽样'], 'K10': ['向量索引', 'which'],
 'K11': ['循环补齐', '向量运算'], 'K14': ['排序', 'sort', 'order', 'rank'],
 'K15': ['cut', '区间'], 'K19': ['矩阵', 'matrix'], 'K21': ['矩阵乘法', '%*%'],
 'K25': ['数据框', 'data.frame'], 'K27': ['合并', 'merge'], 'K28': ['缺失处理'],
 'K29': ['长宽', 'reshape'], 'K30': ['分组汇总', 'aggregate', 'tapply'],
 'K31': ['列表', 'list', '[['], 'K35': ['自定义函数'], 'K36': ['if', 'ifelse', '条件分支'],
 'K37': ['循环', 'for', 'while', 'seq_along', '空向量'], 'K38': ['CSV', '文件导入'],
 'K39': ['电影', '综合清洗'], 'K40': ['dplyr', '管道'], 'K41': ['pivot_longer', 'pivot_wider'],
}
FOLLOW = re.compile(r'^(再|能|可以|请|给我|那|有什么|这个|它|详细|举|示例|易错|练习|参考答案)')


def norm(s):
    return re.sub(r'\s+', '', s).lower().strip('？?。！!')


def contains(text, term):
    if re.fullmatch(r'[A-Za-z][A-Za-z0-9_.]*', term):
        return bool(re.search(r'(?<![\w.])'+re.escape(term)+r'(?![\w.])', text, re.I|re.ASCII))
    return term.lower() in text.lower()


def similar(a, b):
    a, b = norm(a), norm(b)
    if not a or not b:
        return 0
    return SequenceMatcher(None, a, b).ratio()


def retrieve(text):
    scored = []
    for k in KNOWLEDGE.values():
        score = sum(5+min(len(term),8) for term in ALIASES.get(k['id'], []) if contains(text, term))
        score += sum(3 for term in k['keywords'] if len(term)>2 and contains(text, term) and term not in ['FALSE', 'TRUE', 'NULL'])
        score += 50 if k['id'].lower() in text.lower() else 0
        score += 10 if k['title'] in text else 0
        if score:
            scored.append((score, k['id']))
    return [k for _,k in sorted(scored, key=lambda x: (-x[0], x[1]))[:4]]


def match_error(code, text):
    if code.strip():
        for e in ERRORS:
            if code.strip().replace('\r\n','\n') == e['fields'].get('复现代码', '').strip().replace('\r\n','\n'):
                return e, None
        # Conservative patterns; do not infer runtime object types or execute input.
        patterns = [('E04', r'\b\w+\s*==\s*NA\b'), ('E02', '[“”‘’]'),
                    ('E01', r'"\d+"\s*\+\s*\d+'), ('E10', r'\bif\s*\(\s*NA\s*\)'),
                    ('E11', r'1\s*:\s*length\s*\(')]
        for i, line in enumerate(code.splitlines(), 1):
            # Skip comment-only lines. Pattern evidence is a suggestion, not execution.
            if line.lstrip().startswith('#'):
                continue
            clean = re.sub(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|#.*', ' ', line)
            for eid, pattern in patterns:
                evidence = line.split('#')[0] if eid == 'E01' else clean
                if re.search(pattern, evidence):
                    return next(e for e in ERRORS if e['id']==eid), i
    for e in ERRORS:
        if contains(text, e['id']) or e['title'] in text:
            return e, None
    return None, None


def answer(req, force_review=False):
    text = req.question.strip()
    task = 'debug' if force_review else req.task_type
    q = next((q for q in QUESTIONS if norm(q['question']) == norm(text)), None)
    if q is None and text:
        candidates = sorted(((similar(text, q['question']), q) for q in QUESTIONS), key=lambda x: -x[0])
        if candidates[0][0] >= .70:
            q = candidates[0][1]
    if task == 'auto':
        task = 'debug' if req.code.strip() or any(w in text for w in ['报错','纠错','不对','错误']) else 'exercise' if any(w in text for w in ['练习','综合','参考答案']) else 'function' if any(w in text for w in ['用法','参数','怎么用']) else 'concept'
        if q:
            task = {'基础概念':'concept','函数应用':'function','报错排查':'debug','综合练习':'exercise'}.get(q['title'], task)
    err, line = match_error(req.code, text+' '+req.error_message) if task=='debug' else (None,None)
    ids = err['knowledge_ids'][:] if err else q['knowledge_ids'][:] if q else retrieve(text+' '+req.code+' '+req.error_message)
    # Debugging unfamiliar code must not silently become a confident diagnosis.
    unsupported_debug = task=='debug' and not err and not q
    is_follow = bool(FOLLOW.search(text)) and any(w in text for w in ['例子','易错','练习','详细','参考答案','示例'])
    if not ids and is_follow and not unsupported_debug:
        if req.knowledge_id:
            ids = [req.knowledge_id]
        else:
            for h in reversed(req.history):
                if h.role == 'user' and (ids := retrieve(h.content)):
                    break
    if not ids and req.knowledge_id and not text and not req.code:
        ids = [req.knowledge_id]
    if not ids and req.knowledge_id and text in ['讲解这个知识点', '查看知识点']:
        ids = [req.knowledge_id]
    result = {'status':'ok', 'mode':'mock', 'task_type':task,
              'answer': {'summary':'', 'steps':[], 'issues':[], 'corrected_code':'', 'example_code':'',
                         'expected_output':'', 'execution_status':'not_executed', 'code_kind':'reference_example',
                         'follow_ups':['举个例子','有什么易错点','给我练习']},
              'citations':[], 'related_knowledge':ids[:4], 'matched_case_id':None,
              'prompt_version':'mock-rules-v1', 'knowledge_version':DATA['version']}
    a = result['answer']
    if unsupported_debug or not ids:
        result['status'] = 'no_match'
        a['summary'] = '模拟版未找到可确定匹配的错误案例，请提供最小复现代码、完整报错和预期结果。' if task=='debug' else '当前课程资料未找到可靠匹配。请使用具体R函数名、知识点名称或左侧课程导航。'
        a['follow_ups'] = []
        result['related_knowledge'] = []
        return result
    for kid in ids[:4]:
        for source in KNOWLEDGE[kid]['sources']:
            result['citations'].append({'knowledge_id':kid, **source})
    k = KNOWLEDGE[ids[0]]
    f = k['fields']
    if err:
        ef = err['fields']
        reason = ef.get('实际表现','').partition('原因：')[2].strip()
        a['summary'] = '匹配课程错误案例：'+err['title']+'。以下为参考分析，不是执行结果。'
        a['steps'] = [reason, '参考案例的变量和数据可能与你不同，请按任务含义调整。']
        a['issues'] = [{'kind':ef.get('问题类型','error').strip('。'), 'line':line, 'reason':reason}]
        a['corrected_code'] = ef.get('修正代码','')
        a['expected_output'] = ef.get('修正输出','')
        result['matched_case_id'] = err['id']
    elif task=='exercise':
        a['summary'] = q['question'] if q else f['练习提示']
        a['steps'] = ['先明确输入类型和期望输出。', '复习：'+k['title'], '提示：'+f['易错提醒']]
        if req.teaching_mode=='solution':
            a['summary'] = q['fields'].get('参考回答','') if q else '该知识点未收录此练习的专门参考答案；下面展示相关教学示例。'
            a['example_code'] = q['fields'].get('来源','').partition('\n')[2] if q else f['运行示例']
            a['expected_output'] = q['fields'].get('参考输出','') if q else f.get('实际输出','')
        result['matched_case_id'] = q['id'] if q else None
    else:
        a['summary'] = q['fields'].get('参考回答','') if q else f['解释']
        a['steps'] = ['语法：'+f['函数语法'], '参数：'+f['参数说明'], '易错提醒：'+f['易错提醒']]
        a['example_code'] = q['fields'].get('来源','').partition('\n')[2] if q else f['运行示例']
        a['expected_output'] = q['fields'].get('参考输出','') if q else f.get('实际输出','')
        result['matched_case_id'] = q['id'] if q else None
        if '易错' in text:
            a['summary'] = f['易错提醒']
        if task=='debug' and q:
            a['corrected_code'] = a.pop('example_code')
            a['example_code'] = ''
        if not q and '区别' in text and len(ids)>1:
            a['summary'] = '\n'.join(KNOWLEDGE[kid]['title']+'：'+KNOWLEDGE[kid]['fields']['解释'] for kid in ids[:2])
    return result
