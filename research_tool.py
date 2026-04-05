"""
关键词研究自动化工具 v2.0
========================================
基于 DataForSEO Google Trends API（异步任务版本）

工作流程：
1. 词根扩展 - 获取相关查询词
2. 智能整理 - 按增长率排序分层
3. 人工筛选 - 你选择想对比的词
4. 趋势对比 - 选中的词 vs gpts
"""

import requests
import json
import base64
import time
import re
import os
from datetime import datetime, timedelta

# ============================================
# 配置区域 - 通过环境变量读取凭证
# ============================================
DATAFORSEO_LOGIN = os.getenv("DATAFORSEO_LOGIN", "").strip()
DATAFORSEO_PASSWORD = os.getenv("DATAFORSEO_PASSWORD", "").strip()

# 缓存配置
CACHE_DIR = "cache"
CACHE_EXPIRY_HOURS = 24  # 缓存有效期（小时）

# API 端点
TASK_POST_URL = "https://api.dataforseo.com/v3/keywords_data/google_trends/explore/task_post"
TASKS_READY_URL = "https://api.dataforseo.com/v3/keywords_data/google_trends/explore/tasks_ready"
TASK_GET_URL = "https://api.dataforseo.com/v3/keywords_data/google_trends/explore/task_get"

# 时间范围：过去 7 天
DATE_TO = datetime.now().strftime("%Y-%m-%d")
DATE_FROM = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")

# 轮询配置
POLL_INTERVAL = 10  # 每 10 秒检查一次
MAX_WAIT_TIME = 300  # 最长等待 5 分钟

# 基准对比词
BENCHMARK_KEYWORD = "gpts"


# ============================================
# 工具函数
# ============================================
def get_auth_header():
    """生成 Basic Auth 头"""
    if not DATAFORSEO_LOGIN or not DATAFORSEO_PASSWORD:
        raise ValueError(
            "缺少 DataForSEO 凭证，请设置环境变量 DATAFORSEO_LOGIN 和 DATAFORSEO_PASSWORD"
        )
    credentials = f"{DATAFORSEO_LOGIN}:{DATAFORSEO_PASSWORD}"
    encoded = base64.b64encode(credentials.encode()).decode()
    return {"Authorization": f"Basic {encoded}", "Content-Type": "application/json"}


def request_with_retry(method: str, url: str, max_retries: int = 3, **kwargs):
    """
    带重试机制的请求函数
    
    Args:
        method: 'get' 或 'post'
        url: 请求 URL
        max_retries: 最大重试次数
        **kwargs: 传递给 requests 的其他参数
    
    Returns:
        Response 对象或 None
    """
    for attempt in range(max_retries):
        try:
            if method.lower() == 'get':
                response = requests.get(url, timeout=30, **kwargs)
            else:
                response = requests.post(url, timeout=30, **kwargs)
            return response
        
        except (requests.exceptions.SSLError, 
                requests.exceptions.ConnectionError,
                requests.exceptions.Timeout) as e:
            
            if attempt < max_retries - 1:
                wait_time = (attempt + 1) * 5  # 5秒, 10秒, 15秒
                print(f"\n  ⚠️ 网络错误，{wait_time}秒后重试 ({attempt + 1}/{max_retries})...")
                time.sleep(wait_time)
            else:
                print(f"\n  ❌ 请求失败: {e}")
                return None
    
    return None


def create_batches(items: list, batch_size: int) -> list:
    """将列表分成批次"""
    return [items[i:i + batch_size] for i in range(0, len(items), batch_size)]


# ============================================
# 缓存管理
# ============================================
def get_cache_filename(keywords: list) -> str:
    """根据词根列表生成缓存文件名"""
    # 用日期 + 词根哈希生成唯一文件名
    date_str = datetime.now().strftime("%Y%m%d")
    keywords_str = "_".join(sorted(keywords)[:5])  # 取前5个词作为标识
    keywords_hash = hash(tuple(sorted(keywords))) % 100000
    return os.path.join(CACHE_DIR, f"cache_{date_str}_{keywords_hash}.json")


