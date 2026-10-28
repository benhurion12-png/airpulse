"use client";

import { useEffect, useRef, useState } from "react";
import { Location } from "@/lib/types";

function tone(score: number | null) {
  if (score === null) return "#8290a6";
  if (score >= 85) return "#18b783";
  if (score >= 65) return "#28a8f7";
  if (score >= 40) return "#f0a936";
  return "#f45b69";
}

export function RegionMap({ locations, selectedId, onSelect }: { locations: Location[]; selectedId?: string; onSelect: (id: string) => void }) {
  const node = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const markersRef = useRef<import("maplibre-gl").Marker[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    import("maplibre-gl").then((maplibregl) => {
      if (!alive || !node.current || mapRef.current) return;
      const map = new maplibregl.Map({
        container: node.current,
        center: [69.25, 54.45],
        zoom: 6.25,
        minZoom: 5.5,
        maxZoom: 12,
        maxBounds: [[65.5, 52.7], [72.5, 56.0]],
        attributionControl: false,
        style: {
          version: 8,
          sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap" } },
          layers: [{ id: "osm", type: "raster", source: "osm", paint: { "raster-saturation": -0.5, "raster-contrast": 0.08 } }],
        },
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
      mapRef.current = map;
      setReady(true);
    });
    return () => {
      alive = false;
      setReady(false);
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];
    let cancelled = false;
    const effectMarkers: import("maplibre-gl").Marker[] = [];

    import("maplibre-gl").then((maplibregl) => {
      if (cancelled) return;
      locations.forEach((location) => {
        const markerNode = document.createElement("button");
        markerNode.className = `map-marker${location.id === selectedId ? " active" : ""}`;
        markerNode.type = "button";
        markerNode.style.setProperty("--marker", tone(location.score));
        markerNode.setAttribute("aria-label", `Открыть объект ${location.name}. Индекс качества: ${location.score ?? "нет данных"}`);
        markerNode.setAttribute("aria-pressed", String(location.id === selectedId));

        const pin = document.createElement("span");
        pin.className = "map-marker-pin";
        const value = document.createElement("span");
        value.className = "map-marker-value";
        value.textContent = location.score === null ? "—" : String(Math.round(location.score));
        pin.append(value);

        const label = document.createElement("span");
        label.className = "map-marker-label";
        const labelName = document.createElement("strong");
        labelName.textContent = location.name;
        const labelStatus = document.createElement("small");
        labelStatus.textContent = location.score === null ? "Нет данных" : `Индекс ${Math.round(location.score)}`;
        label.append(labelName, labelStatus);
        markerNode.append(pin, label);

        markerNode.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          onSelect(location.id);
          map.easeTo({
            center: [location.longitude, location.latitude],
            zoom: Math.max(map.getZoom(), 7),
            duration: 450,
          });
        });

        const marker = new maplibregl.Marker({ element: markerNode, anchor: "bottom" })
          .setLngLat([location.longitude, location.latitude])
          .addTo(map);
        effectMarkers.push(marker);
      });
      markersRef.current = effectMarkers;
    });

    return () => {
      cancelled = true;
      effectMarkers.forEach((marker) => marker.remove());
      if (markersRef.current === effectMarkers) markersRef.current = [];
    };
  }, [locations, selectedId, onSelect, ready]);

  return <div ref={node} className="region-map" aria-label="Карта объектов Северо-Казахстанской области" />;
}

