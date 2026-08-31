"""로컬 개발 전용 API 러너.

`python api/_local.py` → 127.0.0.1:8000 에서 /api/* 제공.
Vercel 배포와 무관(파일명이 _ 로 시작해 라우팅에서 제외됨). `vercel dev`(로그인 필요)
없이 프론트의 /api 프록시 대상만 띄우기 위한 것.
"""
import importlib.util
import os
import pathlib
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))  # 각 핸들러의 `from _util import ...` 해석용

# 로컬 편의: 프로젝트 루트 .env 를 읽어 환경변수로 (Vercel 은 대시보드 변수 사용)
_envfile = HERE.parent / ".env"
if _envfile.exists():
    for _line in _envfile.read_text(encoding="utf-8").splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip())


def _load_handler(filename):
    spec = importlib.util.spec_from_file_location(
        filename.replace("-", "_"), HERE / f"{filename}.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.handler


# api/*.py 중 _ 로 시작하지 않는 파일 전부를 /api/<이름> 으로 (Vercel 라우팅과 동일)
ROUTES = {
    f"/api/{p.stem}": _load_handler(p.stem)
    for p in sorted(HERE.glob("*.py"))
    if not p.stem.startswith("_")
}


class Dispatch(BaseHTTPRequestHandler):
    def _delegate(self, method):
        target = ROUTES.get(self.path.split("?", 1)[0])
        if target is None:
            self.send_response(404)
            self.end_headers()
            return
        # 대상 핸들러가 정의한 메서드(do_GET, _handle 등)를 이 인스턴스에 바인딩.
        # Vercel 런타임은 핸들러 클래스를 정상 인스턴스화하므로 이 처리는 로컬 전용.
        for name, fn in vars(target).items():
            if callable(fn) and not name.startswith("__"):
                setattr(self, name, fn.__get__(self))
        getattr(self, method)()

    def do_GET(self):
        self._delegate("do_GET")

    def do_OPTIONS(self):
        self._delegate("do_OPTIONS")


if __name__ == "__main__":
    print("local API → http://localhost:8000  routes: " + ", ".join(ROUTES))
    ThreadingHTTPServer(("127.0.0.1", 8000), Dispatch).serve_forever()