def load_cache(keywords: list) -> dict:
    """
    加载缓存数据
    
    Returns:
        {"candidates": [...], "timestamp": "..."} 或 None
    """
    if not os.path.exists(CACHE_DIR):
        os.makedirs(CACHE_DIR)
        return None
    
    cache_file = get_cache_filename(keywords)
    
    if not os.path.exists(cache_file):
        return None
    
    try:
        with open(cache_file, "r", encoding="utf-8") as f:
            cache_data = json.load(f)
        
        # 检查缓存是否过期
        cached_time = datetime.fromisoformat(cache_data.get("timestamp", "2000-01-01"))
        expiry_time = datetime.now() - timedelta(hours=CACHE_EXPIRY_HOURS)
        
        if cached_time > expiry_time:
            return cache_data
        else:
            print(f"  缓存已过期（超过 {CACHE_EXPIRY_HOURS} 小时）")
            return None
    
    except (json.JSONDecodeError, KeyError, ValueError) as e:
        print(f"  缓存文件损坏: {e}")
        return None


def save_cache(keywords: list, candidates: list):
    """保存数据到缓存"""
    if not os.path.exists(CACHE_DIR):
        os.makedirs(CACHE_DIR)
    
    cache_file = get_cache_filename(keywords)
    
    cache_data = {
        "timestamp": datetime.now().isoformat(),
        "keywords": keywords,
        "date_range": f"{DATE_FROM} to {DATE_TO}",
        "candidates": candidates
    }
    
    with open(cache_file, "w", encoding="utf-8") as f:
        json.dump(cache_data, f, ensure_ascii=False, indent=2)
    
    print(f"  ✓ 已缓存到: {cache_file}")


def list_available_caches() -> list:
    """列出所有可用的缓存文件"""
    if not os.path.exists(CACHE_DIR):
        return []
    
    caches = []
    for filename in os.listdir(CACHE_DIR):
        if filename.startswith("cache_") and filename.endswith(".json"):
            filepath = os.path.join(CACHE_DIR, filename)
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    data = json.load(f)
                caches.append({
                    "filename": filename,
                    "filepath": filepath,
                    "timestamp": data.get("timestamp"),
                    "keywords_count": len(data.get("keywords", [])),
                    "candidates_count": len(data.get("candidates", []))
                })
            except:
                pass
    
    return sorted(caches, key=lambda x: x["timestamp"], reverse=True)


# ============================================
# 第一步：词根扩展
# ============================================
def submit_expansion_tasks(keywords: list) -> list:
    """
    提交词根扩展任务
    注意：每次只传 1 个词根，这样 API 才会返回相关查询词（Related Queries）
    如果传多个词根，API 只返回对比图数据
    """
    payload = []
    for keyword in keywords:
        payload.append({
            "keywords": [keyword],  # 每次只传 1 个词根！
            "date_from": DATE_FROM,
            "date_to": DATE_TO,
            "type": "web",
            "item_types": ["google_trends_queries_list"]  # 只请求相关查询词
        })
    
    total_tasks = len(payload)
    print(f"\n  📤 正在提交 {total_tasks} 个任务（每个词根 1 个任务）...")
    print(f"  ┌{'─' * 50}┐")
    
    response = request_with_retry('post', TASK_POST_URL, headers=get_auth_header(), json=payload)
    
    if response is None:
        print(f"\n  └{'─' * 50}┘")
        print(f"  ✗ 网络请求失败")
        return []
    
    result = response.json()
    
    task_ids = []
    if result.get("status_code") == 20000:
        for i, task in enumerate(result.get("tasks", []), 1):
            if task.get("status_code") == 20100:
                task_ids.append(task.get("id"))
                # 进度条
                progress = int(i / total_tasks * 50)
                print(f"\r  │{'█' * progress}{'░' * (50 - progress)}│ {i}/{total_tasks}", end="", flush=True)
        print(f"\n  └{'─' * 50}┘")
        print(f"  ✓ 成功创建 {len(task_ids)} 个任务")
    else:
        print(f"\n  └{'─' * 50}┘")
        print(f"  ✗ API 错误: {result.get('status_message')}")
    
    return task_ids


