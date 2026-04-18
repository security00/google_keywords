# discoverkeywords.co API 文档

关键词研究工具 API，支持词根扩展、候选筛选、趋势对比、SERP 分析等功能。

## Base URL

```
https://discoverkeywords.co
```

## 认证方式

所有 API 请求需要认证（除登录/注册接口外）：

### 方式一：Bearer Token（推荐）

```http
Authorization: Bearer gk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 方式二：Query Parameter

```http
GET /api/research/expand/status?jobId=xxx&api_key=gk_live_xxx
```

### 方式三：Cookie（网页使用）

登录后自动携带 session cookie，无需手动传递。

---

## 配额限制

- **管理员**：无限制
- **学员**：每天 3 次综合 API 调用（expand/compare/serp/trends 合计）
- **缓存命中**：不计入配额
- **试用期**：90 天，到期后需续费

---

## 认证接口

### 1. 用户注册

```http
POST /api/auth/sign-up
```

**请求体：**

```json
{
  "email": "user@example.com",
  "password": "securepassword123",
  "inviteCode": "SK-XXXX-XXXX"
}
```

**响应（成功）：**

```json
{
  "user": {
    "id": "3420d268-bce3-435e-89e7-8dee4b9dbc92",
    "email": "user@example.com",
    "role": "student"
  }
}
```

**错误：**

- 400 - 邮箱格式错误
- 400 - 邀请码无效
- 409 - 邮箱已被注册

---

### 2. 用户登录

```http
POST /api/auth/sign-in
```

**请求体：**

```json
{
  "email": "user@example.com",
  "password": "securepassword123"
}
```

**响应（成功）：**

```json
{
  "user": {
    "id": "3420d268-bce3-435e-89e7-8dee4b9dbc92",
    "email": "user@example.com",
    "role": "student"
  }
}
```

**Set-Cookie：** session token（有效期 90 天）

**错误：**

- 401 - 邮箱或密码错误
- 403 - 账号已被封禁

---

### 3. 查询账号状态

```http
GET /api/auth/access
```

**响应：**

```json
{
  "userId": "3420d268-bce3-435e-89e7-8dee4b9dbc92",
  "email": "user@example.com",
  "role": "student",
  "trial": {
    "active": true,
    "daysLeft": 87,
    "expiresAt": "2026-07-01T00:00:00.000Z"
  },
  "quota": {
    "used": 1,
    "limit": 3
  },
  "blocked": false
}
```

**错误：** 401 - 未登录

---

## API Key 管理

### 1. 生成 API Key

```http
POST /api/auth/keys
```

**请求体：**

```json
{
  "name": "skill-001"
}
```

**响应：**

```json
{
  "key": "gk_live_8a7b6c5d4e3f2a1b9c8d7e6f5a4b3c2d",
  "id": 1
}
```

**限制：** 每个用户最多 5 个激活的 Key

---

### 2. 列出 API Keys

```http
GET /api/auth/keys
```

**响应：**

```json
{
  "keys": [
    {
      "id": 1,
      "key": "gk_live_8a7b6c5d4e3f2a1b9c8d7e6f5a4b3c2d",
      "name": "skill-001",
      "created_at": "2026-04-10T06:00:00.000Z",
      "active": 1
    }
  ]
}
```

---

### 3. 撤销 API Key

```http
DELETE /api/auth/keys
```

**请求体：**

```json
{
  "keyId": 1
}
```

**响应：** 200 OK

---

## 研究接口

### 1. 词根扩展

```http
POST /api/research/expand
```

**请求体：**

```json
{
  "keywords": ["ai tattoo generator", "ai portrait generator"]
}
```

**说明：**

- 该接口现在采用异步任务模式
- `POST /api/research/expand` 只负责提交任务并返回 `jobId`
- 调用方必须继续轮询 `GET /api/research/expand/status?jobId=...` 获取最终结果
- 缓存命中时也会优先返回已有 `jobId`，而不是直接同步回完整数据

**响应（提交成功）：**

```json
{
  "jobId": "123e4567-e89b-12d3-a456-426614174000",
  "status": "pending",
  "fromCache": false
}
```

**响应（缓存命中）：**

```json
{
  "jobId": "123e4567-e89b-12d3-a456-426614174000",
  "status": "pending",
  "fromCache": true
}
```

**配额消耗：** 1 次（缓存命中不计）

---

### 2. 查询扩展状态

```http
GET /api/research/expand/status?jobId=123e4567-e89b-12d3-a456-426614174000
```

**响应（进行中）：**

```json
{
  "status": "pending",
  "ready": 1,
  "total": 2
}
```

**响应（完成）：**

```json
{
  "status": "complete",
  "keywords": ["ai tattoo generator", "ai portrait generator"],
  "dateFrom": "2026-04-07",
  "dateTo": "2026-04-14",
  "flatList": [
    {
      "keyword": "free ai tattoo",
      "value": 85,
      "type": "rising",
      "source": "ai tattoo generator"
    }
  ],
  "sessionId": "0d16c1e2-6d1d-47a6-b0f3-0f4abdbf9501"
}
```

---

### 3. 候选筛选

```http
POST /api/research/compare
```

**请求体：**

```json
{
  "keywords": ["ai tattoo generator", "ai portrait generator", "free ai tattoo"]
}
```

**说明：**

- compare 也采用异步任务模式
- `POST /api/research/compare` 返回 `jobId`
- 最终结果通过 `GET /api/research/compare/status?jobId=...` 获取

**响应（提交成功）：**

```json
{
  "jobId": "123e4567-e89b-12d3-a456-426614174000",
  "status": "pending",
  "strategy": "manual",
  "budget": 20,
  "selectedCount": 3,
  "availableCount": 3,
  "keywordIds": []
}
```

**配额消耗：** 1 次（缓存命中不计）

---

### 4. SERP 分析

```http
POST /api/research/serp
```

**请求体：**

```json
{
  "keywords": ["ai tattoo generator", "ai portrait generator"]
}
```

**响应（同步，约 30-60 秒）：**

```json
{
  "results": {
    "ai tattoo generator": {
      "itemTypes": ["organic", "people_also_ask"],
      "signals": {
        "hasAiOverview": false,
        "hasFeaturedSnippet": true,
        "authDomains": 3,
        "nicheDomains": 5
      },
      "topResults": [
        {
          "title": "AI Tattoo Generator - Create Unique Designs",
          "domain": "tattoogen.ai",
          "url": "https://tattoogen.ai/generator",
          "description": "Use AI to generate unique tattoo designs..."
        }
      ]
    }
  }
}
```

**配额消耗：** 1 次

---

### 5. 趋势分析

```http
POST /api/research/trends
```

**请求体：**

```json
{
  "keywords": ["ai tattoo generator", "ai portrait generator"],
  "dateFrom": "2025-12-01",
  "dateTo": "2026-04-01"
}
```

**响应（同步，约 30-60 秒）：**

```json
{
  "results": [
    {
      "keyword": "ai tattoo generator",
      "verdict": "strong",
      "ratio": 1.35,
      "ratioMean": 1.2,
      "ratioRecent": 1.5,
      "ratioCoverage": 0.85,
      "ratioPeak": 1.8,
      "ratioLastPoint": 1.3,
      "slopeDiff": 0.2,
      "slopeRatio": 1.25,
      "volatility": 0.8,
      "crossings": 3,
      "series": [
        {"date": "2025-12-01", "keyword": 100, "benchmark": 80},
        {"date": "2025-12-08", "keyword": 115, "benchmark": 85}
      ],
      "explanation": {
        "summary": "关键词搜索热度持续上升",
        "intent": "transactional"
      }
    }
  ]
}
```

**Verdict 枚举值：** `strong` | `pass` | `close` | `watch` | `fail`

**配额消耗：** 1 次

---

### 6. 查询研究会话

**获取最新会话：**

```http
GET /api/research/session/latest
```

**获取会话列表：**

```http
GET /api/research/session/list
```

**获取指定会话：**

```http
GET /api/research/session/123e4567-e89b-12d3-a456-426614174000
```

**响应：**

```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "created_at": "2026-04-10T06:00:00.000Z",
  "keywords": ["ai tattoo generator"],
  "type": "expand",
  "title": "ai tattoo generator 研究",
  "results": { /* ... */ }
}
```

---

## 管理员接口（仅 admin）

### 1. 生成邀请码

```http
POST /api/admin/invite-codes
```

**请求体：**

```json
{
  "count": 5,
  "maxUsesPerCode": 1,
  "expiresInDays": 90
}
```

**响应：**

```json
{
  "codes": [
    {
      "code": "SK-C3A6-279C",
      "maxUses": 1,
      "currentUses": 0,
      "expiresAt": "2026-07-09T00:00:00.000Z"
    }
  ]
}
```

---

### 2. 列出邀请码

```http
GET /api/admin/invite-codes
```

---

### 3. 删除邀请码

```http
DELETE /api/admin/invite-codes
```

**请求体：**

```json
{
  "code": "SK-C3A6-279C"
}
```

---

### 4. 用户列表

```http
GET /api/admin/users
```

**响应：**

```json
{
  "users": [
    {
      "id": "3420d268-bce3-435e-89e7-8dee4b9dbc92",
      "email": "user@example.com",
      "role": "student",
      "blocked": false,
      "createdAt": "2026-04-01T00:00:00.000Z",
      "trialExpiresAt": "2026-07-01T00:00:00.000Z"
    }
  ]
}
```

---

### 5. 用户详情

```http
GET /api/admin/users/3420d268-bce3-435e-89e7-8dee4b9dbc92
```

---

### 6. 封禁/解封用户

```http
PATCH /api/admin/users/3420d268-bce3-435e-89e7-8dee4b9dbc92
```

**请求体：**

```json
{
  "blocked": true
}
```

**请求体（修改角色，仅 admin 可用）：**

```json
{
  "role": "admin"
}
```

---

## 错误码

| 状态码 | 说明 |
|---|---|
| 200 | 成功 |
| 400 | 请求参数错误 |
| 401 | 未认证 / 登录失败 |
| 403 | 权限不足 / 账号被封禁 |
| 404 | 资源不存在 |
| 429 | 配额已用完 |
| 500 | 服务器错误 |

---

## 示例代码

### Python（gk_api.py）

```python
import os
import time
import requests

