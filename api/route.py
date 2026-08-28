from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

from _util import UpstreamError, fetch, send


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            self._handle()
        except UpstreamError as e:
            send(self, {"error": "upstream", "detail": str(e)}, ttl=0, status=502)

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

        if route_id:  # 경유정류소 목록 = Polyline 경로 + 정류장 점마커
            items = fetch(
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
                    for it in items
                    if it.get("gpsX") not in (None, "", "0")
                    and it.get("gpsY") not in (None, "", "0")
                    and it.get("seq")
                ),
                key=lambda s: s["ord"],
            )
            return send(
                self,
                {
                    "routeId": route_id,
                    "stops": stops,
                    "path": [[s["lng"], s["lat"]] for s in stops],  # [lng, lat]
                },
                ttl=86400,
            )

        send(self, {"error": "routeNo or routeId required"}, ttl=0, status=400)

    def do_OPTIONS(self):
        send(self, {}, ttl=0)