def wait_for_tasks(task_ids: list, task_name: str = "任务") -> list:
    """等待任务完成"""
    total = len(task_ids)
    print(f"\n  ⏳ 等待 {total} 个{task_name}完成...")
    print(f"  ┌{'─' * 50}┐")
    
    pending_ids = set(task_ids)
    completed_ids = []
    start_time = time.time()
    
    spinner = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
    spin_idx = 0
    
    while pending_ids and (time.time() - start_time) < MAX_WAIT_TIME:
        response = request_with_retry('get', TASKS_READY_URL, headers=get_auth_header())
        
        if response is not None:
            result = response.json()
            
            if result.get("status_code") == 20000:
                ready_tasks = result.get("tasks", [{}])[0].get("result", []) or []
                for ready_task in ready_tasks:
                    task_id = ready_task.get("id")
                    if task_id in pending_ids:
                        pending_ids.remove(task_id)
                        completed_ids.append(task_id)
        
        # 更新进度
        done = len(completed_ids)
        progress = int(done / total * 50)
        elapsed = int(time.time() - start_time)
        spin_char = spinner[spin_idx % len(spinner)]
        spin_idx += 1
        
        print(f"\r  │{'█' * progress}{'░' * (50 - progress)}│ {done}/{total} {spin_char} {elapsed}s", end="", flush=True)
        
        if pending_ids:
            time.sleep(POLL_INTERVAL)
    
    print(f"\n  └{'─' * 50}┘")
    
    if pending_ids:
        print(f"  ⚠ 超时，{len(pending_ids)} 个任务未完成")
    else:
        print(f"  ✓ 全部完成！耗时 {int(time.time() - start_time)} 秒")
    
    return completed_ids


def get_expansion_results(task_ids: list) -> list:
    """获取词根扩展结果，返回候选词列表"""
    all_candidates = []
    total = len(task_ids)
    failed_ids = []
    
    print(f"\n  📥 正在获取 {total} 个任务的结果...")
    print(f"  ┌{'─' * 50}┐")
    
    debug_first = True  # 调试第一个任务的返回结构
    
    for idx, task_id in enumerate(task_ids, 1):
        url = f"{TASK_GET_URL}/{task_id}"
        response = request_with_retry('get', url, headers=get_auth_header())
        
        if response is None:
            failed_ids.append(task_id)
            progress = int(idx / total * 50)
            print(f"\r  │{'█' * progress}{'░' * (50 - progress)}│ {idx}/{total} 已获取 {len(all_candidates)} 个词 (失败 {len(failed_ids)})", end="", flush=True)
            continue
        
        result = response.json()
        
        # 调试：打印第一个任务的返回结构
        if debug_first:
            print(f"\n\n  [DEBUG] API 返回结构:")
            print(f"  status_code: {result.get('status_code')}")
            tasks = result.get("tasks", [])
            if tasks:
                task = tasks[0]
                print(f"  task.status_code: {task.get('status_code')}")
                task_result = task.get("result", [])
                if task_result:
                    print(f"  keywords: {task_result[0].get('keywords')}")
                    print(f"  items_count: {task_result[0].get('items_count')}")
                    items = task_result[0].get("items", [])
                    print(f"  items 数量: {len(items)}")
                    for i, item in enumerate(items):
                        print(f"    item[{i}].type: {item.get('type')}")
                        if item.get('type') == 'google_trends_queries_list':
                            print(f"    item[{i}].data: {item.get('data')}")
            print("\n")
            debug_first = False
        
        if result.get("status_code") == 20000:
            for task in result.get("tasks", []):
                if task.get("status_code") == 20000:
                    task_result = task.get("result", [])
                    if not task_result:
                        continue
                    
                    items = task_result[0].get("items", [])
                    source_keywords = task_result[0].get("keywords", [])
                    source_keyword = source_keywords[0] if source_keywords else "unknown"
                    
                    for item in items:
                        item_type = item.get("type", "")
                        
                        # 解析相关查询词 (google_trends_queries_list)
                        if item_type == "google_trends_queries_list":
                            data = item.get("data", {})
                            
                            # data 可能是 dict 格式：{"top": [...], "rising": [...]}
                            if isinstance(data, dict):
                                # 处理 top 查询词
                                for query_item in data.get("top", []):
                                    all_candidates.append({
                                        "keyword": query_item.get("query", ""),
                                        "value": query_item.get("value", 0),
                                        "type": "top",
                                        "source": source_keyword
                                    })
                                
                                # 处理 rising 查询词
                                for query_item in data.get("rising", []):
                                    all_candidates.append({
                                        "keyword": query_item.get("query", ""),
                                        "value": query_item.get("value", 0),
                                        "type": "rising",
                                        "source": source_keyword
                                    })
                            
                            # data 也可能是 list 格式
                            elif isinstance(data, list):
                                for query_item in data:
                                    query_text = query_item.get("query", "")
                                    value = query_item.get("value", 0)
                                    query_type = query_item.get("type", "")
                                    
                                    is_rising = "rising" in query_type.lower()
                                    
                                    all_candidates.append({
                                        "keyword": query_text,
                                        "value": value,
                                        "type": "rising" if is_rising else "top",
                                        "source": source_keyword
                                    })
        
        # 进度条
        progress = int(idx / total * 50)
        print(f"\r  │{'█' * progress}{'░' * (50 - progress)}│ {idx}/{total} 已获取 {len(all_candidates)} 个词", end="", flush=True)
        
        # 每获取 5 个任务暂停一下，避免请求过快
        if idx % 5 == 0:
            time.sleep(1)
    
    print(f"\n  └{'─' * 50}┘")
    
    if failed_ids:
        print(f"  ⚠️ {len(failed_ids)} 个任务获取失败")
    
    print(f"  ✓ 共获取 {len(all_candidates)} 个候选词")
    
    return all_candidates


