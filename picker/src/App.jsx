import React, { useState, useCallback } from 'react';
import { GoogleMap, useJsApiLoader, Marker, DirectionsRenderer } from '@react-google-maps/api';

const containerStyle = {
  width: '100vw',
  height: '100vh'
};

const center = {
  lat: -34.397,
  lng: 150.644
};

function App() {
  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ""
  });

  const [map, setMap] = useState(null);
  const [start, setStart] = useState(null);
  const [end, setEnd] = useState(null);
  const [directions, setDirections] = useState(null);

  const onMapClick = useCallback((e) => {
    if (!start) {
      setStart({ lat: e.latLng.lat(), lng: e.latLng.lng() });
    } else if (!end) {
      setEnd({ lat: e.latLng.lat(), lng: e.latLng.lng() });
    }
  }, [start, end]);

  const onLoad = useCallback(function callback(map) {
    setMap(map);
  }, []);

  const onUnmount = useCallback(function callback(map) {
    setMap(null);
  }, []);

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
      >
        {start && <Marker position={start} label="Start" />}
        {end && <Marker position={end} label="End" />}
        {directions && <DirectionsRenderer directions={directions} />}
      </GoogleMap>
      
      <div style={{ position: 'absolute', top: 10, left: 10, background: 'white', padding: 10, borderRadius: 5, zIndex: 1 }}>
        <button onClick={() => { setStart(null); setEnd(null); setDirections(null); }}>Clear Points</button>
        {start && end && !directions && <button style={{ marginLeft: 10 }} onClick={calculateRoute}>Calculate Route</button>}
        {directions && <button style={{ marginLeft: 10 }} onClick={exportRoute}>Export Route</button>}
      </div>
    </div>
  ) : <></>;
}

export default React.memo(App);