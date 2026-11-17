# R高亮集成交付记录

完成于2026年11月17日，共同基线为c47f6a3。工作树为 `.worktrees/r-highlighting-ui`，分支为 `codex/r-highlighting-ui`，最终集成版本使用该分支HEAD查询。语法核心源提交为2f4cec4，编辑器源提交为6f98b35和52d6a2d。三个执行分支独立保留。

本地服务为 http://127.0.0.1:8026，健康检查返回ok。运行代码来自集成工作树。

## 接入范围

| 文件 | 完成内容 |
|---|---|
| answer-renderer.js | codeBlock第五参数language，保留既有调用。R/r采用安全fragment，其他语言保留文本。Markdown从language类传入实际语言。结构化参考修正和示例明确传r |
| app.js | 提交代码、历史回答、最终与流式回答共享渲染。流式最多每动画帧重绘一次，移除草稿时取消待执行绘制。主代码textarea增强，示例用setValue，展开用refresh |
| r-file.js | 新增可选onCodeChange回调，文件读取与清空显式同步高亮。上传100KB与提交10000字符限制保留 |
| index.html | 首页代码示例、纠错对照采用同一token类，错误语句保留波浪下划线。加载两份本地代码样式 |
| knowledge-map.js | 函数语法和运行示例均声明r，深色详情使用适配语义色 |
| learning-center.js | 复习题、变式题、小结课程示例声明r。现有复习回答包含思路与代码，保留原输入语义 |
| ai-exercise-ui.js | 题目代码、solution_code声明r，code_fix专用作答增强，草稿读取后以原值挂载。重绘、离开AI视图时destroy释放观察器与事件 |
| r-code-theme.css | 浅色、深色、选择、强制颜色、打印。14px代码基础字号及中文等宽后备字体 |
| service-worker.js及bootstrap.js | 资源版本r-highlighting-v1，离线白名单加入高亮、编辑器、主题、私有Prism模块，更新受影响模块导入版本 |

codeBlock的参数为 `(parent, source, label, unverified=false, language='')`。复制回调闭包读取source。结构化输出、JSON预览、自然语言参考要点按其现有字段展示。Markdown保留既有解析行为，代码展示会移除解析结果的一个末尾LF，CRLF在Markdown解析阶段归一化。直接调用codeBlock和rCodeFragment均保持源字符串等价。

## 依赖与阈值

Prism固定1.30.0，MIT许可证。版本、来源、离线重建脚本、上游文件校验值见 `ai_tutor/static/vendor/prism/README.md`，许可证同目录LICENSE。运行时私有ESM避免全局自动扫描。

公开语法接口为tokenizeR和rCodeFragment。token类别为plain、keyword、function、string、number、comment、operator、punctuation。受控样式前缀为r-token-。编辑器接口为enhanceRTextarea，返回refresh、setValue、destroy。

超过100000个UTF-16单元或20000个token时完整回退为原始文本，异常及文本还原校验失败同样回退。Windows i9-14900HX专项测量中10500字符词法处理3.325ms，100000字符密集token后回退17.382ms，100000字符长标识符0.526ms。独立复核在并发负载下分别为5.257ms、28.231ms、0.641ms。102400字符编辑器setValue真实回调20次均值2.37ms，该规模触发词法长度回退。同步词法解析没有中途时间取消。

## 验证

- pytest全量391通过，7.52秒。Windows沙箱内asyncio socket初始化会阻塞，实际测试在已批准的沙箱外运行。
- 核心与原有Node套件共36通过。语法安全DOM专项及输入组件真实rCodeFragment专项均通过，覆盖复制粘贴、undo/redo、选择、composition事件、滚动、隐藏展开、只读、禁用、重复挂载和异常降级。
- 完整 `scripts/test_browser.cjs` 回归退出码0。12组基础页面回归通过，涵盖问答流式/最终、历史、复制、导出、文件校验与替换、10000字符边界、地图、玻璃界面、路由、390px和状态提示。学习总结39项，AI出题36项，总结存储46项，出题存储专项，PWA27项均通过。完整日志位于 `ai_tutor/output/playwright/r-highlighting-full-regression.log`。
- 离线集成补充验收26项及核心浏览器39项通过，实际下载离线包、断网刷新、打开全部43个知识详情，并断言离线R token和编辑器原值/高亮。
- 新增 `tests/browser_r_highlighting.cjs` 已接入标准浏览器运行入口。专项11类检查通过，覆盖首页、错误下划线、CRLF原文、安全DOM、未知语言、Markdown语言、输入/文件同步、字号内边距对齐、390px长行内部滚动和深色详情。深色详情断言函数语法与运行示例两个R块。
- 更新了两处因资源版本变化失效的既有测试引用，保留原功能断言。最初全量浏览器导出故障来自测试导入旧URL创建了第二份模块，修正URL后重跑全套通过。

截图已关闭路由过渡动画并目视检查，统一位于 `ai_tutor/output/playwright/r-highlighting-desktop.png`、`r-highlighting-mobile.png`、`r-highlighting-dark.png`。截图和测试输出沿用被忽略的output目录。

主题色按保守浅灰底#e9edf3计算的最低对比度为5.40比1，知识详情代码底#020711最低9.41比1。代码保持文字和语法结构，错误下划线、未运行标记独立显示。高亮镜像aria-hidden，textarea保留原ID和唯一编辑源。

## 实际范围

浏览器验证运行于Windows x64，Playwright 1.59.1，主要Chromium 147.0.7727.15，学习总结及出题现有脚本另使用本机Chrome 157.0.8103.51。390×844为浏览器设备/触摸模拟。中文输入法仅验证composition事件，人工候选窗口、移动软键盘、触摸选择手柄和系统拖放尚需真机验证。Android、iOS、macOS与本轮WebKit尚未实测。着色按词法匹配，无法判断R绑定、动态调用目标或执行正确性。
