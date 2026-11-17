"""Deterministic course exercise fixtures shared with browser MockTransport."""


def exercise_input(**updates):
    body = {'schema_version': 1, 'knowledge_ids': ['K06'], 'count': 3,
            'difficulty': 'basic', 'formats': ['choice', 'short_answer', 'code_reading', 'code_fix'],
            'recent_prompts': []}
    body.update(updates)
    return body


def exercise_result(body=None):
    from app.ai.exercise_generation import question_plan
    from app.ai.exercise_schemas import ExerciseRequest
    from app.engine import KNOWLEDGE

    body = body or exercise_input()
    result = []
    for i, assigned in enumerate(question_plan(ExerciseRequest.model_validate(body))):
        title = '、'.join(KNOWLEDGE[kid]['title'] for kid in assigned['knowledge_ids'])
        fmt = assigned['format']
        choice = fmt == 'choice'
        question = {
            'knowledge_ids': assigned['knowledge_ids'], 'learning_type': 'concept' if choice else 'application',
            'format': fmt, 'difficulty': body['difficulty'],
            'prompt': f'围绕{title}，说明课程中的关键注意事项（练习{i + 1}）。',
            'code': '', 'choices': ['使用is.na检查缺失', '使用x == NA筛选缺失', 'NA总是等于0', '移除NA会修改原向量'] if choice else [],
            'correct_index': 0 if choice else None,
            'hints': ['先阅读课程解释，再检查输入和输出。'],
            'reference_answer': '使用is.na判断缺失值，汇总时按需要指定na.rm=TRUE。',
            'solution_code': '', 'explanation': 'NA比较会传播缺失，is.na返回逐元素的缺失判断。',
        }
        if fmt == 'code_reading':
            question.update(prompt=f'解释下面小向量求均值的结果（练习{i + 1}）。',
                            code='x <- c(2, NA, 4)\nmean(x, na.rm = TRUE)',
                            reference_answer='结果为3。', explanation='移除缺失项后，2与4的算术均值为3。')
        if fmt == 'code_fix':
            question.update(prompt=f'目标是保留向量中的非缺失值，请修正下面筛选代码（练习{i + 1}）。',
                            code='x <- c(2, NA, 4)\nx[x != NA]', solution_code='x[!is.na(x)]',
                            reference_answer='使用!is.na(x)构造非缺失位置的逻辑索引。')
        result.append(question)
    return {'questions': result}
