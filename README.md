# 成长记录

给一个家庭用的孩子成长记录小程序。微信原生开发 + 云开发，无自建服务器。

记的不是流水账，是**节点**。判断一个功能要不要做，只问一句：三年后想问「她第一次发烧是哪天」，这个功能能不能答上来。

## 设计取舍

做这类工具最容易踩的坑是把「记录」做成「打卡」——要求每天写，第三周就断更，然后整个应用死掉。

所以这个项目主动砍掉了这些东西：

| 不做 | 原因 |
|---|---|
| 每日日记式记录 | 靠自觉每天写必然断更 |
| 分类统计饼图 | 成长记录不需要「日常占比 23%」这类图表 |
| 共享日历 | 系统日历已支持共享与提醒，做不过它 |
| 实时协作 | 两人都是新增记录，最后写入为准即可 |
| 按天强制归档 | 一天可以没有记录，这不叫漏记 |

留下的只有三件事：**随手记一条**、**按时间翻回去看**、**问一句能从历史里答上来**。

## 功能

- **记录**：一句话输入，自动识别类型（`daily` / `first` / `health`）、抽取标签、地点、体温、用药、具体时刻
- **月历视图**：按月看节点分布，点某天看当天全部记录
- **搜索**：纯客户端关键词打分，命中高亮，点结果跳回那天，不消耗模型额度
- **图片**：每条记录可附最多 9 张图，存云存储
- **成长档案**：身高体重等基础档案
- **AI 助手**：基于历史记录生成看板、追踪、补全、纠错、故事、对比
- **家庭成员**：邀请码加入，`owner` / `editor` / `viewer` 三级权限，viewer 只读
- **软删除**：记录删除是标记删除，带完整审计事件表

## 技术栈

| 层 | 选型 |
|---|---|
| 客户端 | 微信小程序原生（JavaScript / WXML / WXSS），无构建流程 |
| 后端 | 微信云开发：云函数 + 云数据库 + 云存储 |
| 鉴权 | `openid`（`cloud.getWXContext()` 注入），家庭成员关系判定只在服务端 |
| 模型 | DeepSeek，密钥仅存在于云函数环境变量 |

前置要求：微信开发者工具、一个已认证或个人主体的 AppID、一个云开发环境。

## 目录结构

```
miniprogram/
├── app.js                    云函数调用入口、成员状态缓存
├── utils/config.js           云环境 ID（需替换）
├── components/
│   ├── backdrop/             毛玻璃背景层（光斑 + 浮尘动效）
│   ├── navbar/               自定义导航栏
│   └── smart-card/           动态卡片渲染器
└── pages/
    ├── index/                月历 + 当天列表 + 输入条
    ├── growth/               成长档案
    ├── library/              记录库
    ├── search/               搜索
    ├── assistant/            AI 助手
    ├── edit/                 记录编辑（展示前后对比后确认）
    ├── members/              成员管理、邀请
    ├── join/                 加入家庭 / 创建家庭
    └── ai-settings/          AI 规则设置（owner 可见）

cloudfunctions/
├── family/                   成员、家庭、邀请、角色、宝宝档案
└── entries/                  记录读写、识别、卡片、助手
    ├── index.js              路由与事务
    ├── cards.js              卡片结构校验
    ├── assistant.js          计划/纠错/来源引用校验
    └── prompts.js            提示词模板与长度校验
```

## 自己跑起来

### 1. 导入项目

微信开发者工具 → 导入项目 → 选择本仓库根目录。

改 `project.config.json` 的 `appid` 为自己的小程序 AppID。

### 2. 开通云开发

开发者工具 → 云开发 → 开通（免费环境够用）→ 记下环境 ID（形如 `cloud1-xxxxxxxx`）。

写入 `miniprogram/utils/config.js`：

```js
module.exports = {
  envId: 'cloud1-xxxxxxxx',  // 换成自己的
};
```

小程序端必须写明确的 ID，`DYNAMIC_CURRENT_ENV` 只在云函数里有效。

### 3. 建集合

云开发控制台 → 数据库 → 新建集合，共 6 个：

| 集合 | 作用 |
|---|---|
| `families` | 家庭 |
| `members` | user_id → family_code，一人一行 |
| `invites` | 邀请码、角色、有效期、使用人 |
| `entries` | 记录正文 |
| `entry_events` | 审计事件（每次修改一条） |
| `entry_types` | 家庭自定义记录类型 |

数据读写全部走云函数（管理员权限），集合权限保持默认「仅创建者可读写」即可，不要开放给客户端直读。

### 4. 部署云函数

右键 `cloudfunctions/family` → 上传并部署 → **云端安装依赖**。
`entries` 同样操作。

命令行部署（微信开发者工具 CLI），**必须带 `--remote-npm-install`**：

```bash
# macOS 下 CLI 路径，Windows 为安装目录下的 cli.bat
/Applications/wechatwebdevtools.app/Contents/MacOS/cli cloud functions deploy \
  --env cloud1-xxxxxxxx \
  --names family entries \
  --remote-npm-install \
  --project /绝对路径/本仓库
```

注意 `--project` 指向**仓库根目录**（含 `project.config.json` 的那层），不是 `miniprogram/`。

不带这个参数，CLI 只上传 `index.js` + `package.json`，云端不会安装 `wx-server-sdk`，调用直接报 `Cannot find module 'wx-server-sdk'`。

首次部署或刚更新过，函数处于 `Creating` / `Updating` 状态时会报 `FailedOperation.UpdateFunctionCode`，等 15 秒重试即可。

### 5. 配置模型密钥

云开发控制台 → 云函数 → `entries` → 函数配置 → 环境变量，添加：

```
DEEPSEEK_KEY = <你的 DeepSeek API Key>
```

不配置也能用：记录照常保存，只是自动识别和助手不可用。

**不要**把密钥写进源码、前端或数据库。

### 6. 开始使用

第一次进入小程序 → 「以管理员身份创建家庭」→ 生成 6 位邀请码 → 家人输码加入。

邀请码 7 天有效，字符集去掉了易混的 `i l o 0 1`。

## 数据模型要点

- **时间**：记录有日期 `happened_on`；具体时刻存 `at`（`HH:mm`）。没有具体时刻时显示首次保存的 `created_at`，不刷新成当前时间。
- **软删除**：`deleted_at` 非空即视为已删，只给 UPDATE 权限，不给 DELETE。
- **审计**：`entry_events` 每次修改一条，带 `revision`，用于并发校验和前后对比。
- **幂等**：`add` 支持重复提交按值比较，卡片对象键顺序不影响相等判断，数组顺序保留。

## 隐私设计

- 家庭成员关系**只在服务端判定**：`openid` 由云函数注入，清缓存、换手机都不丢；本地 storage 只做首屏加速。
- 所有 `entries` 操作先校验 `getMember(OPENID)`，没有成员记录直接拒绝。
- 写权限仅 `owner` / `editor`，`viewer` 只读。
- AI 识别只发送当前这一条原文；助手只发送命中的历史记录，且界面会写明这次发了几条。
- 模型只提取原文有的事实，不编造地点、时间、用药。

## 已知限制

- **仅微信小程序**，没有独立的 Web 端或 App。
- **未做过大规模测试**：单人家庭自用项目，压力、并发、边界场景未系统验证。
- **模型识别是概率性的**：口语时间、跨夜事件、多事件混写等场景会出错，所以界面保留了「预览 → 确认」一步。
- **动态卡片是声明式数据**，不能执行模型生成的代码。

## License

MIT
