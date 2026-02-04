# RoadTripper Rebuilt

A modern reconstruction of the original RoadTripper, now powered by Playwright and a route-aware navigation engine.

## Prerequisites

- Node.js (v18+)
- A Google Maps API Key (with Directions API and Maps JavaScript API enabled)

## Setup

1.  Clone the repository.
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Create a `.env` file in the root directory:
    ```env
    GOOGLE_MAPS_API_KEY=your_api_key_here
    ```

## Usage

### 1. Generate a Route
Use the Route Picker to define your journey:
```bash
cd picker
npm install
npm run dev
```
1.  Open `http://localhost:5173`.
2.  Click on the map to set a **Start** point.
3.  Click again to set an **End** point.
4.  Click **Calculate Route**.
5.  Click **Export Route** to download `route.json`.
6.  Move the `route.json` file to the root of the `roadTripper` project.

### 2. Run the Navigator
Follow the route and capture images:
```bash
cd ..
node navigator/index.js
```
The script will launch a browser, follow the route Pano-by-Pano, and save screenshots to the `output/` directory.

## Technical Details
- **Picker**: Built with Vite + React and `@react-google-maps/api`.
- **Navigator**: Node.js script using Playwright to automate a local `viewport.html`.
- **Logic**: Uses bearing calculations to ensure the Street View camera follows the pre-planned route coordinates accurately.