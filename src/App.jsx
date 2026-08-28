import { useEffect, useRef, useState } from 'react';
import { useFavoriteRoutes } from './hooks/useFavoriteRoutes';
import { RouteLayer } from './map/RouteLayer';

const SEOUL = { lat: 37.5665, lng: 126.978 };

export default function App() {
  const mapEl = useRef(null);
  const [map, setMap] = useState(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const { favorites, has, toggle } = useFavoriteRoutes();

  useEffect(() => {
    window.kakao.maps.load(() => {
      setMap(
        new window.kakao.maps.Map(mapEl.current, {
          center: new window.kakao.maps.LatLng(SEOUL.lat, SEOUL.lng),
          level: 5,
        }),
      );
    });
  }, []);

  async function search(e) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    const res = await fetch(`/api/route?routeNo=${encodeURIComponent(q)}&cityCode=25`);
    setResults((await res.json()).results ?? []);
  }

  return (
    <div className="app">
      <div ref={mapEl} className="map" />

      <div className="panel">
        <form onSubmit={search}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="버스 번호 검색 (예: 273)"
          />
          <button type="submit">검색</button>
        </form>

        {results.length > 0 && (
          <ul className="list">
            {results.map((r) => (
              <li key={r.routeId}>
                <span>{r.routeNo}</span>
                <button onClick={() => toggle(r)}>{has(r.routeId) ? '★' : '☆'}</button>
              </li>
            ))}
          </ul>
        )}

        <h3>즐겨찾기</h3>
        <ul className="list">
          {favorites.length === 0 && <li style={{ color: '#999' }}>검색 후 ☆ 를 눌러 추가</li>}
          {favorites.map((r) => (
            <li key={r.routeId}>
              <span>{r.routeNo}</span>
              <button onClick={() => toggle(r)}>★</button>
            </li>
          ))}
        </ul>
      </div>

      {map && favorites.map((r) => <RouteLayer key={r.routeId} map={map} route={r} />)}
    </div>
  );
}