# ============================================
# 第二步：智能整理
# ============================================
def organize_candidates(candidates: list) -> dict:
    """按增长率整理候选词"""
    
    # 只保留 rising 类型的词（有增长率数据）
    rising_candidates = [c for c in candidates if c["type"] == "rising"]
    
    # 去重（保留增长率最高的）
    seen = {}
    for c in rising_candidates:
        kw = c["keyword"].lower()
        if kw not in seen or c["value"] > seen[kw]["value"]:
            seen[kw] = c
    
    unique_candidates = list(seen.values())
    
    # 按增长率排序（高 → 低）
    sorted_candidates = sorted(unique_candidates, key=lambda x: x["value"], reverse=True)
    
    # 分层
    organized = {
        "explosive": [],      # 🔥 > 500%
        "fast_rising": [],    # ⚡ 200-500%
        "steady_rising": [],  # 📈 100-200%
        "slow_rising": []     # 📊 < 100%
    }
    
    for c in sorted_candidates:
        v = c["value"]
        if v > 500:
            organized["explosive"].append(c)
        elif v > 200:
            organized["fast_rising"].append(c)
        elif v > 100:
            organized["steady_rising"].append(c)
        else:
            organized["slow_rising"].append(c)
    
    return organized


def display_candidates(organized: dict) -> list:
    """展示候选词列表，返回扁平化的列表供选择"""
    flat_list = []
    index = 1
    
    print("\n" + "=" * 70)
    print("候选词列表（按增长率排序）")
    print("=" * 70)
    
    # 🔥 爆发词
    if organized["explosive"]:
        print(f"\n🔥 爆发词（增长率 > 500%）共 {len(organized['explosive'])} 个")
        print("-" * 70)
        for c in organized["explosive"][:20]:  # 最多显示 20 个
            print(f"  {index:3}. [{c['value']:>6}%] {c['keyword']:<40} (来源: {c['source']})")
            flat_list.append(c)
            index += 1
        if len(organized["explosive"]) > 20:
            print(f"      ... 还有 {len(organized['explosive']) - 20} 个")
    
    # ⚡ 快速上升
    if organized["fast_rising"]:
        print(f"\n⚡ 快速上升（增长率 200-500%）共 {len(organized['fast_rising'])} 个")
        print("-" * 70)
        for c in organized["fast_rising"][:15]:
            print(f"  {index:3}. [{c['value']:>6}%] {c['keyword']:<40} (来源: {c['source']})")
            flat_list.append(c)
            index += 1
        if len(organized["fast_rising"]) > 15:
            print(f"      ... 还有 {len(organized['fast_rising']) - 15} 个")
    
    # 📈 稳步上升
    if organized["steady_rising"]:
        print(f"\n📈 稳步上升（增长率 100-200%）共 {len(organized['steady_rising'])} 个")
        print("-" * 70)
        for c in organized["steady_rising"][:10]:
            print(f"  {index:3}. [{c['value']:>6}%] {c['keyword']:<40} (来源: {c['source']})")
            flat_list.append(c)
            index += 1
        if len(organized["steady_rising"]) > 10:
            print(f"      ... 还有 {len(organized['steady_rising']) - 10} 个")
    
    # 📊 缓慢上升（默认不显示，太多了）
    if organized["slow_rising"]:
        print(f"\n📊 缓慢上升（增长率 < 100%）共 {len(organized['slow_rising'])} 个 [未显示]")
    
    print("\n" + "=" * 70)
    print(f"共展示 {len(flat_list)} 个候选词")
    print("=" * 70)
    
    return flat_list


