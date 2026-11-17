'use strict';

export class ModelSettings {
  constructor(notify) {
    this.notify = notify;
    this.config = {mode: 'mock'};
    this.providers = [];
    this.dialog = document.getElementById('model-dialog');
    this.form = document.getElementById('model-form');
    this.feedback = document.getElementById('model-feedback');
    this.key = document.getElementById('model-key');
    this.working = false;
    this.returnFocus = document.getElementById('more-toggle');
    document.getElementById('model-open').onclick = () => this.open();
    document.getElementById('model-close').onclick = () => this.dialog.close();
    this.dialog.addEventListener('close', () => {
      this.key.value = '';
      this.key.type = 'password';
      document.getElementById('model-key-toggle').textContent = '显示';
      const target = this.returnFocus?.isConnected && this.returnFocus.getClientRects().length
        ? this.returnFocus : document.getElementById('more-toggle');
      target.focus({preventScroll:true});
    });
    document.getElementById('model-provider').onchange = () => {
      this.key.value = '';
      this.key.type = 'password';
      document.getElementById('model-key-toggle').textContent = '显示';
      const provider = this.selectedProvider();
      this.key.placeholder = this.config.configured && provider?.id === this.config.provider
        ? '已配置 · 末尾 ' + this.config.key_suffix + '，留空沿用同厂商Key' : '填写当前厂商的API Key';
      document.getElementById('model-id').value = provider?.default_model || '';
      this.updateFields();
    };
    document.getElementById('model-mode').onchange = () => this.updateFields();
    document.getElementById('model-id').oninput = () => this.updateFields();
    document.getElementById('model-key-toggle').onclick = () => {
      const visible = this.key.type === 'password';
      this.key.type = visible ? 'text' : 'password';
      document.getElementById('model-key-toggle').textContent = visible ? '隐藏' : '显示';
    };
    this.form.onsubmit = event => { event.preventDefault(); this.perform(() => this.apply()); };
    document.getElementById('model-test').onclick = () => this.perform(async () => {
      await this.apply();
      this.message('正在测试连接…');
      const result = await this.request('/api/ai/test', 'POST');
      this.message(`连接成功 · ${result.model} · ${result.duration_ms}毫秒。搜索将在实际提问中验证。`);
    });
    document.getElementById('model-clear').onclick = () => this.perform(async () => {
      this.accept(await this.request('/api/ai/config', 'DELETE'));
      this.key.value = '';
      document.getElementById('model-mode').value = 'mock';
      this.updateFields();
      this.message('密钥已清除，已切换模拟模式。');
      this.notify();
    });
    this.ready = this.load();
  }

