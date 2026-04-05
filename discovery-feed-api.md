# Discovery Feed API（新词发现导出）

- 接口文件：`app/api/integrations/discovery-feed/route.ts`
- 本地访问地址：`http://localhost:3000/api/integrations/discovery-feed`

## 1. 鉴权

支持以下 Header（任选其一）：

- `x-partner-token: <token>`
- `Authorization: Bearer <token>`

Token 由环境变量提供：

- `DISCOVERY_PARTNER_TOKEN`

未授权返回：

- `401 { "error": "Unauthorized" }`

## 2. 请求方法

- `GET`

## 3. 请求参数

### 必传

- `userId`：用户 ID（UUID）

### 常用可选参数

- `status`（默认 `new`）：
  - `new` / `compared` / `ignored` / `all`
- `compact`（默认 `1`）：
  - `1`：返回紧凑模式（默认，仅返回 `keyword + reason`）
  - `0`：返回原始完整结构（包含 discoveredKeywords/comparisonResults/filters/totals）
- `includeComparison`（默认 `1`）：是否参与对比原因判断
- `includeFailedComparison`（默认 `0`）：是否把 `fail` 结果参与判定
- `since`：新词起始时间（ISO，如 `2026-03-25T00:00:00.000Z`）
- `comparisonSince`：对比会话起始时间（ISO）
- `keywordsLimit`（默认 `200`，范围 `1~1000`）
- `comparisonSessions`（默认 `3`，范围 `1~20`）
- `resultLimit`（默认 `300`，范围 `1~3000`）
- `verdicts`：逗号分隔，例 `strong,pass,close,watch`；默认 `strong,pass,close,watch`，`fail` 默认会被剔除（除非 `includeFailedComparison=1`）

## 4. 成功响应

### 默认响应（compact=1）

```json
{
  "generatedAt": "2026-03-26T00:00:00.000Z",
  "userId": "3420d268-bce3-435e-89e7-8dee4b9dbc92",
  "items": [
    {
      "keyword": "example keyword",
      "reason": "pass"
    },
    {
      "keyword": "another keyword",
      "reason": "new"
    }
  ]
}
```

字段含义：

- `generatedAt`：响应生成时间（ISO）
- `userId`：请求用户 ID
- `items`：关键词列表（去重）
  - `keyword`：新发现词
  - `reason`：原因/判定
    - `new` / `compared` / `ignored`：来自关键词状态
    - `strong` / `pass` / `close` / `watch` / `fail`：来自对比结果的判定

### 完整响应（compact=0）

保持之前的完整结构（`discoveredKeywords`、`comparisonResults`、`filters`、`totals` 等），适合你们内部调试时临时查看。

## 5. 错误响应

- `400 { "error": "Missing userId" }`：未传 `userId`
- `401 { "error": "Unauthorized" }`：鉴权失败
- `500 { "error": "..." }`：服务端或 D1 查询异常

## 6. 调用示例（本地）

### 只要紧凑结果

```bash
curl "http://localhost:3000/api/integrations/discovery-feed?userId=<YOUR_USER_ID>&status=new&keywordsLimit=100&includeComparison=1" ^
  -H "x-partner-token: <YOUR_TOKEN>"
```

### 只取强相关/通过

```bash
curl "http://localhost:3000/api/integrations/discovery-feed?userId=<YOUR_USER_ID>&status=new&compact=1&includeComparison=1&verdicts=strong,pass&includeFailedComparison=0&comparisonSessions=3" ^
  -H "x-partner-token: <YOUR_TOKEN>"
```

### 调试完整结构

```bash
curl "http://localhost:3000/api/integrations/discovery-feed?userId=<YOUR_USER_ID>&compact=0&status=new&includeComparison=1" ^
  -H "x-partner-token: <YOUR_TOKEN>"
```

