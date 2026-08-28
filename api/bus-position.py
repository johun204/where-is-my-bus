from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

from _util import UpstreamError, fetch, send


def _int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        q = parse_qs(urlparse(self.path).query)
        route_id = q.get("routeId", [""])[0]  # 서울 busRouteId
        if not route_id:
            return send(self, {"error": "routeId required"}, ttl=0, status=400)

        try:
            items = fetch("buspos/getBusPosByRtid", {"busRouteId": route_id}, ttl=10)
        except UpstreamError as e:
            return send(self, {"error": "upstream", "detail": str(e)}, ttl=0, status=502)

        buses = [
            {
                "vehicleNo": it.get("plainNo") or it.get("vehId"),
                "vehId": it.get("vehId"),
                "lat": float(it["gpsY"]),
                "lng": float(it["gpsX"]),
                "sectOrd": _int(it.get("sectOrd")),  # 현재 구간 순번
                "lowFloor": it.get("busType") == "1",
                "congestion": _int(it.get("congetion")),  # API 스펙상 철자 그대로
            }
            for it in items
            if it.get("gpsX") not in (None, "", "0") and it.get("gpsY") not in (None, "", "0")
        ]
        send(self, {"routeId": route_id, "buses": buses}, ttl=10)

    def do_OPTIONS(self):
        send(self, {}, ttl=0)
