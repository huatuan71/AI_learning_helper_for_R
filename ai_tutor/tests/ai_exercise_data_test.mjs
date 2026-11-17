import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExerciseRequest, recommendExerciseKnowledge, newExerciseDraft, validateAIExercise } from '../static/ai-exercise-data.js';
test('范围、综合、单元、无记录推荐与稳定顺序', () => {
  assert.deepEqual(recommendExerciseKnowledge({}), []);
  assert.throws(() => buildExerciseRequest({}, {mode:'recent'}));
  assert.throws(() => buildExerciseRequest({}, {mode:'comprehensive',knowledgeIds:['K06']}));
  assert.deepEqual(buildExerciseRequest({course:{knowledge:[{id:'K06',chapter:'向量'}]}},{mode:'unit',unitId:'向量'}).knowledge_ids,['K06']);
  const snapshot={attempts:[{cardId:'K07:concept',at:'2026-11-17T08:00:00.000Z',grade:'again'}],cards:[{knowledgeId:'K06',dueAt:'2026-11-17T08:00:00.000Z'}]};
  assert.deepEqual(recommendExerciseKnowledge(snapshot,{now:'2026-11-17T09:00:00.000Z',timeZone:'America/New_York'}).map(row=>row.knowledgeId),['K07','K06']);
});
test('请求字段与Unicode近期题干边界', () => {
  const request=buildExerciseRequest({aiExercises:[{id:'aiq:1',knowledge_ids:['K06'],generated_at:'2026-11-17T08:00:00.000Z',prompt:'😀'.repeat(400)}]},{knowledgeIds:['K06'],secret:'never'});
  assert.equal(Array.from(request.recent_prompts[0]).length,300);
  assert.equal(request.count,3);
  assert.equal(request.secret,undefined);
  for(const options of [{knowledgeIds:['K06','K06']},{knowledgeIds:['K99']},{knowledgeIds:['K06'],count:6},{knowledgeIds:['K06'],formats:['choice','choice']}]) assert.throws(()=>buildExerciseRequest({},options));
});
import fs from 'node:fs';
const source = JSON.parse(fs.readFileSync(new URL('../data/course.json', import.meta.url), 'utf8')).knowledge.find(row => row.id === 'K06');
function exercise(overrides = {}) {
  return {id:'aiq:test',knowledge_ids:['K06'],learning_type:'concept',format:'choice',difficulty:'basic',prompt:'如何检测NA？',
    code:'',choices:['is.na(x)','x == NA','x = NULL','is.null(x)'],correct_index:0,hints:['使用逐元素检测函数'],
    reference_answer:'is.na(x)',solution_code:'',explanation:'is.na检查每个元素',execution_status:'not_executed',
    source_refs:source.sources.map(ref => ({...ref,knowledge_id:source.id,title:source.title})),
    generation_id:'gen:test',provider:'deepseek',model:'model',prompt_version:'learning-exercise-v1',knowledge_version:'test',
    generated_at:'2026-11-17T08:00:00.000Z',request:buildExerciseRequest({}, {knowledgeIds:['K06']}),draft:newExerciseDraft(),...overrides};
}
test('重复选项、错误索引、代码缺失、无效Unicode、来源关联被拒绝', () => {
  assert.doesNotThrow(() => validateAIExercise(exercise()));
  for (const patch of [
    {choices:['same',' same ','b','c']}, {correct_index:4}, {correct_index:-1}, {correct_index:1.5},
    {format:'code_reading',choices:[],correct_index:null,code:''},
    {format:'code_fix',choices:[],correct_index:null,code:'   '},
    {prompt:'\uD800'}, {prompt:'😀'.repeat(1201)}, {source_refs:[]},
    {source_refs:[{knowledge_id:'K07',file:'fake.pdf'}]}, {hints:[]},
  ]) assert.throws(() => validateAIExercise(exercise(patch)));
});
test('Unicode按码点计数，合法1200个非BMP字符可保存', () => {
  assert.equal(Array.from(validateAIExercise(exercise({prompt:'😀'.repeat(1200)})).prompt).length,1200);
});
test('近期规则只采集过去7天且按需重学、提示、到期、访问稳定排序', () => {
  const now='2026-11-17T08:00:00.000Z';
  const snapshot={attempts:[
    {cardId:'K06:concept',at:'2026-11-09T08:00:00.000Z',grade:'again'},
    {cardId:'K07:concept',at:now,grade:'hinted'},
    {cardId:'K08:concept',at:now,grade:'again'},
    {cardId:'K09:concept',at:'2026-11-18T08:00:00.000Z',grade:'again'},
  ],events:[{knowledgeId:'K10',at:now}],cards:[{knowledgeId:'K11',dueAt:now}]};
  const selected=recommendExerciseKnowledge(snapshot,{now,timeZone:'America/New_York'});
  assert.deepEqual(selected.map(row=>row.knowledgeId),['K08','K07','K11']);
  assert.match(selected[0].reasons.join(' '),/重学/);
  assert.deepEqual(recommendExerciseKnowledge({...snapshot,attempts:[...snapshot.attempts].reverse()},{now,timeZone:'Asia/Shanghai'}),selected);
});
test('夏令时、无效IANA时区和请求数量边界', () => {
  const options={now:'2026-11-01T05:30:00.000Z',timeZone:'America/New_York'};
  assert.doesNotThrow(()=>recommendExerciseKnowledge({events:[{knowledgeId:'K06',at:options.now}]},options));
  assert.throws(()=>recommendExerciseKnowledge({}, {...options,timeZone:'Bad/Zone'}));
  assert.equal(buildExerciseRequest({}, {knowledgeIds:['K01'],count:1}).count,1);
  assert.equal(buildExerciseRequest({}, {knowledgeIds:['K01','K02','K03'],count:5}).count,5);
  assert.throws(()=>buildExerciseRequest({}, {knowledgeIds:['K01','K02','K03','K04']}));
});
