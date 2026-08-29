import { useCallback, useEffect, useRef, useState } from 'react';
import { ErrorBoundary } from './ErrorBoundary';
import { useFavoriteRoutes } from './hooks/useFavoriteRoutes';
import { RouteLayer } from './map/RouteLayer';
import { routeTypeColor } from './map/routeColor';
import { useMyLocation } from './map/useMyLocation';

const FALLBACK = { lat: 37.5665, lng: 126.978 }; // 서울시청 (위치 권한 거부 시)

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
  const { favorites, has, toggle, toggleEnabled } = useFavoriteRoutes();

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
      setMap(
        new window.kakao.maps.Map(mapEl.current, {
          center: new window.kakao.maps.LatLng(FALLBACK.lat, FALLBACK.lng),
          level: 4,
        }),
      );
    });
  }, []);

  useEffect(() => {
    followRef.current = follow;
  }, [follow]);

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
        g = { a0: ang(e.touches), d0: dist(e.touches), r0: mapRotRef.current, mode: null };
      }
    };

    const onMove = (e) => {
      // 회전된 지도의 한 손가락 팬: 화면 델타를 -회전각으로 되돌려 카카오 좌표로 이동
      if (pan && e.touches.length === 1) {
        const rot = rotAmount();
        if (rot === 0) {
          pan = null;
          return;
        }
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
        else if (Math.abs(scale - 1) > 0.15) g.mode = 'zoom'; // 카카오 핀치줌에 양보
      }
      if (g.mode !== 'rotate') return;
      e.stopPropagation();
      e.preventDefault();
      let r = g.r0 + da;
      const m = ((r % 360) + 360) % 360;
      if (m < 4 || m > 356) r = Math.round(r / 360) * 360; // 정북 근처 스냅
      applyRot(r, 'manual');
      exitFollow();
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

        {results && (
          <ul className="results">
            {results.length === 0 && <li className="empty">검색 결과 없음</li>}
            {results.map((r) => (
              <li key={r.routeId}>
                <span className="dot" style={{ background: routeTypeColor(r.routeTp) }} />
                <span className="no">{r.routeNo}</span>
                <span className="ends">
                  {r.start} ↔ {r.end}
                </span>
                <button onClick={() => toggle(r)}>{has(r.routeId) ? '삭제' : '추가'}</button>
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
      </div>

      <button
        className={`fab${follow ? ' fab--follow' : ''}`}
        onClick={onFab}
        aria-label="현재 위치"
      >
        ◎
      </button>

      {map &&
        favorites
          .filter((r) => r.enabled !== false)
          .map((r) => (
            <ErrorBoundary key={r.routeId} fallback={null}>
              <RouteLayer map={map} route={r} />
            </ErrorBoundary>
          ))}
    </div>
  );
}