# ============================================
# 第三步：人工筛选
# ============================================
def user_selection(flat_list: list) -> list:
    """让用户选择想要对比的词"""
    
    print("\n请选择想要对比的词（与 gpts 对比）")
    print("-" * 70)
    print("输入方式：")
    print("  - 输入数字，逗号分隔，如：1,3,5,7,10")
    print("  - 输入范围，如：1-10")
    print("  - 输入 all 选择全部（不推荐，成本高）")
    print("  - 输入 top20 选择前 20 个")
    print("  - 输入 q 退出")
    print("-" * 70)
    
    while True:
        user_input = input("\n请输入: ").strip().lower()
        
        if user_input == "q":
            return []
        
        if user_input == "all":
            confirm = input(f"确定选择全部 {len(flat_list)} 个词？成本约 ${len(flat_list) / 4 * 0.05:.2f} (y/n): ")
            if confirm.lower() == "y":
                return flat_list
            continue
        
        if user_input == "top20":
            return flat_list[:20]
        
        # 解析数字和范围
        selected_indices = set()
        parts = user_input.replace(" ", "").split(",")
        
        try:
            for part in parts:
                if "-" in part:
                    start, end = part.split("-")
                    for i in range(int(start), int(end) + 1):
                        selected_indices.add(i)
                else:
                    selected_indices.add(int(part))
            
            # 验证索引范围
            valid_indices = [i for i in selected_indices if 1 <= i <= len(flat_list)]
            
            if not valid_indices:
                print("无效的选择，请重新输入")
                continue
            
            selected = [flat_list[i - 1] for i in sorted(valid_indices)]
            
            print(f"\n已选择 {len(selected)} 个词：")
            for i, c in enumerate(selected, 1):
                print(f"  {i}. {c['keyword']} ({c['value']}%)")
            
            confirm = input(f"\n确认选择？预计成本 ${len(selected) / 4 * 0.05:.2f} (y/n): ")
            if confirm.lower() == "y":
                return selected
        
        except ValueError:
            print("输入格式错误，请重新输入")


# ============================================
# 第四步：趋势对比
# ============================================
def submit_comparison_tasks(selected_keywords: list) -> list:
    """提交趋势对比任务（每 4 个候选词 + 1 个 gpts = 5 个词一组）"""
    
    keyword_texts = [c["keyword"] for c in selected_keywords]
    batches = create_batches(keyword_texts, 4)
    
    payload = []
    for batch in batches:
        keywords_with_benchmark = batch + [BENCHMARK_KEYWORD]
        payload.append({
            "keywords": keywords_with_benchmark,
            "date_from": DATE_FROM,
            "date_to": DATE_TO,
            "type": "web"
        })
    
    total_batches = len(payload)
    print(f"\n  📤 正在提交 {total_batches} 个对比任务...")
    print(f"  ┌{'─' * 50}┐")
    
    response = request_with_retry('post', TASK_POST_URL, headers=get_auth_header(), json=payload)
    
    if response is None:
        print(f"\n  └{'─' * 50}┘")
        print(f"  ✗ 网络请求失败")
        return []
    
    result = response.json()
    
    task_ids = []
    if result.get("status_code") == 20000:
        for i, task in enumerate(result.get("tasks", []), 1):
            if task.get("status_code") == 20100:
                task_ids.append(task.get("id"))
                progress = int(i / total_batches * 50)
                print(f"\r  │{'█' * progress}{'░' * (50 - progress)}│ {i}/{total_batches}", end="", flush=True)
        print(f"\n  └{'─' * 50}┘")
        print(f"  ✓ 成功创建 {len(task_ids)} 个任务")
    else:
        print(f"\n  └{'─' * 50}┘")
        print(f"  ✗ API 错误: {result.get('status_message')}")
    
    return task_ids


