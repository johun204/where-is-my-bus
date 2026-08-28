"""_util._parse 자체 검증 — 프레임워크 없이: python api/_util_test.py"""
import _util

OK_XML = """<?xml version="1.0" encoding="UTF-8"?>
<ServiceResult>
  <msgHeader><headerCd>0</headerCd><headerMsg>정상</headerMsg></msgHeader>
  <msgBody>
    <itemList><gpsX>127.1</gpsX><gpsY>37.5</gpsY><plainNo>서울70사1234</plainNo><sectOrd>12</sectOrd></itemList>
    <itemList><gpsX>127.2</gpsX><gpsY>37.6</gpsY><plainNo>서울70사5678</plainNo><sectOrd>20</sectOrd></itemList>
  </msgBody>
</ServiceResult>"""

ERR_XML = """<ServiceResult><msgHeader><headerCd>7</headerCd>
<headerMsg>인증키가 유효하지 않습니다</headerMsg></msgHeader></ServiceResult>"""

items = _util._parse(OK_XML)
assert len(items) == 2, items
assert items[0]["gpsX"] == "127.1" and items[0]["plainNo"] == "서울70사1234", items[0]
assert items[1]["sectOrd"] == "20", items[1]

for bad in (ERR_XML, '{"error":"Unauthorized","message":"등록되지 않은 서비스키"}'):
    try:
        _util._parse(bad)
        raise AssertionError("should have raised UpstreamError")
    except _util.UpstreamError:
        pass

print("_util._parse OK")
