import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

# 서울시 버스운행정보(TOPIS) 공유서비스. 공공데이터포털에서 아래 두 서비스를 각각 활용신청:
#   - 서울특별시_버스위치정보조회 서비스 (buspos/*)
#   - 서울특별시_노선정보조회 서비스   (busRouteInfo/*)
BASE = "http://ws.bus.go.kr/api/rest"

# ponytail: 람다 프로세스 메모리 캐시. 콜드스타트 시 비워짐 →
#           응답의 s-maxage 헤더로 Vercel CDN 캐시를 병행해 중복 호출을 한 번 더 막는다.
_cache: "dict[str, tuple[float, list]]" = {}


class UpstreamError(Exception):
    """서울시 버스 API 호출 실패 (인증키 미등록, 트래픽 초과, 응답 형식 이상 등)."""


def fetch(path: str, params: dict, ttl: int = 10) -> list:
    """ws.bus.go.kr REST 호출 → <itemList> 목록을 dict 리스트로. ttl 이내 재요청은 캐시."""
    raw_key = os.environ.get("DATA_GO_KR_KEY")
    if not raw_key:
        raise UpstreamError("DATA_GO_KR_KEY 환경변수가 설정되지 않았습니다 (Vercel Project Settings → Environment Variables)")
    key = urllib.parse.unquote(raw_key)  # Encoding/Decoding 키 모두 허용
    qs = urllib.parse.urlencode({**params, "serviceKey": key})
    url = f"{BASE}/{path}?{qs}"

    now = time.time()
    hit = _cache.get(url)
    if hit and hit[0] > now:
        return hit[1]

    try:
        with urllib.request.urlopen(url, timeout=8) as r:
            body = r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = e.read().decode("utf-8", "replace")[:300]
        except Exception:
            pass
        raise UpstreamError(f"HTTP {e.code}: {detail or e.reason}") from e
    except (urllib.error.URLError, TimeoutError) as e:
        raise UpstreamError(str(e)) from e

    items = _parse(body)
    _cache[url] = (now + ttl, items)
    return items


def _parse(body: str) -> list:
    text = body.lstrip()
    if text.startswith("{"):  # 미등록 키 등은 JSON 에러로 옴
        try:
            j = json.loads(text)
        except ValueError:
            raise UpstreamError(text[:200])
        raise UpstreamError(j.get("message") or j.get("msg") or text[:200])

    try:
        root = ET.fromstring(body)
    except ET.ParseError as e:
        raise UpstreamError(f"XML parse: {e}; body={text[:200]}")

    def find(name):  # 네임스페이스 무시
        for el in root.iter():
            if el.tag.rsplit("}", 1)[-1] == name:
                return el.text
        return None

    cd = find("headerCd")
    if cd not in (None, "0"):
        msg = find("headerMsg") or ""
        if cd == "4" or "결과가 없" in msg:  # 조건에 맞는 데이터 없음 = 정상 빈 응답
            return []
        raise UpstreamError(msg or f"headerCd={cd}")
    rc = find("returnReasonCode")
    if rc not in (None, "00"):
        raise UpstreamError(find("returnAuthMsg") or f"reasonCode={rc}")

    items = []
    for el in root.iter():
        if el.tag.rsplit("}", 1)[-1] == "itemList":
            items.append(
                {c.tag.rsplit("}", 1)[-1]: (c.text or "") for c in el}
            )
    return items


def send(handler, payload: dict, ttl: int = 10, status: int = 200) -> None:
    out = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    # ttl>0: 엣지에서 ttl초 신선 + ttl초 stale 허용. ttl<=0(에러 등): 캐시 안 함.
    cache = f"s-maxage={ttl}, stale-while-revalidate={ttl}" if ttl > 0 else "no-store"
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", cache)
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.end_headers()
    handler.wfile.write(out)