def get_comparison_results(task_ids: list) -> list:
    """获取趋势对比结果"""
    all_results = []
    total = len(task_ids)
    failed_ids = []
    
    print(f"\n  📥 正在获取 {total} 个对比任务的结果...")
    print(f"  ┌{'─' * 50}┐")
    
    for idx, task_id in enumerate(task_ids, 1):
        url = f"{TASK_GET_URL}/{task_id}"
        response = request_with_retry('get', url, headers=get_auth_header())
        
        if response is None:
            failed_ids.append(task_id)
            progress = int(idx / total * 50)
            print(f"\r  │{'█' * progress}{'░' * (50 - progress)}│ {idx}/{total} (失败 {len(failed_ids)})", end="", flush=True)
            continue
        
        result = response.json()
        
        if result.get("status_code") == 20000:
            for task in result.get("tasks", []):
                if task.get("status_code") == 20000:
                    items = task.get("result", [{}])[0].get("items", [])
                    keywords = task.get("result", [{}])[0].get("keywords", [])
                    
                    for item in items:
                        if item.get("type") == "google_trends_graph":
                            data = item.get("data", [])
                            
                            if data and keywords:
                                avg_values = [0] * len(keywords)
                                for point in data:
                                    values = point.get("values", [])
                                    for i, v in enumerate(values):
                                        if i < len(avg_values):
                                            avg_values[i] += v
                                
                                avg_values = [v / len(data) if data else 0 for v in avg_values]
                                
                                gpts_index = -1
                                for i, kw in enumerate(keywords):
                                    if kw.lower() == BENCHMARK_KEYWORD:
                                        gpts_index = i
                                        break
                                
                                gpts_value = avg_values[gpts_index] if gpts_index >= 0 else 1
                                
                                for i, kw in enumerate(keywords):
                                    if kw.lower() != BENCHMARK_KEYWORD:
                                        ratio = avg_values[i] / gpts_value if gpts_value > 0 else 0
                                        all_results.append({
                                            "keyword": kw,
                                            "avg_value": round(avg_values[i], 2),
                                            "gpts_value": round(gpts_value, 2),
                                            "ratio": round(ratio, 2),
                                            "verdict": "✅ 通过" if ratio >= 1 else ("⚠️ 接近" if ratio >= 0.5 else "❌ 放弃")
                                        })
        
        # 进度条
        progress = int(idx / total * 50)
        print(f"\r  │{'█' * progress}{'░' * (50 - progress)}│ {idx}/{total}", end="", flush=True)
        
        # 每获取 5 个任务暂停一下
        if idx % 5 == 0:
            time.sleep(1)
    
    print(f"\n  └{'─' * 50}┘")
    
    if failed_ids:
        print(f"  ⚠️ {len(failed_ids)} 个任务获取失败")
    
    print(f"  ✓ 完成对比分析")
    
    return all_results