API_KEY = os.environ["GK_API_KEY"]
BASE_URL = os.environ.get("GK_SITE_URL", "https://discoverkeywords.co")

def expand_keywords(seeds):
    submit_res = requests.post(
        f"{BASE_URL}/api/research/expand",
        json={"keywords": seeds},
        headers={"Authorization": f"Bearer {API_KEY}"}
    )
    submit_res.raise_for_status()
    submit_data = submit_res.json()
    job_id = submit_data["jobId"]

    while True:
        status_res = requests.get(
            f"{BASE_URL}/api/research/expand/status?jobId={job_id}",
            headers={"Authorization": f"Bearer {API_KEY}"}
        )
        status_res.raise_for_status()
        status_data = status_res.json()

        if status_data["status"] == "complete":
            return status_data["flatList"]
        if status_data["status"] == "failed":
            raise RuntimeError(status_data.get("error", "expand failed"))

        time.sleep(3)
```

### cURL

```bash
# 登录
curl -X POST https://discoverkeywords.co/api/auth/sign-in \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"pass"}'

# 词根扩展（API Key）
curl -X POST https://discoverkeywords.co/api/research/expand \
  -H "Authorization: Bearer gk_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{"seeds":["ai tattoo generator"]}'

# SERP 分析（Query Parameter）
curl -X POST https://discoverkeywords.co/api/research/serp \
  -H "Content-Type: application/json" \
  -d '{"keywords":["ai tattoo generator"]}&api_key=gk_live_xxx'
```

---

## 更新日志

- **2026-04-10**：新增 SERP 和 Trends API，Admin 面板合并到 Dashboard
- **2026-04-09**：API Key 管理上线，配额控制上线
- **2026-04-08**：学生系统上线，邀请码注册

---

## 支持

- **网站**：https://discoverkeywords.co
- **反馈**：联系管理员
