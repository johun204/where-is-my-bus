import json
import os
import time
import urllib.parse
import urllib.request

# ponytail: 람다 프로세스 메모리 캐시. 콜드스타트 시 비워짐 →
#           응답의 s-maxage 헤더로 Vercel CDN 캐시를 병행해 중복 호출을 한 번 더 막는다.
_cache: "dict[str, tuple[float, dict]]" = {}


def build_url(base: str, params: dict) -> str:
    p = {**params, "serviceKey": os.environ["DATA_GO_KR_KEY"], "_type": "json"}
    return base + "?" + urllib.parse.urlencode(p)


def cached_get(url: str, ttl: int = 10) -> dict:
    now = time.time()
    hit = _cache.get(url)
    if hit and hit[0] > now:  # ttl(기본 10초) 이내 재요청 → API 호출 없이 캐시 반환
        return hit[1]
    with urllib.request.urlopen(url, timeout=8) as r:
        data = json.loads(r.read().decode("utf-8"))
    _cache[url] = (now + ttl, data)
    return data


def items(raw: dict) -> list:
    try:
        node = raw["response"]["body"]["items"]["item"]
    except (KeyError, TypeError):
        return []
    return node if isinstance(node, list) else [node]


def send(handler, payload: dict, ttl: int = 10, status: int = 200) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", f"s-maxage={ttl}, stale-while-revalidate=30")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.end_headers()
    handler.wfile.write(body)
