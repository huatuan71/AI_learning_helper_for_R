# 发布信息

本地应用版本为1.2.1，访问地址为 `http://127.0.0.1:8000/`。

## 当前交付状态

- 三家模型适配、会话设置、课程引用与搜索流程已实现，测试范围见 `test-records.md`。
- Render部署配置位于仓库根目录 `render.yaml`。
- 正式URL核验及二维码生成工具位于 `ai_tutor/scripts/publish_info.py`。
- 用户已反馈DeepSeek可以正常连接，完整问答和搜索质量评估待记录，Render发布待账号到位。
- 公网地址、正式二维码、手机蜂窝扫码、学校网络及两设备并发验收均待完成。

取得正式HTTPS地址后，按 `model-setup.md` 部署与核验，再运行发布脚本更新本文件和二维码。

## AI出题本地交付

2026年11月17日完成AI出题接口、练习流程、离线题目与作答、档案v3兼容。
集成分支为 `codex/ai-exercise-ui`，位于 `.worktrees/ai-exercise-ui`。
本次保留的实际应用服务为 `http://127.0.0.1:8026/#/history/review/ai`，配置模型后可生成题目。
操作、迁移、推荐规则及验证范围见 `ai_tutor/docs/ai-exercises.md`，最终验收见本目录 `test-records.md` 的AI出题章节。
