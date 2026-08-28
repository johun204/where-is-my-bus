import os
import sys
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.dirname(__file__))  # Vercel은 함수 디렉터리를 sys.path에 안 넣음
from _util import UpstreamError, fetch, send


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
        route_no = q.get("routeNo", [""])[0]
        route_id = q.get("routeId", [""])[0]

        if route_no:  # 노선 번호/명 검색
            items = fetch(
                "busRouteInfo/getBusRouteList", {"strSrch": route_no}, ttl=600
            )
            results = [
                {
                    "routeId": it["busRouteId"],
                    "routeNo": it["busRouteNm"],
                    "routeTp": it.get("routeType"),
                    "start": it.get("stStationNm"),
                    "end": it.get("edStationNm"),
                }
                for it in items
                if it.get("busRouteId")
            ]
            return send(self, {"results": results}, ttl=600)

        if route_id:  # 정류장 점마커(getStaionByRoute) + 도로 형상 Polyline(getRoutePath)
            stop_items = fetch(
                "busRouteInfo/getStaionByRoute", {"busRouteId": route_id}, ttl=86400
            )
            stops = sorted(
                (
                    {
                        "ord": int(it["seq"]),
                        "name": it.get("stationNm"),
                        "arsId": it.get("arsId"),
                        "lat": float(it["gpsY"]),
                        "lng": float(it["gpsX"]),
                    }
                    for it in stop_items
                    if it.get("gpsX") not in (None, "", "0")
                    and it.get("gpsY") not in (None, "", "0")
                    and it.get("seq")
                ),
                key=lambda s: s["ord"],
            )

            # 도로를 따라가는 실제 노선 형상. 실패하면 정류장 잇기로 폴백.
            try:
                shape = fetch(
                    "busRouteInfo/getRoutePath", {"busRouteId": route_id}, ttl=86400
                )
                path = [
                    [float(it["gpsX"]), float(it["gpsY"])]
                    for it in sorted(shape, key=lambda it: int(it.get("no") or 0))
                    if it.get("gpsX") not in (None, "", "0")
                    and it.get("gpsY") not in (None, "", "0")
                ]
            except UpstreamError:
                path = []
            if not path:
                path = [[s["lng"], s["lat"]] for s in stops]

            return send(
                self,
                {"routeId": route_id, "stops": stops, "path": path},  # path: [lng, lat]
                ttl=86400,
            )

        send(self, {"error": "routeNo or routeId required"}, ttl=0, status=400)

    def do_OPTIONS(self):
        send(self, {}, ttl=0)
