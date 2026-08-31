import { useCallback, useEffect, useRef, useState } from 'react';
import { ErrorBoundary } from './ErrorBoundary';
import { useFavoriteRoutes } from './hooks/useFavoriteRoutes';
import { RouteLayer } from './map/RouteLayer';
import { routeTypeColor } from './map/routeColor';
import { useMyLocation } from './map/useMyLocation';

const FALLBACK = { lat: 37.5665, lng: 126.978 }; // 서울시청 (위치 권한 거부 시)

const seen = (k) => {
  try {
    return !!localStorage.getItem(`busmap.onboard.${k}`);
  } catch {
    return true;
  }
};
const markSeen = (k) => {
  try {
    localStorage.setItem(`busmap.onboard.${k}`, '1');
  } catch {
    /* ignore */
  }
};

const CONGESTION = { 3: '여유', 4: '보통', 5: '혼잡', 6: '매우 혼잡' };
const agoText = (dataTm) => {
  if (!/^\d{14}$/.test(dataTm || '')) return null;
  const s = dataTm;
  const epoch = Date.UTC(
    +s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8),
    +s.slice(8, 10) - 9, +s.slice(10, 12), +s.slice(12, 14),
  );
  const sec = Math.round((Date.now() - epoch) / 1000);
  if (sec < 0 || sec > 3600) return null;
  return sec < 60 ? `${sec}초 전` : `${Math.floor(sec / 60)}분 전`;
};
const etaText = (t) => {
  if (t == null || t < 0) return null;
  return t < 60 ? `${t}초` : `약 ${Math.round(t / 60)}분`;
};