def display_comparison_results(results: list):
    """展示对比结果"""
    
    # 按比例排序
    sorted_results = sorted(results, key=lambda x: x["ratio"], reverse=True)
    
    print("\n" + "=" * 70)
    print("趋势对比结果（vs gpts）")
    print("=" * 70)
    
    passed = [r for r in sorted_results if "通过" in r["verdict"]]
    close = [r for r in sorted_results if "接近" in r["verdict"]]
    failed = [r for r in sorted_results if "放弃" in r["verdict"]]
    
    # ✅ 通过
    if passed:
        print(f"\n✅ 通过（热度 ≥ gpts）共 {len(passed)} 个")
        print("-" * 70)
        print(f"  {'关键词':<35} {'热度':>8} {'gpts':>8} {'倍数':>8}")
        print("-" * 70)
        for r in passed:
            print(f"  {r['keyword']:<35} {r['avg_value']:>8} {r['gpts_value']:>8} {r['ratio']:>7}x")
    
    # ⚠️ 接近
    if close:
        print(f"\n⚠️ 接近（热度 0.5-1x gpts）共 {len(close)} 个")
        print("-" * 70)
        for r in close:
            print(f"  {r['keyword']:<35} {r['avg_value']:>8} {r['gpts_value']:>8} {r['ratio']:>7}x")
    
    # ❌ 放弃
    if failed:
        print(f"\n❌ 放弃（热度 < 0.5x gpts）共 {len(failed)} 个")
        print("-" * 70)
        for r in failed[:10]:  # 只显示前 10 个
            print(f"  {r['keyword']:<35} {r['avg_value']:>8} {r['gpts_value']:>8} {r['ratio']:>7}x")
        if len(failed) > 10:
            print(f"  ... 还有 {len(failed) - 10} 个")
    
    print("\n" + "=" * 70)
    print("最终推荐")
    print("=" * 70)
    
    if passed:
        print("\n以下关键词值得进一步分析（SERP、KD、域名检查）：\n")
        for i, r in enumerate(passed, 1):
            print(f"  {i}. {r['keyword']} ({r['ratio']}x gpts)")
    else:
        print("\n本批次没有通过筛选的词，建议：")
        print("  1. 尝试其他词根")
        print("  2. 或从「接近」类别中挑选趋势上升的词")
    
    return sorted_results


# ============================================
# 用户输入处理
# ============================================
def get_keywords_from_input() -> list:
    """从用户输入获取词根列表"""
    
    default_keywords = [
        "calculator", "generator", "converter", "maker", "creator",
        "editor", "builder", "designer", "simulator", "translator"
    ]
    
    print("\n请输入词根（支持逗号/空格/换行分隔）")
    print("直接按回车使用默认词根")
    print("输入完成后，再按一次回车确认")
    print("-" * 40)
    
    lines = []
    while True:
        try:
            line = input()
            if line.strip() == "":
                break
            lines.append(line)
        except EOFError:
            break
    
    if not lines:
        print(f"\n使用默认词根（{len(default_keywords)} 个）")
        return default_keywords
    
    # 解析
    raw_text = " ".join(lines)
    raw_text = raw_text.replace(",", " ")
    raw_text = raw_text.replace("\n", " ")
    raw_text = re.sub(r'\s+', ' ', raw_text)
    
    keywords = [kw.strip() for kw in raw_text.split(" ") if kw.strip()]
    
    # 去重
    seen = set()
    unique_keywords = []
    for kw in keywords:
        if kw.lower() not in seen:
            seen.add(kw.lower())
            unique_keywords.append(kw)
    
    print(f"\n已解析 {len(unique_keywords)} 个词根")
    return unique_keywords


