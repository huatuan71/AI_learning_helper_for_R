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
