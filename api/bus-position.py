import os
import sys
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.dirname(__file__))  # Vercel은 함수 디렉터리를 sys.path에 안 넣음
from _util import UpstreamError, fetch, send


def _int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            self._handle()
        except UpstreamError as e:
            send(self, {"error": "upstream", "detail": str(e)}, ttl=0, status=502)
        except Exception as e:  # 어떤 예외도 FUNCTION_INVOCATION_FAILED 대신 읽을 수 있는 응답으로
            send(self, {"error": "server", "detail": repr(e)}, ttl=0, status=500)

    def _handle(self):
        q = parse_qs(urlparse(self.path).query)
        route_id = q.get("routeId", [""])[0]  # 서울 busRouteId
        if not route_id:
            return send(self, {"error": "routeId required"}, ttl=0, status=400)

        items = fetch("buspos/getBusPosByRtid", {"busRouteId": route_id}, ttl=2)

        buses = [
            {
                "vehicleNo": it.get("plainNo") or it.get("vehId"),
                "vehId": it.get("vehId"),
                "lat": float(it["gpsY"]),
                "lng": float(it["gpsX"]),
                "sectOrd": _int(it.get("sectOrd")),  # 현재 구간 순번
                "dataTm": it.get("dataTm"),  # 위치 갱신시각 yyyyMMddHHmmss (KST) — 지연 보정용
                "lowFloor": it.get("busType") == "1",
                "congestion": _int(it.get("congetion")),  # API 스펙상 철자 그대로
            }
            for it in items
            if it.get("gpsX") not in (None, "", "0") and it.get("gpsY") not in (None, "", "0")
        ]
        send(self, {"routeId": route_id, "buses": buses}, ttl=2)

    def do_OPTIONS(self):
        send(self, {}, ttl=0)
