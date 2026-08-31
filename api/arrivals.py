import os
import sys
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.dirname(__file__))  # Vercel은 함수 디렉터리를 sys.path에 안 넣음
from _util import UpstreamError, fetch, send

# 서울특별시_정류소정보조회 서비스 — arsId 로 그 정류장에 도착 예정인 모든 노선 조회
OP = "stationinfo/getStationByUid"


def _int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _leg(it, n):
    msg = (it.get(f"arrmsg{n}") or "").strip()
    if not msg:
        return None
    return {
        "msg": msg,
        "sec": _int(it.get(f"traTime{n}")),
        "vehicleNo": (it.get(f"plainNo{n}") or "").strip() or None,
        "lowFloor": it.get(f"busType{n}") == "1",
        "last": it.get(f"isLast{n}") == "1",
    }


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            self._handle()
        except UpstreamError as e:
            send(self, {"error": "upstream", "detail": str(e)}, ttl=0, status=502)
        except Exception as e:
            send(self, {"error": "server", "detail": repr(e)}, ttl=0, status=500)

    def _handle(self):
        q = parse_qs(urlparse(self.path).query)
        ars = q.get("arsId", [""])[0]
        if not ars:
            return send(self, {"error": "arsId required"}, ttl=0, status=400)

        items = fetch(OP, {"arsId": ars}, ttl=10)
        stop_name = items[0].get("stNm") if items else None

        arrivals = [
            {
                "routeNo": it.get("rtNm"),
                "routeId": it.get("busRouteId"),
                "routeType": it.get("routeType") or it.get("busRouteType"),
                "dir": it.get("adirection") or it.get("nxtStn") or None,
                "arr1": _leg(it, 1),
                "arr2": _leg(it, 2),
            }
            for it in items
            if it.get("rtNm")
        ]
        arrivals.sort(
            key=lambda a: (
                a["arr1"]["sec"]
                if a.get("arr1") and a["arr1"].get("sec") is not None
                else 10**9
            )
        )
        send(self, {"arsId": ars, "stopName": stop_name, "arrivals": arrivals}, ttl=10)

    def do_OPTIONS(self):
        send(self, {}, ttl=0)
