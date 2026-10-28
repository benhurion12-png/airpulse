"use client";

import { useEffect, useRef } from "react";
import { Icon } from "./icons";

type Coordinates = {
  latitude: number;
  longitude: number;
};

export function CoordinatePicker({
  value,
  onChange,
  onDone,
}: {
  value: Coordinates;
  onChange: (coordinates: Coordinates) => void;
  onDone: () => void;
}) {
  const node = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const markerRef = useRef<import("maplibre-gl").Marker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let alive = true;
    import("maplibre-gl").then((maplibregl) => {
      if (!alive || !node.current || mapRef.current) return;
      const map = new maplibregl.Map({
        container: node.current,
        center: [value.longitude, value.latitude],
        zoom: 7.2,
        minZoom: 5.5,
        maxZoom: 15,
        maxBounds: [[65.5, 52.7], [72.5, 56.0]],
        attributionControl: false,
        style: {
          version: 8,
          sources: {
            osm: {
              type: "raster",
              tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
              tileSize: 256,
              attribution: "© OpenStreetMap",
            },
          },
          layers: [{ id: "osm", type: "raster", source: "osm" }],
        },
      });
      const markerNode = document.createElement("div");
      markerNode.className = "coordinate-marker";
      const marker = new maplibregl.Marker({ element: markerNode, draggable: true, anchor: "bottom" })
        .setLngLat([value.longitude, value.latitude])
        .addTo(map);

      const selectPoint = (longitude: number, latitude: number) => {
        const next = {
          latitude: Number(latitude.toFixed(5)),
          longitude: Number(longitude.toFixed(5)),
        };
        marker.setLngLat([next.longitude, next.latitude]);
        onChangeRef.current(next);
      };

      map.on("click", (event) => selectPoint(event.lngLat.lng, event.lngLat.lat));
      marker.on("dragend", () => {
        const point = marker.getLngLat();
        selectPoint(point.lng, point.lat);
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
      mapRef.current = map;
      markerRef.current = marker;
    });
    return () => {
      alive = false;
      markerRef.current?.remove();
      markerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // The initial position is intentionally captured only when the picker opens.
    // Subsequent changes are synchronized by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    markerRef.current?.setLngLat([value.longitude, value.latitude]);
  }, [value.latitude, value.longitude]);

  return (
    <div className="coordinate-picker">
      <div className="coordinate-picker-head">
        <div>
          <strong><Icon name="pin" /> Укажите точку объекта</strong>
          <span>Кликните по карте или перетащите синий маркер</span>
        </div>
        <button type="button" onClick={onDone}>Готово</button>
      </div>
      <div ref={node} className="coordinate-map" aria-label="Выбор координат объекта на карте Северо-Казахстанской области" />
      <div className="coordinate-readout">
        <span>Широта <b>{value.latitude.toFixed(5)}</b></span>
        <i />
        <span>Долгота <b>{value.longitude.toFixed(5)}</b></span>
        <em>СКО</em>
      </div>
    </div>
  );
}

