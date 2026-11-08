import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import type { Coords, DoneCallback } from 'leaflet';

export function LocationMap({
  latitude,
  longitude,
}: {
  latitude: number;
  longitude: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<
    'loading' | 'ready' | 'partial' | 'error'
  >('loading');

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    const retries = new Set<ReturnType<typeof setTimeout>>();
    const images = new Set<HTMLImageElement>();
    let successes = 0;
    setStatus('loading');
    const timeout = setTimeout(() => {
      if (!disposed) setStatus(successes ? 'partial' : 'error');
    }, 15000);
    void import('leaflet')
      .then((L) => {
        if (disposed || !container.current) return;
        const map = L.map(container.current).setView([latitude, longitude], 16);
        // Retry only an actual failed visible tile, once, without bypassing
        // browser caching or requesting tiles outside the current viewport.
        class RetryingTileLayer extends L.TileLayer {
          override createTile(coords: Coords, done: DoneCallback) {
            const tile = document.createElement('img');
            tile.alt = '';
            tile.setAttribute('role', 'presentation');
            tile.referrerPolicy = 'strict-origin-when-cross-origin';
            images.add(tile);
            let retried = false;
            tile.onload = () => {
              if (!disposed) done(undefined, tile);
            };
            tile.onerror = () => {
              if (disposed) return;
              if (retried) {
                done(new Error('Map tile unavailable'), tile);
                return;
              }
              retried = true;
              const timer = setTimeout(() => {
                retries.delete(timer);
                if (!disposed && tile.isConnected)
                  tile.src = this.getTileUrl(coords);
              }, 700);
              retries.add(timer);
            };
            tile.src = this.getTileUrl(coords);
            return tile;
          }
        }
        const tiles = new RetryingTileLayer(
          'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          {
            maxZoom: 19,
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          },
        );
        let failures = 0;
        tiles.on('loading', () => {
          failures = 0;
        });
        tiles.on('tileload', () => {
          successes++;
        });
        tiles.on('tileerror', () => {
          failures++;
        });
        tiles.on('load', () => {
          clearTimeout(timeout);
          if (!disposed)
            setStatus(failures ? (successes ? 'partial' : 'error') : 'ready');
        });
        tiles.addTo(map);
        L.circleMarker([latitude, longitude], {
          radius: 9,
          color: '#fff',
          weight: 3,
          fillColor: '#078478',
          fillOpacity: 1,
        })
          .addTo(map)
          .bindTooltip('Vị trí hiện tại');
        const observer = new ResizeObserver(() => map.invalidateSize());
        observer.observe(container.current);
        cleanup = () => {
          observer.disconnect();
          map.remove();
        };
      })
      .catch(() => {
        clearTimeout(timeout);
        if (!disposed) setStatus('error');
      });
    return () => {
      disposed = true;
      clearTimeout(timeout);
      for (const timer of retries) clearTimeout(timer);
      for (const image of images) {
        image.onload = null;
        image.onerror = null;
      }
      cleanup?.();
    };
  }, [latitude, longitude, attempt]);

  return (
    <div className="location-map-wrapper">
      <div
        ref={container}
        className="location-map"
        aria-label="Bản đồ vị trí hiện tại"
      />
      {status === 'loading' && (
        <p className="location-map-status" role="status">
          Đang tải bản đồ…
        </p>
      )}
      {(status === 'error' || status === 'partial') && (
        <div className="location-map-status" role="alert">
          {status === 'partial'
            ? 'Một phần bản đồ chưa tải được. Bấm thử lại hoặc “Mở bản đồ”.'
            : 'Không tải được bản đồ. Kiểm tra kết nối mạng hoặc bấm “Mở bản đồ”.'}
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Thử lại
          </button>
        </div>
      )}
    </div>
  );
}