  async request(path, method = 'GET', body) {
    const response = await fetch(path, {
      method, credentials: 'include', cache: 'no-store',
      headers: body ? {'Content-Type': 'application/json'} : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(35000)
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error?.message || '模型设置请求失败');
    return data;
  }

  async load() {
    try {
      const [catalog, config] = await Promise.all([
        this.request('/api/ai/providers'), this.request('/api/ai/config')
      ]);
      this.providers = catalog.providers;
      const select = document.getElementById('model-provider');
      select.replaceChildren();
      for (const provider of this.providers) {
        const option = document.createElement('option');
        option.value = provider.id;
        option.textContent = provider.name;
        select.append(option);
      }
      this.accept(config);
    } catch (error) {
      this.message('无法读取模型配置，请刷新页面重试。', true);
    }
  }

  accept(config) {
    this.config = config;
    document.getElementById('runtime-mode').textContent =
      {mock: '模拟版', ai: '真实AI', search: '搜索已开启'}[config.mode] || '模拟版';
    if (config.expired) this.notify('模型配置已到期或服务已重启，请重新配置。', true,
      {label:'配置模型', run:event => this.open(event.currentTarget)});
  }

  async refresh() {
    this.accept(await this.request('/api/ai/config'));
  }

  selectedProvider() {
    return this.providers.find(provider => provider.id === document.getElementById('model-provider').value);
  }

  updateFields() {
    const mode = document.getElementById('model-mode').value;
    const provider = this.selectedProvider();
    const model = document.getElementById('model-id').value.trim();
    document.getElementById('model-cloud-fields').hidden = mode === 'mock';
    document.getElementById('model-qwen-fields').hidden = provider?.id !== 'qwen';
    const supported = provider?.search_models.includes(model);
    document.getElementById('model-capability').textContent = mode === 'search' && !supported
      ? '该模型尚未核实搜索能力，请使用下方预设模型或选择真实AI模式。'
      : '搜索预设模型 ' + (provider?.search_models.join('、') || '');
    document.getElementById('model-apply').disabled = this.working || (mode === 'search' && !supported);
    document.getElementById('model-test').disabled = this.working || mode === 'mock' || (mode === 'search' && !supported);
    const keyLink = document.getElementById('model-key-link');
    keyLink.href = provider?.key_url || '#';
    keyLink.textContent = provider ? '打开' + provider.name + '官方控制台' : '';
    const list = document.getElementById('model-presets');
    list.replaceChildren();
    for (const value of provider?.search_models || []) {
      const option = document.createElement('option');
      option.value = value;
      list.append(option);
    }
  }

  async open(trigger = document.getElementById('more-toggle')) {
    this.returnFocus = trigger;
    await this.ready;
    if (!this.providers.length) await this.load();
    try { await this.refresh(); } catch { this.message('无法读取服务器配置，请稍后重试。', true); }
    const config = this.config;
    document.getElementById('model-mode').value = config.mode;
    document.getElementById('model-provider').value = config.provider || this.providers[0]?.id || '';
    document.getElementById('model-id').value = config.model || this.selectedProvider()?.default_model || '';
    document.getElementById('model-workspace').value = config.workspace_id || '';
    document.getElementById('model-region').value = config.region || 'cn-beijing';
    document.getElementById('model-limit').value = config.max_output_tokens || 8192;
    this.key.value = '';
    this.message(config.expired ? '会话已到期，请重新配置。' :
      config.last_test?.status === 'ok' ? '上次连接测试成功。' :
      config.last_test?.message || (config.configured ? '当前会话已配置模型。' : '当前使用模拟模式。'));
    this.key.placeholder = config.configured ? '已配置 · 末尾 ' + config.key_suffix + '，留空沿用同厂商Key' : '填写当前厂商的API Key';
    this.updateFields();
    document.getElementById('more-panel').hidden = true;
    document.getElementById('more-toggle').setAttribute('aria-expanded', 'false');
    this.dialog.showModal();
    document.getElementById('model-mode').focus();
  }

  async apply() {
    const mode = document.getElementById('model-mode').value;
    if (mode !== 'mock' && !document.getElementById('model-consent').checked) {
      throw Error('请确认问题、代码及必要对话将发送至所选模型厂商。');
    }
    const body = {mode};
    if (mode !== 'mock') {
      body.provider = document.getElementById('model-provider').value;
      body.model = document.getElementById('model-id').value.trim();
      body.max_output_tokens = Number(document.getElementById('model-limit').value);
      if (this.key.value) body.api_key = this.key.value;
      if (body.provider === 'qwen') {
        body.workspace_id = document.getElementById('model-workspace').value.trim();
        body.region = document.getElementById('model-region').value;
      }
    }
    const config = await this.request('/api/ai/config', 'PUT', body);
    this.accept(config);
    this.key.value = '';
    this.key.type = 'password';
    document.getElementById('model-key-toggle').textContent = '显示';
    this.key.placeholder = config.configured ? '已配置 · 末尾 ' + config.key_suffix : '填写当前厂商的API Key';
    this.message('设置已应用。密钥将在会话空闲30分钟或服务重启后清除。');
    this.notify();
  }

  message(text, error = false) {
    this.feedback.textContent = text;
    this.feedback.classList.toggle('error', error);
  }

  async perform(action) {
    if (this.working) return;
    this.working = true;
    const controls = [...this.form.querySelectorAll('input,select,button')];
    controls.forEach(control => { control.disabled = true; });
    try { await action(); }
    catch (error) { this.message(error.message || '操作失败，请重试。', true); }
    finally {
      this.working = false;
      controls.forEach(control => { control.disabled = false; });
      this.updateFields();
    }
  }
}

window.ModelSettings = ModelSettings;
