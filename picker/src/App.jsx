import React, { useState, useCallback, useRef } from 'react';
import { GoogleMap, useJsApiLoader, MarkerF, OverlayView, PolylineF } from '@react-google-maps/api';

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
  const [path, setPath] = useState(null); // Unified path for both calculated and loaded routes
  const [isDraggingMarker, setIsDraggingMarker] = useState(false);

  const [infoWindow, setInfoWindow] = useState(null); // 'start' or 'end' or null
  const [navigatorPosition, setNavigatorPosition] = useState(null);

  const routeFileInputRef = useRef(null);
  const navigatorFileInputRef = useRef(null);

  const onMapClick = useCallback((e) => {
    if (infoWindow) {
      setInfoWindow(null);
      return;
    }

    if (path) return;

    if (!start) {
      setStart({ lat: e.latLng.lat(), lng: e.latLng.lng() });
    } else if (!end) {
      setEnd({ lat: e.latLng.lat(), lng: e.latLng.lng() });
    }
  }, [start, end, infoWindow, path]);

  const onStartDragStart = useCallback(() => {
    setIsDraggingMarker(true);
    setPath(null);
  }, []);

  const onStartDragEnd = useCallback((e) => {
    const newPos = { lat: e.latLng.lat(), lng: e.latLng.lng() };
    setStart(newPos);
    setPath(null);
    setIsDraggingMarker(false);
  }, []);

  const onEndDragStart = useCallback(() => {
    setIsDraggingMarker(true);
    setPath(null);
  }, []);

  const onEndDragEnd = useCallback((e) => {
    const newPos = { lat: e.latLng.lat(), lng: e.latLng.lng() };
    setEnd(newPos);
    setPath(null);
    setIsDraggingMarker(false);
  }, []);

  // Removed old onLoadedStartDragEnd and onLoadedEndDragEnd as they are now unified into the above handlers

  const onLoad = useCallback(function callback(map) {
    setMap(map);
  }, []);

  const onUnmount = useCallback(function callback() {
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

  const zoomToPath = useCallback(() => {
    if (map && path && path.length > 0) {
      const bounds = new window.google.maps.LatLngBounds();
      path.forEach(point => bounds.extend(point));
      map.fitBounds(bounds);
    }
  }, [map, path]);

  const zoomToNavigator = useCallback(() => {
    if (map && navigatorPosition) {
      map.panTo(navigatorPosition);
      map.setZoom(18);
    }
  }, [map, navigatorPosition]);

  const calculateRoute = useCallback(() => {
    if (start && end) {
      setPath(null);
      const directionsService = new window.google.maps.DirectionsService();
      directionsService.route(
        {
          origin: start,
          destination: end,
          travelMode: window.google.maps.TravelMode.DRIVING,
        },
        (result, status) => {
          if (status === window.google.maps.DirectionsStatus.OK) {
            const overviewPath = result.routes[0].overview_path.map(p => ({ lat: p.lat(), lng: p.lng() }));
            setPath(overviewPath);
            // Sync markers to snapped positions
            const leg = result.routes[0].legs[0];
            setStart({ lat: leg.start_location.lat(), lng: leg.start_location.lng() });
            setEnd({ lat: leg.end_location.lat(), lng: leg.end_location.lng() });
          } else {
            console.error(`error fetching directions ${status}`);
          }
        }
      );
    }
  }, [start, end]);

  const exportRoute = useCallback(() => {
    if (path) {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(path));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href", dataStr);
      downloadAnchorNode.setAttribute("download", "route.json");
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
    }
  }, [path]);

  const handleRouteFileUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      setPath(null);
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const json = JSON.parse(e.target.result);
          setPath(json);
          if (json.length > 0) {
            setStart(json[0]);
            setEnd(json[json.length - 1]);

            // Auto-zoom to loaded route
            if (map) {
              const bounds = new window.google.maps.LatLngBounds();
              json.forEach(point => bounds.extend(point));
              map.fitBounds(bounds);
            }
          }
          setInfoWindow(null);
        } catch (error) {
          console.error("Error parsing route.json", error);
        }
      };
      reader.readAsText(file);
    }
  };

  const handleNavigatorFileUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const json = JSON.parse(e.target.result);
          if (json.lastLat && json.lastLng) {
            setNavigatorPosition({ lat: json.lastLat, lng: json.lastLng });
          }
        } catch (error) {
          console.error("Error parsing navigator_state.json", error);
        }
      };
      reader.readAsText(file);
    }
  };

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
          <MarkerF
            position={start}
            label="S"
            draggable={true}
            onDragStart={onStartDragStart}
            onDragEnd={onStartDragEnd}
            onDblClick={() => setInfoWindow('start')}
          />
        )}
        {end && (
          <MarkerF
            position={end}
            label="E"
            draggable={true}
            onDragStart={onEndDragStart}
            onDragEnd={onEndDragEnd}
            onDblClick={() => setInfoWindow('end')}
          />
        )}

        {navigatorPosition && (
          <MarkerF
            position={navigatorPosition}
            label="NAV"
            icon="http://maps.google.com/mapfiles/ms/icons/blue-dot.png"
            onDblClick={() => setInfoWindow('nav')}
          />
        )}

        {path && path.length > 0 && (
          <PolylineF
            path={path}
            options={{
              strokeColor: "#FF0000",
              strokeOpacity: 0.8,
              strokeWeight: 4,
            }}
          />
        )}

        {infoWindow && (
          <OverlayView
            position={
              infoWindow === 'start' ? start : 
              infoWindow === 'end' ? end : 
              navigatorPosition
            }
            mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
          >
            <div
              style={{
                width: '300px',
                height: '200px',
                border: '2px solid white',
                boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
                transform: 'translate(-50%, -220px)' // Center above the marker
              }}
            >
              <img
                src={`https://maps.googleapis.com/maps/api/streetview?size=300x200&location=${
                  (infoWindow === 'start' ? start : 
                   infoWindow === 'end' ? end : 
                   navigatorPosition).lat
                },${
                  (infoWindow === 'start' ? start : 
                   infoWindow === 'end' ? end : 
                   navigatorPosition).lng
                }&key=${import.meta.env.GOOGLE_MAPS_API_KEY}`}
                alt="Street View Preview"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </div>
          </OverlayView>
        )}
      </GoogleMap>

      <div style={{ position: 'absolute', top: 10, left: 10, background: 'white', padding: 10, borderRadius: 5, zIndex: 1 }}>
        <div style={{ fontWeight: 'bold', marginBottom: 10, fontSize: '18px' }}>Roadtripper</div>
        <button onClick={() => {
          setStart(null);
          setEnd(null);
          setPath(null);
          setInfoWindow(null);
          setNavigatorPosition(null);
          if (routeFileInputRef.current) routeFileInputRef.current.value = "";
          if (navigatorFileInputRef.current) navigatorFileInputRef.current.value = "";
        }}>Clear All</button>
        <button style={{ marginLeft: 10 }} onClick={zoomToStart} disabled={!start}>Zoom to Start</button>
        <button style={{ marginLeft: 10 }} onClick={zoomToEnd} disabled={!end}>Zoom to End</button>

        <div style={{ marginTop: 10 }}>
          <button onClick={calculateRoute} disabled={!start || !end}>Calculate Route</button>
          {path && (
            <>
              <button style={{ marginLeft: 10 }} onClick={zoomToPath}>Show Entire Route</button>
              <button style={{ marginLeft: 10 }} onClick={exportRoute}>Export Route</button>
            </>
          )}
        </div>

        <div style={{ marginTop: 10 }}>
          <button onClick={() => routeFileInputRef.current.click()}>Load Route File</button>
          <input
            type="file"
            ref={routeFileInputRef}
            style={{ display: 'none' }}
            onChange={handleRouteFileUpload}
            accept=".json"
          />
          <button style={{ marginLeft: 10 }} onClick={() => navigatorFileInputRef.current.click()}>Load Nav State</button>
          <input
            type="file"
            ref={navigatorFileInputRef}
            style={{ display: 'none' }}
            onChange={handleNavigatorFileUpload}
            accept=".json"
          />
          {navigatorPosition && <button style={{ marginLeft: 10 }} onClick={zoomToNavigator}>Zoom to Navigator</button>}
        </div>

        {path && (
          <div style={{ marginTop: 10, fontSize: '14px', color: '#555' }}>
            Steps: <strong>{path.length}</strong>
          </div>
        )}
      </div>
    </div>
  ) : <></>;
}

export default React.memo(App);