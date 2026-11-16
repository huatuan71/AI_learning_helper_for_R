# R语言AI助教

面向R语言初学者的课程学习应用，提供课程知识检索、AI问答、代码纠错、学习记录、间隔复习与离线课程资料。服务端使用FastAPI，前端使用原生JavaScript模块。

## 运行应用

Windows首次使用需要Python 3.12。在仓库根目录执行以下命令，安装成功后启动应用。

```powershell
cd ./ai_tutor
./setup.cmd
./start.cmd
```

浏览器打开 <http://127.0.0.1:8000/>，使用结束后运行 `stop.cmd`。已有虚拟环境可直接启动。模型配置和各功能操作见 [应用使用说明](ai_tutor/README.md)。

## 开发与测试

在仓库根目录安装开发依赖并运行Python测试。根目录的 `pytest.ini` 限定本项目测试目录，并配置应用导入路径。

```powershell
$python = (Resolve-Path './ai_tutor/.venv/Scripts/python.exe').Path
& $python -m pip install -r ./ai_tutor/requirements-dev.txt
& $python -m pytest -q
```

浏览器测试需要Node.js、项目的Playwright依赖及对应浏览器。在应用目录执行以下命令。

```powershell
cd ./ai_tutor
npm ci
npx playwright install chromium
npm test
npm run test:browser
```

`npm test` 运行复习算法测试。`npm run test:browser` 自动选择本机空闲端口，启动课程服务和模拟模型服务，依次执行浏览器回归、真实离线流程与集成测试，并在结束时停止这些服务。测试使用独立浏览器上下文，上游模型调用由MockTransport模拟。截图和JSON结果写入应用目录的 `output/playwright/`。

可以按套件运行，或通过 `--python` 指定其他工作树共享的Python解释器。

```powershell
npm run test:browser -- --suite pwa
npm run test:browser -- --python 'E:/projects/r-ai-tutor/.worktrees/other-task/ai_tutor/.venv/Scripts/python.exe'
npx playwright install webkit
npm run test:browser -- --suite integration --browser webkit
```

## 课程更新

安装开发依赖后，在仓库根目录重建课程数据。

```powershell
& $python ./ai_tutor/scripts/import_data.py
```

默认输入来自最近的 `content/sources` 目录，输出写入应用的 `data/`。可显式指定资料目录、Word文件、Excel文件和输出目录。存在多个候选输入时，使用 `--docx` 和 `--xlsx` 明确指定源文件。

```powershell
& $python ./ai_tutor/scripts/import_data.py --source-dir ./content/sources --output-dir ./ai_tutor/.tmp/course-check
```

临时输出便于先检查生成结果。导入报告记录源文件摘要，导入脚本校验条目、引用、必需字段和关联关系。补充草稿及配套R案例保留各自的编写与核验记录。

## 目录职责

| 位置 | 内容 |
|---|---|
| `content/sources/` | 课程源资料、知识目录和内容审核材料 |
| `ai_tutor/app/` | 应用组装、接口、数据模型、课程规则和模型接入 |
| `ai_tutor/static/` | 前端模块、样式、题库与离线资源 |
| `ai_tutor/data/` | 随版本发布的课程快照和导入报告 |
| `ai_tutor/scripts/` | 启动、导入、评估、接口文档和发布工具 |
| `ai_tutor/tests/` | Python、算法和浏览器测试，通用fixture位于conftest.py，模拟响应位于support目录 |
| `ai_tutor/docs/` | 功能说明、阶段性交接记录和归档验收证据 |
| `content/supplements/` | 补充知识条目，配套资源位于 `ai_tutor/content_assets/` 目录 |
| `docs/deliverables/` | 接口、模型配置、调试、测试与发布交付文档 |
| `docs/handoff/learning-plan/` | 学习功能分工与阶段计划 |

依赖按用途分为三组，全部固定版本。

- `requirements.txt` 包含应用运行依赖。
- `requirements-tools.txt` 包含运行依赖、课程导入及二维码生成工具。
- `requirements-dev.txt` 包含上述依赖及Python测试工具。浏览器依赖由 `package-lock.json` 固定。

## 部署

仓库根目录的 `render.yaml` 使用 `python render_service.py build` 安装运行依赖，通过 `python render_service.py start` 启动服务。模型配置保存在进程内存中，部署使用单worker。发布步骤和验收记录见 [模型配置与运行说明](docs/deliverables/model-setup.md)。

## 并行开发

每个任务使用独立分支和工作树，按文件范围分配职责。前端模块和离线清单一同提交，后端模型和调用方导入一同提交。集成分支汇总各任务后运行Python、算法及浏览器测试，应用统一放在根目录的 `ai_tutor/`，课程资料、补充条目与交付材料分别位于 `content/sources/`、`content/supplements/` 和 `docs/deliverables/`。

结构整理前已提交的截图和测试报告归档至 `ai_tutor/docs/evidence/learning-v1/`。新测试产物写入 `ai_tutor/output/`，Playwright结果和运行缓存由Git忽略规则管理。
