# 药汤 · YaoTang

羊皮纸、墨水与魔法阵风格的 Windows AI 角色扮演桌面应用。基于 Electron、React 和 TypeScript；动画、纸纹与音乐由代码实时生成。

[下载安装包](https://github.com/MoyerZhang-Claude/role-play/releases/latest) · [使用说明](使用说明.md) · [兼容性说明](docs/04-兼容性说明.md)

## 功能

- 导入 PNG / JSON 角色卡（V1 / V2 / V3），编辑角色并导出 PNG 角色卡。
- 世界书、正则、SillyTavern 对话补全预设；导入报告说明兼容差异。
- 流式回复、停止、重写、续写、代写、对话分支与多卷管理。
- 提示词预览、世界书触发记录、上下文预算与宏替换。
- 羊皮纸界面、实时开场动画、程序合成音效与背景音乐。
- 本地保存角色与聊天，支持 `.yaotang` 存档的导入、导出与备份。

## 安装与使用

面向 Windows x64。在 [Releases](https://github.com/MoyerZhang-Claude/role-play/releases) 下载 `YaoTang-Setup-0.3.1.exe`，按向导安装。安装包未签名，Windows 可能显示来源提示；发布页提供 SHA-256 校验文件。

首次使用在「设置 → 接口」填写自己的 API 密钥，并自行导入角色卡。预设 DeepSeek 接口，也支持其他 OpenAI 兼容接口。Claude / Gemini 适配代码已实现，但尚未完成真实接口验证。

程序不附带角色卡、世界书、预设素材、聊天记录或 API 密钥。使用模型服务产生的费用由用户自行承担。

## 数据与隐私

数据默认在安装目录的 `data/`；目录不可写时回退到 `%APPDATA%/药汤/data`。密钥通过 Electron `safeStorage` 使用 Windows 系统加密，迁移电脑后需重新填写。存档导出排除密钥文件，但可能包含用户主动导出的角色、聊天和接口设置，请自行检查后分享。

本仓库排除了私人素材库、素材截图、原始个人需求与环境记录、运行数据、密钥文件、历史安装包与依赖缓存。公开测试使用人工构造的数据，不需要私人素材库。

## 开发

建议使用 Node.js 24 与 npm，在 Windows x64 上构建安装包：

```sh
cd app
npm ci
npm run typecheck
npm test
npm run dev
```

构建安装包：

```sh
cd app
npm run dist -- --publish never
```

输出位于 `app/dist/`。开发数据写入 `app/data-dev/`，不应提交到 Git。

## 项目结构

| 目录 | 内容 |
| --- | --- |
| `app/src/main` | 文件存储、系统加密、模型请求与存档 |
| `app/src/preload` | Electron 主进程与页面通信桥接 |
| `app/src/shared` | 角色卡、世界书、正则、预设、宏与提示词逻辑 |
| `app/src/renderer` | React 页面、主题、图形与声音 |
| `app/tests` | 不依赖私人素材的逻辑测试 |
| `app/build` | 程序生成的图标、安装脚本与许可文件 |
| `docs` | 设计、兼容性及发布说明 |

## 发布

GitHub Actions 在 Windows 上检查类型、运行测试、构建安装包、审查打包文件并计算 SHA-256。更新 `app/package.json` 的版本并推送至 `main` 会发布对应版本；已有版本不会被覆盖。也可以手动运行工作流。

详见 [发布说明](docs/RELEASING.md) 和 [变更记录](CHANGELOG.md)。

## 许可证

项目原创代码采用 [MIT License](LICENSE)。第三方库、字体及 Electron / Chromium 保留各自许可证；见 [第三方声明](THIRD_PARTY_NOTICES.md)。用户导入的素材不属于本项目的开源授权范围。
