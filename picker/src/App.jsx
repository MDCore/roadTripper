import React, { useState, useCallback } from 'react';
import { GoogleMap, useJsApiLoader, Marker, DirectionsRenderer, OverlayView } from '@react-google-maps/api';

const containerStyle = {
  width: '100vw',
  height: '100vh'
};

const center = {
  lat: -33.91,
  lng: 18.42
};

function App() {
  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: import.meta.env.GOOGLE_MAPS_API_KEY || ""
  });

  const [map, setMap] = useState(null);
  const [start, setStart] = useState(null);
  const [end, setEnd] = useState(null);
  const [directions, setDirections] = useState(null);
  const [isDraggingMarker, setIsDraggingMarker] = useState(false);
  const [infoWindow, setInfoWindow] = useState(null); // 'start' or 'end' or null

  const onMapClick = useCallback((e) => {
    if (infoWindow) {
      setInfoWindow(null);
      return;
    }

    if (!start) {
      setStart({ lat: e.latLng.lat(), lng: e.latLng.lng() });
    } else if (!end) {
      setEnd({ lat: e.latLng.lat(), lng: e.latLng.lng() });
    }
  }, [start, end, infoWindow]);

  const onStartDragStart = useCallback(() => {
    setIsDraggingMarker(true);
  }, []);

  const onStartDragEnd = useCallback((e) => {
    setStart({ lat: e.latLng.lat(), lng: e.latLng.lng() });
    setDirections(null);
    setIsDraggingMarker(false);
  }, []);

  const onEndDragStart = useCallback(() => {
    setIsDraggingMarker(true);
  }, []);

  const onEndDragEnd = useCallback((e) => {
    setEnd({ lat: e.latLng.lat(), lng: e.latLng.lng() });
    setDirections(null);
    setIsDraggingMarker(false);
  }, []);

  const onLoad = useCallback(function callback(map) {
    setMap(map);
  }, []);

  const onUnmount = useCallback(function callback(map) {
    setMap(null);
  }, []);

  const zoomToStart = useCallback(() => {
    if (map && start) {
      map.panTo(start);
      map.setZoom(18);
    }
  }, [map, start]);

  const zoomToEnd = useCallback(() => {
    if (map && end) {
      map.panTo(end);
      map.setZoom(18);
    }
  }, [map, end]);

  const zoomToRoute = useCallback(() => {
    if (map && directions) {
      const bounds = directions.routes[0].bounds;
      map.fitBounds(bounds);
    }
  }, [map, directions]);

  const calculateRoute = useCallback(() => {
    if (start && end) {
      const directionsService = new window.google.maps.DirectionsService();
      directionsService.route(
        {
          origin: start,
          destination: end,
          travelMode: window.google.maps.TravelMode.DRIVING,
        },
        (result, status) => {
          if (status === window.google.maps.DirectionsStatus.OK) {
            setDirections(result);
          } else {
            console.error(`error fetching directions ${result}`);
          }
        }
      );
    }
  }, [start, end]);

  const exportRoute = useCallback(() => {
    if (directions) {
      const route = directions.routes[0];
      const path = route.overview_path.map(p => ({ lat: p.lat(), lng: p.lng() }));
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(path));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href", dataStr);
      downloadAnchorNode.setAttribute("download", "route.json");
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
    }
  }, [directions]);

  return isLoaded ? (
    <div style={{ position: 'relative' }}>
      <GoogleMap
        mapContainerStyle={containerStyle}
        center={center}
        zoom={10}
        onLoad={onLoad}
        onUnmount={onUnmount}
        onClick={onMapClick}
        options={{
          draggable: !isDraggingMarker,
          clickableIcons: false
        }}
      >
        {start && (
          <Marker
            position={start}
            label="Start"
            draggable={true}
            onDragStart={onStartDragStart}
            onDragEnd={onStartDragEnd}
            onDblClick={() => setInfoWindow('start')}
          />
        )}
        {end && (
          <Marker
            position={end}
            label="End"
            draggable={true}
            onDragStart={onEndDragStart}
            onDragEnd={onEndDragEnd}
            onDblClick={() => setInfoWindow('end')}
          />
        )}

        {infoWindow && (
          <OverlayView
            position={infoWindow === 'start' ? start : end}
            mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
          >
            <div style={{
              width: '300px',
              height: '200px',
              border: '2px solid white',
              boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
              transform: 'translate(-50%, -220px)' // Center above the marker
            }}>
              <img
                src={`https://maps.googleapis.com/maps/api/streetview?size=300x200&location=${(infoWindow === 'start' ? start : end).lat},${(infoWindow === 'start' ? start : end).lng}&key=${import.meta.env.GOOGLE_MAPS_API_KEY}`}
                alt="Street View Preview"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </div>
          </OverlayView>
        )}

        {directions && <DirectionsRenderer directions={directions} options={{ suppressMarkers: true }} />}
      </GoogleMap>

      <div style={{ position: 'absolute', top: 10, left: 10, background: 'white', padding: 10, borderRadius: 5, zIndex: 1 }}>
        <button onClick={() => { setStart(null); setEnd(null); setDirections(null); setInfoWindow(null); }}>Clear Points</button>
        <button style={{ marginLeft: 10 }} onClick={zoomToStart} disabled={!start}>Zoom to Start</button>
        <button style={{ marginLeft: 10 }} onClick={zoomToEnd} disabled={!end}>Zoom to End</button>
        {start && end && !directions && <button style={{ marginLeft: 10 }} onClick={calculateRoute}>Calculate Route</button>}
        {directions && (
          <>
            <button style={{ marginLeft: 10 }} onClick={zoomToRoute}>Show Entire Route</button>
            <button style={{ marginLeft: 10 }} onClick={exportRoute}>Export Route</button>
            <div style={{ marginTop: 10, fontSize: '14px', color: '#555' }}>
              Steps: <strong>{directions.routes[0].overview_path.length}</strong>
            </div>
          </>
        )}
      </div>
    </div>
  ) : <></>;
}

export default React.memo(App);