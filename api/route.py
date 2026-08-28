from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

from _util import build_url, cached_get, items, send

# 국토교통부(TAGO) 버스노선정보 서비스
# ※ 엔드포인트/파라미터명은 발급받은 API 문서 기준으로 최종 확인할 것.
SVC = "http://apis.data.go.kr/1613000/BusRouteInfoInqireService"


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        q = parse_qs(urlparse(self.path).query)
        city = q.get("cityCode", ["25"])[0]
        route_no = q.get("routeNo", [""])[0]
        route_id = q.get("routeId", [""])[0]

        if route_no:  # 노선 번호 검색
            url = build_url(
                SVC + "/getRouteNoList",
                {"cityCode": city, "routeNo": route_no, "numOfRows": 50},
            )
            results = [
                {
                    "routeId": it["routeid"],
                    "routeNo": it["routeno"],
                    "routeTp": it.get("routetp"),
                    "cityCode": city,
                }
                for it in items(cached_get(url, ttl=600))
            ]
            return send(self, {"results": results}, ttl=600)

        if route_id:  # 경유정류소 목록 = Polyline 경로 + 정류장 점마커
            url = build_url(
                SVC + "/getRouteAcctoThrghSttnList",
                {"cityCode": city, "routeId": route_id, "numOfRows": 500},
            )
            stops = sorted(
                (
                    {
                        "ord": int(it["nodeord"]),
                        "name": it.get("nodenm"),
                        "lat": float(it["gpslati"]),
                        "lng": float(it["gpslong"]),
                    }
                    for it in items(cached_get(url, ttl=86400))
                    if it.get("gpslati") and it.get("gpslong")
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
