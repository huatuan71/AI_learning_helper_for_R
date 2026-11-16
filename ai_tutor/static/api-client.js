/* Same-origin JSON requests and validated SSE completion. */
export async function requestJson(path, body, options = {}) {
  const response = await fetch(path, {
    cache: 'no-store',
    method: body ? 'POST' : 'GET',
    headers: body ? {'Content-Type': 'application/json'} : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include',
    signal: options.signal || AbortSignal.timeout(options.timeoutMs ?? (body ? 70000 : 10000))
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw Error('服务返回了无法读取的响应');
  }
  if (!response.ok) {
    const error = Error(data.error?.message || '请求失败（' + response.status + '）');
    error.code = data.error?.code;
    error.requestId = data.request_id;
    throw error;
  }
  return data;
}

export async function streamAnswer(path, body, signal, onEvent) {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const data = await response.json();
    const error = Error(data.error?.message || '请求失败');
    error.code = data.error?.code;
    error.requestId = data.request_id;
    throw error;
  }
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    throw Error('服务返回了无法读取的流式响应');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const {value, done} = await reader.read();
      buffer += decoder.decode(value, {stream:!done});
      buffer = buffer.replace(/\r\n/g, '\n');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const lines = frame.split('\n');
        const event = lines.find(line => line.startsWith('event:'))?.slice(6).trim();
        const dataLines = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart());
        if (!dataLines.length) continue;
        const data = JSON.parse(dataLines.join('\n'));
        if (event === 'done') return data;
        if (event === 'error') {
          const error = Error(data.error?.message || '生成失败');
          error.code = data.error?.code;
          error.requestId = data.request_id;
          throw error;
        }
        onEvent(event, data);
      }
      if (done) throw Error('连接提前结束，请重新发送。');
    }
  } finally {
    await reader.cancel().catch(()=>{});
    reader.releaseLock();
  }
}
