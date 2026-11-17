# R代码输入组件实现记录

## 交付

`ai_tutor/static/r-code-editor.js` 导出 `enhanceRTextarea(textarea, {renderCode})`，返回 `refresh()`、`setValue(source, {emitInput:false})` 和 `destroy()`。重复挂载返回同一个句柄。`renderCode` 应返回文本与输入完全一致的文本节点或DocumentFragment。回调异常、文本不等价或样式缺失时恢复原生文字。

原生textarea保留ID、value、焦点、选择与编辑历史，程序赋值沿用原生value赋值语义。`setValue` 默认保持静默，传入 `emitInput:true` 才派发input。`refresh` 只读value。原生textarea会将CRLF归一化成LF，展示层按照实际value渲染。末尾空行的镜像层追加不可见行盒字符，数据读取始终使用textarea.value。

`ai_tutor/static/r-code-editor.css` 为必须加载的本地样式。根类为 `.r-code-editor`，输入类为 `.r-code-editor__input`，镜像层为 `.r-code-editor__highlight`，镜像层含 `aria-hidden="true"`。主题使用 `--r-code-font`、`--r-code-plain`、`--r-code-caret`、`--r-code-selection`、`--r-code-placeholder`，语法span颜色由统一主题提供。

输入事件合并为每帧一次展示刷新，组合输入期间显示原生文字。滚动事件直接同步镜像scrollTop和scrollLeft。ResizeObserver、属性观察、视口变化和字体加载触发排版刷新。destroy取消所有监听、观察器、未完成绘制，恢复原wrap属性并移除包装层。

## 集成位置

- app.js 中 `#example-review` 点击处理的代码示例赋值应改为 `codeEditor.setValue(...)`。
- app.js 的 `setCode` 展开代码面板后调用 `codeEditor.refresh()`。
- r-file.js 构造器的 `#code-clear` 点击处理和 `apply(file,text)` 文件读取/确认替换赋值后显式refresh。集成方可以注入统一 `onCodeChange` 回调。
- 当前基线app.js的旧记录和学习档案恢复未向 `#code` 赋值。后续新增回填或草稿恢复时使用setValue。
- learning-center.js 的 `review-answer` 仅在专用代码纠错作答时增强。AIExerciseUI中同样仅增强专用代码作答。
- 其他自然语言问题、报错、笔记及推理作答保持原有编辑语义。

```javascript
const editor = enhanceRTextarea(document.getElementById('code'), {
  renderCode: rCodeFragment,
});
editor.setValue('x <- 1\n');
// External code that assigns textarea.value must follow with editor.refresh().
```

## 实际验证

2026年11月17日，Windows x64，Intel Core i9-14900HX，Playwright 1.59.1的Chromium headless，专项脚本 `ai_tutor/scripts/test_r_code_editor.cjs` 通过。

覆盖原生文字输入、剪贴板复制和粘贴、撤销重做、选择保留、静默及派发input的程序赋值、中文composition事件、HTML文本安全、长内容水平和垂直滚动、清空、隐藏展开、readonly、disabled、原生Tab焦点、390×844移动布局与触摸模拟、强制颜色、重复挂载和销毁、渲染异常降级。浏览器无pageerror。Windows剪贴板copy后将换行转为CRLF，textarea中的值保持LF，测试按平台换行核验剪贴板。

102400字符单行纯文本setValue连续20次平均2.30ms，覆盖布局和镜像更新。随后使用语法核心提交2f4cec4提供的真实rCodeFragment重跑全部专项测试，通过函数token断言，补验未连接DOM的首次挂载恢复与缺失CSS降级，全部通过。真实回调的102400字符单行setValue连续20次平均2.37ms，该大小触发高亮核心100000字符纯文本回退。编辑器本身无额外输入长度限制，沿用产品现有100KB文件与10000字符提交校验。

运行时设置NODE_PATH指向现有Playwright安装，并设置PLAYWRIGHT_BROWSERS_PATH指向用户已安装的浏览器目录，再执行 `node scripts/test_r_code_editor.cjs`。本机sandbox禁止本地浏览器访问127.0.0.1，专项测试经授权在sandbox外运行。

实际中文输入法候选窗口、系统拖放、触摸选择手柄和移动软键盘尚需人工真机验证。Android、iOS、macOS平台尚未实测。真实rCodeFragment已完成组件级专项复验，正常页面入口仍由集成分支回归。
