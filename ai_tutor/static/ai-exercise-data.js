import { assertKnowledgeId, normalizeTime, localDay } from './review-scheduler.js?v=learning-v1';

export const EXERCISE_FORMATS = Object.freeze(['choice', 'short_answer', 'code_reading', 'code_fix']);
const RATINGS = ['need_review', 'assisted', 'independent'];
function text(value, name, max, empty = false) {
  if (typeof value !== 'string' || (!empty && !value.trim()) || Array.from(value).length > max || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw new TypeError(`${name}无效`);
  return value;
}
function list(value, max, name) {
  if (!Array.isArray(value) || value.length > max) throw new TypeError(`${name}无效`);
  return value;
}
function ids(value) {
  const result = list(value, 3, '知识范围').map(assertKnowledgeId);
  if (!result.length || new Set(result).size !== result.length) throw new TypeError('请选择1至3个不同知识点');
  return result;
}
function enumValue(value, values, name) {
  if (!values.includes(value)) throw new TypeError(`${name}无效`);
  return value;
}
export function recommendExerciseKnowledge(snapshot, options = {}) {
  const now = normalizeTime(options.now || new Date().toISOString());
  const timeZone = options.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  localDay(now, timeZone);
  const cutoff = Date.parse(now) - 7 * 86400000;
  const recent = at => Date.parse(at) >= cutoff && Date.parse(at) <= Date.parse(now);
  const rows = new Map();
  function add(id, score, reason) {
    assertKnowledgeId(id);
    if (!rows.has(id)) rows.set(id, { knowledgeId: id, score: 0, reasons: [] });
    const row = rows.get(id);
    row.score += score;
    if (!row.reasons.includes(reason)) row.reasons.push(reason);
  }
  for (const attempt of snapshot.attempts || []) {
    if (!recent(attempt.at)) continue;
    const id = attempt.cardId.split(':')[0];
    if (attempt.grade === 'again') add(id, 100, '近7天有需重学记录');
    else if (attempt.hintUsed || attempt.answerRevealed || attempt.grade === 'hinted') add(id, 60, '近7天借助提示或答案完成');
  }
  for (const card of snapshot.cards || []) {
    if (card.dueAt <= now) add(card.knowledgeId, 30, '有到期复习卡');
  }
  for (const event of snapshot.events || []) {
    if (recent(event.at)) add(event.knowledgeId, 5, '近7天有学习访问记录');
  }
  return [...rows.values()].sort((a, b) => b.score - a.score || a.knowledgeId.localeCompare(b.knowledgeId)).slice(0, 3);
}
export function buildExerciseRequest(snapshot, options = {}) {
  let selected = options.knowledgeIds || [];
  if (options.mode === 'recent') selected = recommendExerciseKnowledge(snapshot, options).map(row => row.knowledgeId);
  if (options.mode === 'unit') {
    selected = (snapshot.course?.knowledge || []).filter(row => row.chapter === options.unitId).map(row => row.id).sort().slice(0, 3);
  }
  selected = ids(selected);
  if (options.mode === 'comprehensive' && selected.length < 2) throw new TypeError('综合练习请选择2至3个知识点');
  const count = options.count ?? 3;
  if (!Number.isInteger(count) || count < 1 || count > 5) throw new TypeError('题目数量必须为1至5');
  const formats = list(options.formats || [...EXERCISE_FORMATS], 4, '题型');
  if (!formats.length || new Set(formats).size !== formats.length) throw new TypeError('题型不得为空或重复');
  formats.forEach(value => enumValue(value, EXERCISE_FORMATS, '题型'));
  const recent_prompts = [...(snapshot.aiExercises || [])].sort((a, b) => b.generated_at.localeCompare(a.generated_at) || a.id.localeCompare(b.id))
    .filter(row => row.knowledge_ids.some(id => selected.includes(id))).slice(0, 10).map(row => Array.from(row.prompt).slice(0, 300).join(''));
  const request = { schema_version: 1, knowledge_ids: selected, count,
    difficulty: enumValue(options.difficulty || 'basic', ['basic', 'standard', 'advanced'], '难度'), formats: [...formats], recent_prompts };
  if (new TextEncoder().encode(JSON.stringify(request)).length > 32768) throw new RangeError('出题请求超过32 KiB');
  return request;
}
export function newExerciseDraft(at = new Date().toISOString()) {
  return { attemptId: crypto.randomUUID(), phase: 'draft', answerText: '', selectedIndex: null,
    hintUsed: false, answerRevealed: false, assistedAtLock: false, at: null,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, rating: null, updatedAt: normalizeTime(at) };
}
export function validateExerciseDraft(value, question) {
  const phase = enumValue(value.phase, ['draft', 'locked', 'rated', 'saved'], '作答阶段');
  const result = { attemptId: text(value.attemptId, '作答ID', 200), phase,
    answerText: text(value.answerText, '答案', 20000, true), selectedIndex: value.selectedIndex,
    timeZone: text(value.timeZone, '时区', 100), updatedAt: normalizeTime(value.updatedAt),
    at: value.at === null ? null : normalizeTime(value.at), rating: value.rating };
  localDay(result.updatedAt, result.timeZone);
  for (const key of ['hintUsed', 'answerRevealed', 'assistedAtLock']) {
    if (typeof value[key] !== 'boolean') throw new TypeError('辅助标志无效');
    result[key] = value[key];
  }
  if (result.rating !== null) enumValue(result.rating, RATINGS, '自评');
  if (result.selectedIndex !== null && (question.format !== 'choice' || !Number.isInteger(result.selectedIndex) || result.selectedIndex < 0 || result.selectedIndex > 3)) throw new TypeError('选择项无效');
  if (phase !== 'draft' && (!result.at || (question.format === 'choice' ? result.selectedIndex === null : !result.answerText.trim()))) throw new TypeError('锁定作答缺少答案或时间');
  if (['rated', 'saved'].includes(phase) && !result.rating) throw new TypeError('缺少自评');
  if (phase === 'draft' && (result.at !== null || result.assistedAtLock || result.rating !== null)) throw new TypeError('草稿锁定状态无效');
  if (result.assistedAtLock && !result.hintUsed && !result.answerRevealed) throw new TypeError('辅助快照丢失');
  if (result.assistedAtLock && result.rating === 'independent') throw new TypeError('借助提示完成请使用辅助自评');
  return result;
}
export function validateAIExercise(value) {
  if (!value || typeof value !== 'object') throw new TypeError('题目无效');
  const id = text(value.id, '题目ID', 150);
  if (!id.startsWith('aiq:')) throw new TypeError('AI题目ID无效');
  const result = { id, knowledge_ids: ids(value.knowledge_ids),
    learning_type: enumValue(value.learning_type, ['concept', 'application'], '学习类型'),
    format: enumValue(value.format, EXERCISE_FORMATS, '题型'),
    difficulty: enumValue(value.difficulty, ['basic', 'standard', 'advanced'], '难度'),
    prompt: text(value.prompt, '题干', 1200), code: text(value.code ?? '', '代码', 2000, true),
    choices: list(value.choices, 4, '选项').map(item => text(item, '选项', 1200)), correct_index: value.correct_index,
    hints: list(value.hints, 2, '提示').map(item => text(item, '提示', 200)),
    reference_answer: text(value.reference_answer, '参考答案', 1600), solution_code: text(value.solution_code ?? '', '参考代码', 3000, true),
    explanation: text(value.explanation, '解释', 1000), execution_status: enumValue(value.execution_status, ['not_executed'], '运行状态') };
  if (['code_reading', 'code_fix'].includes(result.format) && !result.code.trim()) throw new TypeError('代码题缺少代码');
  if (!result.hints.length) throw new TypeError('缺少提示');
  if (result.format === 'choice') {
    if (result.choices.length !== 4 || new Set(result.choices.map(item => item.trim().normalize('NFKC'))).size !== 4 || !Number.isInteger(result.correct_index) || result.correct_index < 0 || result.correct_index > 3) throw new TypeError('单选题选项或参考索引无效');
  } else if (result.choices.length || result.correct_index !== null) throw new TypeError('主观题参考索引无效');
  result.source_refs = list(value.source_refs, 30, '内容来源').map(ref => {
    if (!ref || typeof ref !== 'object' || !result.knowledge_ids.includes(ref.knowledge_id)) throw new TypeError('课程来源关联无效');
    const source = { knowledge_id: ref.knowledge_id };
    for (const key of ['source_id', 'file', 'locator', 'raw', 'title']) {
      if (ref[key] !== undefined && ref[key] !== null) source[key] = text(ref[key], '课程来源', 2000, true);
    }
    if (!source.file && !source.locator && !source.raw && !source.source_id) throw new TypeError('缺少课程来源');
    return source;
  });
  if (result.knowledge_ids.some(id => !result.source_refs.some(ref => ref.knowledge_id === id))) throw new TypeError('课程来源覆盖不完整');
  for (const key of ['generation_id', 'provider', 'model', 'prompt_version', 'knowledge_version']) result[key] = text(value[key], key, 200);
  result.generated_at = normalizeTime(new Date(value.generated_at).toISOString());
  const request = buildExerciseRequest({}, { knowledgeIds: value.request.knowledge_ids, count: value.request.count,
    difficulty: value.request.difficulty, formats: value.request.formats });
  result.request = { ...request, recent_prompts: list(value.request.recent_prompts || [], 10, '近期题干').map(item => text(item, '近期题干', 300, true)) };
  if (result.difficulty !== request.difficulty || !request.formats.includes(result.format) || result.knowledge_ids.some(id => !request.knowledge_ids.includes(id))) throw new TypeError('题目与请求范围不符');
  result.draft = validateExerciseDraft(value.draft, result);
  return result;
}
export function validateAIExerciseAttempt(value, question) {
  if (!question || value.questionId !== question.id) throw new TypeError('作答题目关联无效');
  const at = normalizeTime(value.at);
  localDay(at, value.timeZone);
  const result = { id: text(value.id, '作答ID', 200), questionId: question.id, at,
    timeZone: value.timeZone, answerText: text(value.answerText, '答案', 20000, true), selectedIndex: value.selectedIndex,
    rating: enumValue(value.rating, RATINGS, '自评'), hintUsed: value.hintUsed, answerRevealed: value.answerRevealed,
    assistedAtLock: value.assistedAtLock, assessment_source: value.assessment_source, referenceMatch: value.referenceMatch };
  for (const key of ['hintUsed', 'answerRevealed', 'assistedAtLock']) if (typeof result[key] !== 'boolean') throw new TypeError('辅助标志无效');
  if (result.assistedAtLock && (!result.hintUsed && !result.answerRevealed || result.rating === 'independent')) throw new TypeError('辅助状态与自评不符');
  if (question.format === 'choice') {
    if (!Number.isInteger(result.selectedIndex) || result.selectedIndex < 0 || result.selectedIndex > 3 || result.assessment_source !== 'ai_reference_match' || result.referenceMatch !== (result.selectedIndex === question.correct_index)) throw new TypeError('参考匹配无效');
  } else if (!result.answerText.trim() || result.selectedIndex !== null || result.assessment_source !== 'self' || result.referenceMatch !== null) throw new TypeError('主观题作答无效');
  return result;
}

// Offline reference allowlist extracted from the bundled course. Keep aligned with data/course.json.
export const EXERCISE_COURSE_SOURCES = Object.freeze([
  {
    "id": "K01",
    "title": "R、RStudio与脚本执行",
    "sources": [
      {
        "source_id": "S1",
        "file": "r-installation-ch11.pdf",
        "locator": "PDF  4–20"
      },
      {
        "source_id": "S2",
        "file": "r-installation-ch12.pdf",
        "locator": "PDF  1–7"
      }
    ]
  },
  {
    "id": "K02",
    "title": "安装、加载与命名空间",
    "sources": [
      {
        "source_id": "S1",
        "file": "r-installation-ch11.pdf",
        "locator": "PDF 21–29"
      },
      {
        "source_id": "S2",
        "file": "r-installation-ch12.pdf",
        "locator": "PDF 8–10"
      }
    ]
  },
  {
    "id": "K03",
    "title": "帮助与可复现记录",
    "sources": [
      {
        "source_id": "S1",
        "file": "r-installation-ch11.pdf",
        "locator": "PDF 28–42"
      }
    ]
  },
  {
    "id": "K04",
    "title": "类型、类与类型转换",
    "sources": [
      {
        "source_id": "S3",
        "file": "r-data-operations-ch02.pdf",
        "locator": "PDF 9–14"
      },
      {
        "source_id": "S4",
        "file": "r-for-data-science-zh.pdf",
        "locator": "第15章 PDF 230–247"
      }
    ]
  },
  {
    "id": "K05",
    "title": "逻辑运算与条件筛选",
    "sources": [
      {
        "source_id": "S3",
        "file": "r-data-operations-ch02.pdf",
        "locator": "PDF 14、72"
      },
      {
        "source_id": "S4",
        "file": "r-for-data-science-zh.pdf",
        "locator": "第14章 PDF 219–222"
      }
    ]
  },
  {
    "id": "K06",
    "title": "缺失、NaN与无穷值",
    "sources": [
      {
        "source_id": "S3",
        "file": "r-data-operations-ch02.pdf",
        "locator": "PDF 11、73"
      },
      {
        "source_id": "S4",
        "file": "r-for-data-science-zh.pdf",
        "locator": "第15章 PDF 233–234"
      }
    ]
  },
  {
    "id": "K07",
    "title": "普通因子与有序因子",
    "sources": [
      {
        "source_id": "S3",
        "file": "r-data-operations-ch02.pdf",
        "locator": "PDF 15–19"
      },
      {
        "source_id": "S4",
        "file": "r-for-data-science-zh.pdf",
        "locator": "第11章 PDF 183–188"
      }
    ]
  },
  {
    "id": "K08",
    "title": "日期、时间与格式",
    "sources": [
      {
        "source_id": "S3",
        "file": "r-data-operations-ch02.pdf",
        "locator": "PDF 20–27"
      },
      {
        "source_id": "S4",
        "file": "r-for-data-science-zh.pdf",
        "locator": "第12章 PDF 189–204"
      }
    ]
  },
  {
    "id": "K09",
    "title": "创建向量与随机抽样",
    "sources": [
      {
        "source_id": "S3",
        "file": "r-data-operations-ch02.pdf",
        "locator": "PDF 30–31"
      },
      {
        "source_id": "S2",
        "file": "r-installation-ch12.pdf",
        "locator": "PDF 1–5"
      }
    ]
  },
  {
    "id": "K10",
    "title": "向量索引与定位",
    "sources": [
      {
        "source_id": "S3",
        "file": "r-data-operations-ch02.pdf",
        "locator": "PDF 32"
      },
      {
        "source_id": "S4",
        "file": "r-for-data-science-zh.pdf",
        "locator": "第15章 PDF 237–239"
      }
    ]
  },
  {
    "id": "K11",
    "title": "向量运算与循环补齐",
    "sources": [
      {
        "source_id": "S4",
        "file": "r-for-data-science-zh.pdf",
        "locator": "第15章 PDF 235–237"
      },
      {
        "source_id": "S3",
        "file": "r-data-operations-ch02.pdf",
        "locator": "PDF 34"
      }
    ]
  },
  {
    "id": "K12",
    "title": "集合、匹配与成员判断",
    "sources": [
      {
        "source_id": "S3",
        "file": "r-data-operations-ch02.pdf",
        "locator": "PDF 33、38"
      }
    ]
  },
  {
    "id": "K13",
    "title": "数值汇总",
    "sources": [
      {
        "source_id": "S3",
        "file": "r-data-operations-ch02.pdf",
        "locator": "PDF 34"
      },
      {
        "source_id": "S4",
        "file": "r-for-data-science-zh.pdf",
        "locator": "第3章 汇总"
      }
    ]
  },
  {
    "id": "K14",
    "title": "sort、order与rank",
    "sources": [
      {
        "source_id": "S3",
        "file": "r-data-operations-ch02.pdf",
        "locator": "PDF 35–37"
      }
    ]
  },
  {
    "id": "K15",
    "title": "cut分组与区间边界",
    "sources": [
      {
        "source_id": "S3",
        "file": "r-data-operations-ch02.pdf",
        "locator": "PDF 38–39"
      }
    ]
  },
  {
    "id": "K16",
    "title": "字符长度与截取",
    "sources": [
      {
        "source_id": "S3",
        "file": "r-data-operations-ch02.pdf",
        "locator": "PDF 40–41"
      },
      {
        "source_id": "S4",
        "file": "r-for-data-science-zh.pdf",
        "locator": "第10章 PDF 160–163"
      }
    ]
  },
  {
    "id": "K17",
    "title": "paste与paste0",
    "sources": [
      {
        "source_id": "S3",
        "file": "r-data-operations-ch02.pdf",
        "locator": "PDF 42–44"
      }
    ]
  },
  {
    "id": "K18",
    "title": "查找、替换与正则",
    "sources": [
      {
        "source_id": "S3",
        "file": "r-data-operations-ch02.pdf",
        "locator": "PDF 45–47"
      },
      {
        "source_id": "S4",
        "file": "r-for-data-science-zh.pdf",
        "locator": "第10章 PDF 164–181"
      }
    ]
  },
  {
    "id": "K19",
    "title": "创建矩阵与保留维度",
    "sources": [
      {
        "source_id": "S3",
        "file": "r-data-operations-ch02.pdf",
        "locator": "PDF 48–52"
      }
    ]
  },
  {
    "id": "K20",
    "title": "矩阵绑定、命名与转置",
    "sources": [
      {
        "source_id": "S3",
        "file": "r-data-operations-ch02.pdf",
        "locator": "PDF 51–55"
      }
    ]
  },
  {
    "id": "K21",
    "title": "矩阵乘法与线性方程",
    "sources": [
      {
        "source_id": "S3",
        "file": "r-data-operations-ch02.pdf",
        "locator": "PDF 53–56"
      }
    ]
  },
  {
    "id": "K22",
    "title": "特征分解与SVD",
    "sources": [
      {
        "source_id": "S3",
        "file": "r-data-operations-ch02.pdf",
        "locator": "PDF 54–57"
      }
    ]
  },
  {
    "id": "K23",
    "title": "稀疏矩阵",
    "sources": [
      {
        "source_id": "S3",
        "file": "r-data-operations-ch02.pdf",
        "locator": "PDF 58–62"
      }
    ]
  },
  {
    "id": "K24",
    "title": "数组与apply",
    "sources": [
      {
        "source_id": "S3",
        "file": "r-data-operations-ch02.pdf",
        "locator": "PDF 63–65、82"
      }
    ]
  },
  {
    "id": "K25",
    "title": "数据框创建与检查",
    "sources": [
      {
        "source_id": "S3",
        "file": "r-data-operations-ch02.pdf",
        "locator": "PDF 66–69"
      },
      {
        "source_id": "S4",
        "file": "r-for-data-science-zh.pdf",
        "locator": "第6章"
      }
    ]
  },
  {
    "id": "K26",
    "title": "数据框取列、筛选与增列",
    "sources": [
      {
        "source_id": "S3",
        "file": "r-data-operations-ch02.pdf",
        "locator": "PDF 70、72"
      }
    ]
  },
  {
    "id": "K27",
    "title": "数据框排序与合并",
    "sources": [
      {
        "source_id": "S3",
        "file": "r-data-operations-ch02.pdf",
        "locator": "PDF 71、74"
      },
      {
        "source_id": "S4",
        "file": "r-for-data-science-zh.pdf",
        "locator": "第9章 PDF 143–159"
      }
    ]
  },
  {
    "id": "K28",
    "title": "缺失处理与异常值策略",
    "sources": [
      {
        "source_id": "S3",
        "file": "r-data-operations-ch02.pdf",
        "locator": "PDF 73"
      }
    ]
  },
  {
    "id": "K29",
    "title": "长宽表转换：基础R",
    "sources": [
      {
        "source_id": "S3",
        "file": "r-data-operations-ch02.pdf",
        "locator": "PDF 75–78"
      },
      {
        "source_id": "S4",
        "file": "r-for-data-science-zh.pdf",
        "locator": "第8章 PDF 125–142"
      }
    ]
  },
  {
    "id": "K30",
    "title": "分组汇总：基础R",
    "sources": [
      {
        "source_id": "S3",
        "file": "r-data-operations-ch02.pdf",
        "locator": "PDF 79–82"
      },
      {
        "source_id": "S4",
        "file": "r-for-data-science-zh.pdf",
        "locator": "第3章"
      }
    ]
  },
  {
    "id": "K31",
    "title": "列表创建、索引与嵌套",
    "sources": [
      {
        "source_id": "S3",
        "file": "r-data-operations-ch02.pdf",
        "locator": "PDF 83–87"
      },
      {
        "source_id": "S4",
        "file": "r-for-data-science-zh.pdf",
        "locator": "第15章 PDF 239–243"
      }
    ]
  },
  {
    "id": "K32",
    "title": "lapply、sapply与vapply",
    "sources": [
      {
        "source_id": "S3",
        "file": "r-data-operations-ch02.pdf",
        "locator": "PDF 88–90"
      },
      {
        "source_id": "S4",
        "file": "r-for-data-science-zh.pdf",
        "locator": "第16章 PDF 258–260"
      }
    ]
  },
  {
    "id": "K33",
    "title": "mapply与逐组配对",
    "sources": [
      {
        "source_id": "S3",
        "file": "r-data-operations-ch02.pdf",
        "locator": "PDF 91"
      }
    ]
  },
  {
    "id": "K34",
    "title": "do.call、Reduce与递归处理",
    "sources": [
      {
        "source_id": "S3",
        "file": "r-data-operations-ch02.pdf",
        "locator": "PDF 92–94"
      },
      {
        "source_id": "S3",
        "file": "r-data-operations-ch02.pdf",
        "locator": "PDF 88 扩展函数线索"
      }
    ]
  },
  {
    "id": "K35",
    "title": "自定义函数与参数检查",
    "sources": [
      {
        "source_id": "S4",
        "file": "r-for-data-science-zh.pdf",
        "locator": "第14章 PDF 214–229"
      }
    ]
  },
  {
    "id": "K36",
    "title": "if、else与向量化分支",
    "sources": [
      {
        "source_id": "S4",
        "file": "r-for-data-science-zh.pdf",
        "locator": "第14章 PDF 219–223"
      }
    ]
  },
  {
    "id": "K37",
    "title": "for、while与安全循环",
    "sources": [
      {
        "source_id": "S4",
        "file": "r-for-data-science-zh.pdf",
        "locator": "第16章 PDF 249–255"
      }
    ]
  },
  {
    "id": "K38",
    "title": "文件导入、导出与路径",
    "sources": [
      {
        "source_id": "S3",
        "file": "r-data-operations-ch02.pdf",
        "locator": "PDF 67"
      },
      {
        "source_id": "S4",
        "file": "r-for-data-science-zh.pdf",
        "locator": "第7章"
      }
    ]
  },
  {
    "id": "K39",
    "title": "综合任务：模拟电影数据清洗",
    "sources": [
      {
        "source_id": "S3",
        "file": "r-data-operations-ch02.pdf",
        "locator": "PDF 3–8、66–82"
      }
    ]
  },
  {
    "id": "K40",
    "title": "dplyr分组与管道",
    "sources": [
      {
        "source_id": "S3",
        "file": "r-data-operations-ch02.pdf",
        "locator": "PDF 80–81"
      },
      {
        "source_id": "S4",
        "file": "r-for-data-science-zh.pdf",
        "locator": "第3、13章"
      }
    ]
  },
  {
    "id": "K41",
    "title": "tidyr现行长宽表转换",
    "sources": [
      {
        "source_id": "S4",
        "file": "r-for-data-science-zh.pdf",
        "locator": "第8章"
      }
    ]
  },
  {
    "id": "K42",
    "title": "reshape2与plyr课件原写法",
    "sources": [
      {
        "source_id": "S3",
        "file": "r-data-operations-ch02.pdf",
        "locator": "PDF 76–79"
      }
    ]
  },
  {
    "id": "K43",
    "title": "lubridate时间成分",
    "sources": [
      {
        "source_id": "S3",
        "file": "r-data-operations-ch02.pdf",
        "locator": "PDF 25"
      },
      {
        "source_id": "S4",
        "file": "r-for-data-science-zh.pdf",
        "locator": "第12章"
      }
    ]
  }
]);
