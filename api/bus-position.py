from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

from _util import UpstreamError, build_url, cached_get, items, send

# 국토교통부(TAGO) 버스위치정보 - 노선별 실시간 버스위치 목록
BASE = "http://apis.data.go.kr/1613000/BusLcInfoInqireService/getRouteAcctoBusLcList"


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        q = parse_qs(urlparse(self.path).query)
        route_id = q.get("routeId", [""])[0]
        city = q.get("cityCode", ["25"])[0]  # 서울

        if not route_id:
            return send(self, {"error": "routeId required"}, ttl=0, status=400)

        url = build_url(BASE, {"cityCode": city, "routeId": route_id, "numOfRows": 200})
        try:
            raw = cached_get(url, ttl=10)
        except UpstreamError as e:
            return send(self, {"error": "upstream", "detail": str(e)}, ttl=0, status=502)

        buses = [
            {
                "vehicleNo": it.get("vehicleno"),
                "lat": float(it["gpslati"]),
                "lng": float(it["gpslong"]),
                "stopOrd": it.get("nodeord"),
                "lowFloor": str(it.get("lowplate")) == "1",
            }
            for it in items(raw)
            if it.get("gpslati") and it.get("gpslong")
        ]
        send(self, {"routeId": route_id, "buses": buses}, ttl=10)

    def do_OPTIONS(self):
        send(self, {}, ttl=0)