# ============================================
# 保存结果
# ============================================
def save_results(candidates: list, comparison: list, filename: str = "keyword_research_results.json"):
    """保存所有结果到 JSON"""
    
    output = {
        "generated_at": datetime.now().isoformat(),
        "date_range": f"{DATE_FROM} to {DATE_TO}",
        "candidates": candidates,
        "comparison": comparison
    }
    
    with open(filename, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    
    print(f"\n结果已保存到: {filename}")


# ============================================
# 主程序
# ============================================
def main():
    print("=" * 70)
    print("关键词研究自动化工具 v2.1（带缓存）")
    print("=" * 70)
    print(f"时间范围: {DATE_FROM} 至 {DATE_TO}")
    print(f"基准对比词: {BENCHMARK_KEYWORD}")
    print(f"缓存有效期: {CACHE_EXPIRY_HOURS} 小时")
    
    # 检查是否有可用缓存
    available_caches = list_available_caches()
    
    use_cache = False
    cached_data = None
    keywords = None
    
    if available_caches:
        print(f"\n发现 {len(available_caches)} 个缓存文件：")
        print("-" * 70)
        for i, cache in enumerate(available_caches[:5], 1):
            print(f"  {i}. {cache['filename']}")
            print(f"     时间: {cache['timestamp']}")
            print(f"     词根: {cache['keywords_count']} 个, 候选词: {cache['candidates_count']} 个")
        print("-" * 70)
        print("\n选项：")
        print("  - 输入数字（如 1）使用对应缓存")
        print("  - 输入 n 或直接回车，输入新词根")
        
        choice = input("\n请选择: ").strip().lower()
        
        if choice.isdigit() and 1 <= int(choice) <= len(available_caches):
            cache_info = available_caches[int(choice) - 1]
            with open(cache_info["filepath"], "r", encoding="utf-8") as f:
                cached_data = json.load(f)
            keywords = cached_data.get("keywords", [])
            use_cache = True
            print(f"\n✓ 使用缓存: {cache_info['filename']}")
    
    # 如果不使用缓存，获取新词根
    if not use_cache:
        keywords = get_keywords_from_input()
        
        # 检查这批词根是否有缓存
        cached_data = load_cache(keywords)
        
        if cached_data:
            print(f"\n发现今日缓存（{cached_data['timestamp'][:19]}）")
            print(f"包含 {len(cached_data['candidates'])} 个候选词")
            use_cached = input("使用缓存数据？(y/n，默认 y): ").strip().lower()
            
            if use_cached != "n":
                use_cache = True
                print("✓ 使用缓存数据，跳过 API 调用")
    
    # ==========================================
    # 第一步：词根扩展（或使用缓存）
    # ==========================================
    print("\n" + "=" * 70)
    print("第一步：词根扩展")
    print("=" * 70)
    
    if use_cache and cached_data:
        candidates = cached_data.get("candidates", [])
        print(f"  ✓ 从缓存加载 {len(candidates)} 个候选词（节省 API 成本！）")
    else:
        # 估算成本（每个词根 1 个任务才能获取相关查询词）
        step1_cost = len(keywords) * 0.05
        print(f"\n  ⚠️ 注意：获取相关查询词需要每个词根单独查询")
        print(f"  预计成本: ${step1_cost:.2f}（{len(keywords)} 个词根 × $0.05）")
        print(f"\n  💡 建议：先用 10-20 个核心词根测试，效果好再扩展")
        
        confirm = input("\n  开始执行？(y/n): ")
        if confirm.lower() != "y":
            print("已取消")
            return
        
        # 提交任务（每个词根 1 个任务）
        task_ids = submit_expansion_tasks(keywords)
        
        if not task_ids:
            print("任务创建失败，请检查 API 凭证")
            return
        
        completed_ids = wait_for_tasks(task_ids, "扩展任务")
        candidates = get_expansion_results(completed_ids)
        
        print(f"\n  共获取 {len(candidates)} 个候选词")
        
        # 保存到缓存
        save_cache(keywords, candidates)
    
    # ==========================================
    # 第二步：智能整理
    # ==========================================
    print("\n" + "=" * 70)
    print("第二步：智能整理")
    print("=" * 70)
    
    organized = organize_candidates(candidates)
    flat_list = display_candidates(organized)
    
    if not flat_list:
        print("没有找到有效的候选词")
        save_results(candidates, [], "keyword_research_results.json")
        return
    
    # ==========================================
    # 第三步：人工筛选
    # ==========================================
    print("\n" + "=" * 70)
    print("第三步：人工筛选")
    print("=" * 70)
    
    selected = user_selection(flat_list)
    
    if not selected:
        print("未选择任何词，保存当前结果后退出")
        save_results(candidates, [], "keyword_research_results.json")
        return
    
    # ==========================================
    # 第四步：趋势对比
    # ==========================================
    print("\n" + "=" * 70)
    print("第四步：趋势对比（vs gpts）")
    print("=" * 70)
    
    comparison_task_ids = submit_comparison_tasks(selected)
    
    if not comparison_task_ids:
        print("对比任务创建失败")
        save_results(candidates, [], "keyword_research_results.json")
        return
    
    completed_comparison_ids = wait_for_tasks(comparison_task_ids, "对比任务")
    comparison_results = get_comparison_results(completed_comparison_ids)
    
    # 展示结果
    final_results = display_comparison_results(comparison_results)
    
    # 保存结果
    save_results(candidates, final_results, "keyword_research_results.json")
    
    print("\n" + "=" * 70)
    print("完成！")
    print("=" * 70)


if __name__ == "__main__":
    main()
