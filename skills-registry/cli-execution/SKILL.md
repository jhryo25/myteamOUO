---
name: cli-execution
category: execution
load: progressive
triggers:
  - 执行任务
  - 调用 CLI
  - 运行命令
  - 执行步骤
next:
  - review-gate
mounts:
  controller: false
  worker: true
  reviewer: false
  codex: true
  claude: true
  kimi: true
---

# CLI Execution

调用可启动的 agent CLI，记录 stdout、stderr、状态和失败原因。

## 触发条件

需要调用本机 CLI、执行任务或保存运行记录。

## 核心规则

- 执行时必须说明改了什么、产出在哪里、如何验证。
- 失败时必须给出原因，不能只说"失败了"。
- 每次执行后要记录结果到运行日志。
- 不要猜测结果，必须实际运行并看到输出。

## 执行模板

```
执行：[命令]
产出：[文件路径或输出内容]
验证：[如何确认成功]
结果：[实际输出摘要]
```