export default function App() {
  const mapEl = useRef(null);
  const rotEl = useRef(null); // 회전 래퍼 (--map-rot CSS 변수 소유)
  const stageEl = useRef(null);
  const mapRotRef = useRef(0);
  const rotSrcRef = useRef('none'); // 'follow' | 'manual' — 회전 값의 출처
  const prevFollowRef = useRef(false);
  const followRef = useRef(false);

  const [map, setMap] = useState(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [installEvt, setInstallEvt] = useState(null);
  const [coach, setCoach] = useState(() => (seen('search') ? null : 'search'));
  const [popup, setPopup] = useState(null); // 마커 클릭 시 버스 정보
  const [tracked, setTracked] = useState(null); // { routeId, vehicleNo, routeNo } | null
  const prevFavCount = useRef(0);
  const { favorites, has, toggle, toggleEnabled } = useFavoriteRoutes();

  const onBusClick = useCallback((info) => {
    setResults(null);
    setPopup(info);
  }, []);

  // 처음 노선을 추가하면 칩(껐다 켜기) 안내
  useEffect(() => {
    const was = prevFavCount.current;
    prevFavCount.current = favorites.length;
    if (was === 0 && favorites.length > 0 && !seen('chip')) {
      setCoach('chip');
      const t = setTimeout(() => {
        markSeen('chip');
        setCoach((c) => (c === 'chip' ? null : c));
      }, 8000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [favorites.length]);

  const dismissCoach = () => {
    setCoach((c) => {
      if (c) markSeen(c);
      return null;
    });
  };

  const applyRot = useCallback((deg, src) => {
    rotSrcRef.current = src;
    mapRotRef.current = deg;
    rotEl.current?.style.setProperty('--map-rot', `${deg}deg`);
  }, []);

  // 추적 모드: 바라보는 방향이 항상 지도 12시가 되도록 지도를 -heading 만큼 회전
  const onHeading = useCallback(
    (deg) => applyRot(-deg, 'follow'),
    [applyRot],
  );

  const { follow, onFab, exitFollow } = useMyLocation(map, onHeading);

  useEffect(() => {
    window.kakao.maps.load(() => {
      const m = new window.kakao.maps.Map(mapEl.current, {
        center: new window.kakao.maps.LatLng(FALLBACK.lat, FALLBACK.lng),
        level: 4,
      });
      window.kakao.maps.event.addListener(m, 'click', () => {
        setResults(null);
        setPopup(null);
      });
      setMap(m);
    });
  }, []);

  useEffect(() => {
    followRef.current = follow;
  }, [follow]);

  // 버스 위치 트래킹 중 지도를 직접 드래그하면 해제
  useEffect(() => {
    if (!map || !tracked) return undefined;
    const { kakao } = window;
    const release = () => setTracked(null);
    kakao.maps.event.addListener(map, 'dragstart', release);
    return () => kakao.maps.event.removeListener(map, 'dragstart', release);
  }, [map, tracked]);

  const startTrack = (info) => {
    exitFollow(); // 내 위치 추적과 상호 배타
    setTracked({ routeId: info.routeId, vehicleNo: info.vehicleNo, routeNo: info.routeNo });
    setPopup(null);
  };

  const handleFab = () => {
    setTracked(null);
    onFab();
  };

  // 추적 해제 시(드래그/줌 등) 정북으로 복귀 — 단, 사용자가 직접 돌린 각도는 유지
  useEffect(() => {
    if (prevFollowRef.current && !follow && rotSrcRef.current === 'follow') {
      applyRot(0, 'follow');
    }
    prevFollowRef.current = follow;
  }, [follow, applyRot]);

  // 두 손가락 비틀기 = 회전 / 회전된 상태의 한 손가락 이동 = 화면 기준으로 팬(카카오 대체)
  useEffect(() => {
    const stage = stageEl.current;
    if (!stage || !map) return undefined;
    const { kakao } = window;
    const ang = (t) =>
      (Math.atan2(t[1].clientY - t[0].clientY, t[1].clientX - t[0].clientX) * 180) /
      Math.PI;
    const dist = (t) =>
      Math.hypot(t[1].clientX - t[0].clientX, t[1].clientY - t[0].clientY);
    const rotAmount = () => {
      const m = ((mapRotRef.current % 360) + 360) % 360;
      return m > 0.5 && m < 359.5 ? m : 0; // 정북이면 0 (카카오 기본 팬 사용)
    };
    let g = null; // 2손가락 제스처
    let pan = null; // 회전 상태 1손가락 팬

    const onStart = (e) => {
      if (e.touches.length === 1 && followRef.current) {
        // 추적 모드에서 손 대는 즉시 해제 + 전환 없이 정북 복귀
        exitFollow();
        const el = rotEl.current;
        if (el) {
          el.style.transition = 'none';
          applyRot(0, 'follow');
          void el.offsetWidth;
          el.style.transition = '';
        }
        return;
      }
      if (e.touches.length === 1 && rotAmount() !== 0) {
        pan = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        return;
      }
      if (e.touches.length === 2) {
        pan = null;
        g = {
          a0: ang(e.touches),
          d0: dist(e.touches),
          r0: mapRotRef.current,
          lvl0: map.getLevel(),
          mode: null,
        };
      }
    };

    // 화면 좌표 → 지도 div 컨테이너 좌표 (회전 보정). 핀치 앵커 계산용.
    const screenToContainer = (sx, sy) => {
      const r = stage.getBoundingClientRect();
      const ox = sx - (r.left + r.width / 2);
      const oy = sy - (r.top + r.height / 2);
      const rad = (-mapRotRef.current * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const proj = map.getProjection();
      const cd = proj.containerPointFromCoords(map.getCenter());
      return new kakao.maps.Point(cd.x + ox * cos - oy * sin, cd.y + ox * sin + oy * cos);
    };

    const onMove = (e) => {
      // 회전된 지도의 한 손가락 팬: 화면 델타를 -회전각으로 되돌려 카카오 좌표로 이동
      if (pan && e.touches.length === 1) {
        const rot = rotAmount();
        if (rot === 0) {
          pan = null;
          return;
        }
        setTracked(null); // 직접 이동 → 트래킹 해제
        e.stopPropagation();
        e.preventDefault();
        const t = e.touches[0];
        const dx = t.clientX - pan.x;
        const dy = t.clientY - pan.y;
        pan.x = t.clientX;
        pan.y = t.clientY;
        const rad = (-rot * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const mdx = dx * cos - dy * sin; // 스크린 델타 → 지도 div 델타
        const mdy = dx * sin + dy * cos;
        const proj = map.getProjection();
        const c = proj.containerPointFromCoords(map.getCenter());
        map.setCenter(
          proj.coordsFromContainerPoint(new kakao.maps.Point(c.x - mdx, c.y - mdy)),
        );
        return;
      }

      if (!g || e.touches.length !== 2) return;
      let da = ang(e.touches) - g.a0;
      da = ((da + 540) % 360) - 180;
      const scale = dist(e.touches) / g.d0;
      if (!g.mode) {
        if (Math.abs(da) > 10 && Math.abs(scale - 1) < 0.2) g.mode = 'rotate';
        else if (Math.abs(scale - 1) > 0.15) g.mode = 'zoom';
      }

      if (g.mode === 'rotate') {
        e.stopPropagation();
        e.preventDefault();
        let r = g.r0 + da;
        const m = ((r % 360) + 360) % 360;
        if (m < 4 || m > 356) r = Math.round(r / 360) * 360; // 정북 근처 스냅
        applyRot(r, 'manual');
        exitFollow();
        setTracked(null); // tilt → 트래킹 해제
        return;
      }

      if (g.mode === 'zoom') {
        if (rotAmount() === 0) return; // 정북이면 카카오 기본 핀치줌 사용
        e.stopPropagation();
        e.preventDefault();
        const target = Math.max(1, Math.min(13, Math.round(g.lvl0 - Math.log2(scale))));
        if (target !== map.getLevel()) {
          const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
          const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
          const anchor = map
            .getProjection()
            .coordsFromContainerPoint(screenToContainer(mx, my));
          map.setLevel(target, { anchor });
          g.lvl0 = target; // 재기준 (누적 오차 방지)
          g.d0 = dist(e.touches);
        }
      }
    };

    const onEnd = (e) => {
      if (e.touches.length < 1) pan = null;
      if (e.touches.length < 2) g = null;
    };

    stage.addEventListener('touchstart', onStart, { capture: true, passive: false });
    stage.addEventListener('touchmove', onMove, { capture: true, passive: false });
    stage.addEventListener('touchend', onEnd, { capture: true });
    stage.addEventListener('touchcancel', onEnd, { capture: true });
    return () => {
      stage.removeEventListener('touchstart', onStart, true);
      stage.removeEventListener('touchmove', onMove, true);
      stage.removeEventListener('touchend', onEnd, true);
      stage.removeEventListener('touchcancel', onEnd, true);
    };
  }, [map, applyRot, exitFollow]);

  // PWA 설치 프롬프트 캡처
  useEffect(() => {
    const onPrompt = (e) => {
      e.preventDefault();
      setInstallEvt(e);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  async function search(e) {
    e.preventDefault();
    if (coach === 'search') dismissCoach();
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    try {
      const r = await fetch(`/api/route?routeNo=${encodeURIComponent(q)}`);
      const d = await r.json();
      setResults(Array.isArray(d.results) ? d.results : []);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  async function install() {
    if (!installEvt) return;
    installEvt.prompt();
    await installEvt.userChoice;
    setInstallEvt(null);
  }

  return (
    <div className="app">
      <div className="map-stage" ref={stageEl}>
        <div className="map-rot" ref={rotEl}>
          <div ref={mapEl} className="map" />
        </div>
      </div>

      <div className="topbar">
        {tracked && (
          <div className="trackbar">
            <span>
              <b>{tracked.routeNo}</b> {tracked.vehicleNo} 따라가는 중
            </span>
            <button type="button" onClick={() => setTracked(null)}>
              해제
            </button>
          </div>
        )}

        <form className="search" onSubmit={search}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="버스 번호 검색 (예: 273, 마포06)"
          />
          <button type="submit" disabled={searching}>
            {searching ? '…' : '검색'}
          </button>
          {installEvt && (
            <button type="button" className="install" onClick={install}>
              설치
            </button>
          )}
        </form>

        {coach === 'search' && (
          <button type="button" className="coach" onClick={dismissCoach}>
            버스 번호로 검색해 노선을 추가하세요 · 예: 273, 마포06
          </button>
        )}

        {results && (
          <ul className="results">
            {results.length === 0 && <li className="empty">검색 결과 없음</li>}
            {results.map((r) => (
              <li
                key={r.routeId}
                className={has(r.routeId) ? 'is-added' : ''}
                onClick={() => {
                  if (!has(r.routeId)) toggle(r);
                  setResults(null);
                }}
              >
                <span className="dot" style={{ background: routeTypeColor(r.routeTp) }} />
                <span className="no">{r.routeNo}</span>
                <span className="ends">
                  {r.start} ↔ {r.end}
                </span>
                <span className="mark">{has(r.routeId) ? '추가됨' : '추가'}</span>
              </li>
            ))}
          </ul>
        )}

        {favorites.length > 0 && (
          <div className="faves">
            {favorites.map((r) => {
              const off = r.enabled === false;
              return (
                <span
                  key={r.routeId}
                  className={`chip${off ? ' chip--off' : ''}`}
                  style={{ borderColor: off ? '#c2c2c2' : routeTypeColor(r.routeTp) }}
                >
                  <button
                    className="chip__no"
                    onClick={() => toggleEnabled(r.routeId)}
                    aria-pressed={!off}
                    title={off ? '지도에 표시' : '지도에서 숨기기'}
                  >
                    {r.routeNo}
                  </button>
                  <button className="chip__x" onClick={() => toggle(r)} aria-label="삭제">
                    ×
                  </button>
                </span>
              );
            })}
          </div>
        )}

        {coach === 'chip' && (
          <button type="button" className="coach" onClick={dismissCoach}>
            노선 번호를 탭하면 지도에서 껐다 켤 수 있어요 · × 는 삭제
          </button>
        )}
      </div>

      <button
        className={`fab${follow ? ' fab--follow' : ''}`}
        onClick={handleFab}
        aria-label="현재 위치"
      >
        ◎
      </button>

      {popup && (
        <div className="buspop">
          <button className="buspop__x" onClick={() => setPopup(null)} aria-label="닫기">
            ×
          </button>
          <div className="buspop__head">
            <span
              className="buspop__badge"
              style={{ background: routeTypeColor(popup.routeTp) }}
            >
              {popup.routeNo}
            </span>
            <span className="buspop__veh">{popup.vehicleNo}</span>
            {popup.lowFloor && <span className="buspop__tag">저상</span>}
          </div>
          <dl className="buspop__info">
            {popup.nextStopName && (
              <>
                <dt>다음 정류장</dt>
                <dd>
                  {popup.nextStopName}
                  {etaText(popup.nextStTm) ? ` · ${etaText(popup.nextStTm)}` : ''}
                </dd>
              </>
            )}
            <dt>혼잡도</dt>
            <dd>{CONGESTION[popup.congestion] || '정보 없음'}</dd>
            {popup.stopFlag === 1 && (
              <>
                <dt>상태</dt>
                <dd>정류장 정차 중</dd>
              </>
            )}
            {agoText(popup.dataTm) && (
              <>
                <dt>위치 기준</dt>
                <dd>{agoText(popup.dataTm)}</dd>
              </>
            )}
          </dl>
          <button className="buspop__track" onClick={() => startTrack(popup)}>
            이 버스 위치 트래킹
          </button>
        </div>
      )}

      {map &&
        favorites
          .filter((r) => r.enabled !== false)
          .map((r) => (
            <ErrorBoundary key={r.routeId} fallback={null}>
              <RouteLayer
                map={map}
                route={r}
                onBusClick={onBusClick}
                trackedVehicleNo={
                  tracked && tracked.routeId === r.routeId ? tracked.vehicleNo : null
                }
              />
            </ErrorBoundary>
          ))}
    </div>
  );
}
