import os
import sys
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.dirname(__file__))  # Vercel은 함수 디렉터리를 sys.path에 안 넣음
from _util import UpstreamError, fetch, send

# 서울특별시_정류소정보조회 서비스 — 좌표 반경 내 정류장 (stationinfo/getStationByPos)
OP = "stationinfo/getStationByPos"


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
        lat = q.get("lat", [""])[0]
        lng = q.get("lng", [""])[0]
        if not lat or not lng:
            return send(self, {"error": "lat/lng required"}, ttl=0, status=400)
        try:
            radius = min(1000, max(100, int(float(q.get("radius", ["500"])[0]))))
        except ValueError:
            radius = 500

        items = fetch(OP, {"tmX": lng, "tmY": lat, "radius": radius}, ttl=20)

        out = {}
        for it in items:
            ars = it.get("arsId")
            x, y = it.get("gpsX"), it.get("gpsY")
            if not ars or ars == "0" or not x or not y:
                continue
            out[ars] = {
                "arsId": ars,
                "name": it.get("stationNm") or it.get("stNm"),
                "lat": float(y),
                "lng": float(x),
            }
        send(self, {"stops": list(out.values())}, ttl=20)

    def do_OPTIONS(self):
        send(self, {}, ttl=0)
