# 美股日报数据源说明

> 生成目标：`reports/us_stock_daily_YYYYMMDD.md` 等美股日报
> 维护工具：`tools/fetch-sina-us-stock.mjs`

## 一、环境检查结论

1. **无付费 API Key**：`.env.example` 与系统环境变量中均未配置 Alpha Vantage、Polygon、Yahoo Finance、FMP 等美股行情 API Key。
2. **Yahoo Finance 不可达**：`query1.finance.yahoo.com` 在中国大陆被重定向至服务不可用页面（Sad Panda），无法作为数据源。
3. **选定主数据源**：新浪财经 `hq.sinajs.cn`，免费、无需 Key、大陆网络可达，覆盖美股个股与主要指数。

## 二、主数据源：新浪财经

### 2.1 接口地址

```
GET https://hq.sinajs.cn/list={symbols}
```

- 多个 symbol 用英文逗号分隔。
- 美股个股/指数前缀为 `gb_`，例如 `gb_aapl`、`gb_inx`。
- 外盘期货前缀为 `hf_`，例如 `hf_CL`（WTI 原油）、`hf_OIL`（布伦特原油）。

### 2.2 请求头

必须携带 `Referer`，否则可能返回空：

```http
Referer: https://finance.sina.com.cn
User-Agent: Mozilla/5.0
```

### 2.3 响应编码

响应体为 **GB2312** 编码的 JavaScript 变量文本，需使用 `TextDecoder('gb2312')` 解码。

### 2.4 返回字段清单（美股个股/指数 `gb_`）

以下按字段索引列出，工具脚本 `tools/fetch-sina-us-stock.mjs` 已做映射：

| 索引 | 含义 | 映射字段 |
|---|---|---|
| 0 | 中文名称 | `name` |
| 1 | 最新价 | `price` |
| 2 | 涨跌幅（%） | `changePercent` |
| 3 | 行情时间 | `updatedAt` |
| 4 | 涨跌额 | `change` |
| 5 | 开盘价 | `open` |
| 6 | 最高价 | `high` |
| 7 | 最低价 | `low` |
| 8 | 52 周最高 | `week52High` |
| 9 | 52 周最低 | `week52Low` |
| 10 | 成交量 | `volume` |
| 11 | — | — |
| 12 | 市值（个股） | `marketCap` |
| 26 | 前收盘价 | `prevClose` |

指数行情字段 11/12 通常为空或 0，因此 `marketCap` 为 `null`。

### 2.5 返回字段清单（外盘期货 `hf_`）

| 索引 | 含义 | 映射字段 |
|---|---|---|
| 0 | 最新价 | `price` |
| 4 | 最高价 | `high` |
| 5 | 最低价 | `low` |
| 6 | 更新时间 | `time` |
| 7 | 昨收 | `prevClose` |
| 8 | 今开 | `open` |
| 12 | 日期 | `date` |
| 13 | 中文名称 | `name` |

涨跌幅由脚本根据 `price - prevClose` 计算得出。

### 2.6 已验证可获取的标的

| 类型 | Symbol | 说明 |
|---|---|---|
| 指数 | `gb_inx` | S&P 500 |
| 指数 | `gb_ixic` | 纳斯达克综合指数 |
| 指数 | `gb_dji` | 道琼斯工业指数 |
| 个股 | `gb_aapl`、`gb_sndk`、`gb_glw`、`gb_intc` 等 | 美股个股 |
| 期货 | `hf_CL` | WTI 原油期货 |
| 期货 | `hf_OIL` | 布伦特原油期货 |
| 期货 | `hf_NQ`、`hf_ES` | 纳斯达克 100 / 标普 500 股指期货 |

## 三、美股新闻数据源

日报中的新闻通过新浪财经滚动新闻接口获取：

```
GET https://feed.sina.com.cn/api/roll/get?pageid=153&lid=2516&k=&num={N}&page=1&r={random}
```

- 无需 API Key，需携带 `Referer: https://finance.sina.com.cn`。
- 返回 JSON，每条新闻包含 `title`、`intro`、`url`、`wapurl`、`media_name`、`ctime` 等字段。

## 四、使用方式

### 4.1 一键获取每日原始数据（行情 + 新闻）

```bash
# 默认生成今日日期的 reports/us_stock_raw_YYYYMMDD.json
node tools/fetch-us-stock-raw.mjs

# 指定日期（YYYYMMDD）与数据基准日期（YYYY-MM-DD）
node tools/fetch-us-stock-raw.mjs 20260620 2026-06-19
```

该脚本会同时生成：

- `reports/us_stock_raw_<YYYYMMDD>.json`：包含日期、指数、个股、新闻的原始汇总数据。
- `reports/us_stock_indices_<YYYYMMDD>.json`：大盘指数明细，供下游统计工具使用。
- `reports/us_stock_focus_<YYYYMMDD>.json`：重点个股明细，供下游统计工具使用。

### 4.2 单独获取行情

```bash
# 获取默认标的（三大指数 + 示例个股 + 期货）
node tools/fetch-sina-us-stock.mjs

# 自定义标的
node tools/fetch-sina-us-stock.mjs gb_inx gb_aapl hf_CL
```

### 4.3 作为模块调用

```mjs
import { fetchQuotes } from './tools/fetch-sina-us-stock.mjs';

const quotes = await fetchQuotes(['gb_inx', 'gb_aapl', 'hf_CL']);
console.log(quotes);
```

## 五、数据源缺口

新浪财经 `hq.sinajs.cn` **不直接提供**以下标的，日报中若需要需通过其他方式补充：

- Cboe VIX 波动率指数
- 美国 10 年期国债收益率（TNX）
- 美国 2 年期国债收益率（FVX）

## 六、验证记录

- 验证时间：2026-06-19
- 验证命令：`node tools/fetch-sina-us-stock.mjs`
- 验证结果：16 个默认标的全部成功返回，JSON 字段映射正确，数据与 `reports/us_stock_daily_20260619.md` 中的收盘数据一致。

- 验证时间：2026-06-20
- 验证命令：`node tools/fetch-us-stock-raw.mjs 20260620 2026-06-19`
- 验证结果：3 个指数、9 只重点个股、10 条新闻均成功获取，`reports/us_stock_raw_20260620.json` 字段完整，无关键空值。
