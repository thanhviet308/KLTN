import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import type { CircleMarker, Coords, DoneCallback } from 'leaflet';

export function LocationMap({
  latitude,
  longitude,
  zoom = 16,
  onSelect,
}: {
  latitude: number;
  longitude: number;
  zoom?: number;
  onSelect?: (coords: { latitude: number; longitude: number }) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const markerRef = useRef<CircleMarker | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<
    'loading' | 'ready' | 'partial' | 'error'
  >('loading');

  useEffect(() => {
    markerRef.current?.setLatLng([latitude, longitude]);
  }, [latitude, longitude]);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    const retries = new Set<ReturnType<typeof setTimeout>>();
    const images = new Set<HTMLImageElement>();
    let successes = 0;
    setStatus('loading');
    let timeout = setTimeout(() => {
      if (!disposed) setStatus(successes ? 'partial' : 'error');
    }, 15000);
    void import('leaflet')
      .then((L) => {
        if (disposed || !container.current) return;
        const map = L.map(container.current).setView(
          [latitude, longitude],
          zoom,
        );
        // Try a second provider only for a failed visible tile; preserve caching.
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
                if (!disposed && tile.isConnected) {
                  tile.src = `https://tile.openstreetmap.org/${coords.z}/${coords.x}/${coords.y}.png`;
                } else if (!disposed) {
                  done(new Error('Map tile disconnected'), tile);
                }
              }, 700);
              retries.add(timer);
            };
            tile.src = this.getTileUrl(coords);
            return tile;
          }
        }
        const tiles = new RetryingTileLayer(
          'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
          {
            maxZoom: 19,
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, style <a href="https://www.hotosm.org/">HOT</a>, tiles <a href="https://www.openstreetmap.fr/">OpenStreetMap France</a>',
          },
        );
        const failedTiles = new Set<HTMLElement>();
        tiles.on('loading', () => {
          clearTimeout(timeout);
          timeout = setTimeout(() => {
            if (!disposed) setStatus(successes ? 'partial' : 'error');
          }, 15000);
          if (!disposed) setStatus('loading');
        });
        tiles.on('tileload', (event) => {
          successes++;
          failedTiles.delete(event.tile);
        });
        tiles.on('tileerror', (event) => {
          failedTiles.add(event.tile);
        });
        tiles.on('tileunload', (event) => {
          failedTiles.delete(event.tile);
          const image = event.tile as HTMLImageElement;
          image.onload = null;
          image.onerror = null;
          images.delete(image);
        });
        tiles.on('load', () => {
          clearTimeout(timeout);
          if (!disposed)
            setStatus(
              failedTiles.size ? (successes ? 'partial' : 'error') : 'ready',
            );
        });
        tiles.addTo(map);
        const marker = L.circleMarker([latitude, longitude], {
          radius: 9,
          color: '#fff',
          weight: 3,
          fillColor: '#b75020',
          fillOpacity: 1,
        })
          .addTo(map)
          .bindTooltip('Vị trí đã chọn');
        markerRef.current = marker;
        if (onSelectRef.current) {
          map.on('click', (event) => {
            const next = {
              latitude: event.latlng.lat,
              longitude: event.latlng.lng,
            };
            marker.setLatLng([next.latitude, next.longitude]);
            onSelectRef.current?.(next);
          });
        }
        requestAnimationFrame(() => {
          if (!disposed) map.invalidateSize();
        });
        const observer = new ResizeObserver(() => map.invalidateSize());
        observer.observe(container.current);
        cleanup = () => {
          observer.disconnect();
          markerRef.current = null;
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
    // Initial view uses mount coordinates; markerRef updates keep selection responsive.
  }, [attempt, zoom]);

  return (
    <div className="location-map-wrapper">
      <div
        ref={container}
        className={`location-map${onSelect ? ' is-selectable' : ''}`}
        aria-label="Bản đồ chọn vị trí"
      />
      {status === 'loading' && (
        <p className="location-map-status" role="status">
          Đang tải bản đồ…
        </p>
      )}
      {(status === 'error' || status === 'partial') && (
        <div className="location-map-status" role="alert">
          {status === 'partial'
            ? 'Một phần ảnh bản đồ chưa tải được. Vị trí đã chọn vẫn có thể chia sẻ. Bạn có thể thử lại hoặc mở bản đồ bên dưới.'
            : 'Không tải được ảnh bản đồ. Bạn vẫn có thể chia sẻ tọa độ đã chọn hoặc mở bản đồ bên dưới để kiểm tra.'}
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
