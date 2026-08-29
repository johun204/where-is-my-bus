import { useEffect, useRef, useState } from 'react';
import { ErrorBoundary } from './ErrorBoundary';
import { useFavoriteRoutes } from './hooks/useFavoriteRoutes';
import { RouteLayer } from './map/RouteLayer';
import { routeTypeColor } from './map/routeColor';
import { useMyLocation } from './map/useMyLocation';

const FALLBACK = { lat: 37.5665, lng: 126.978 }; // 서울시청 (위치 권한 거부 시)

export default function App() {
  const mapEl = useRef(null);
  const [map, setMap] = useState(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [installEvt, setInstallEvt] = useState(null);
  const { favorites, has, toggle, toggleEnabled } = useFavoriteRoutes();
  const { follow, onFab } = useMyLocation(map);

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

  // PWA 설치 프롬프트 캡처 (Android/데스크톱 Chrome)
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
      <div ref={mapEl} className="map" />

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
