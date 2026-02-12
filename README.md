# RoadTripper Rebuilt

A modern reconstruction of the original RoadTripper with a route-aware navigation engine.

## Prerequisites
- Node.js (v18+)
- A Google Maps API Key (with Directions API and Maps JavaScript API enabled)

## Setup
1. Clone the repository.
2. Install dependencies:
    ```bash
    npm install
    ```
3. Create a `.env` file in the root directory:
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
5.  Click **Export Route**. You will be prompted for a **Project Name** (e.g., `N2`).
6.  A file named `<ProjectName>_route.json` will be downloaded.

### 2. Organize your Project
Create a folder for your project under the `projects/` directory:
```bash
mkdir -p projects/N2
mv ~/Downloads/N2_route.json projects/N2/route.json projects/N2
```

**Project Structure:**
```
projects/
└── <project-name>/
    ├── route.json           # Required: The exported route
    ├── navigator_state.json # Auto-generated: Current progress
    └── images/              # Auto-generated: Captured screenshots
```

### 3. Run the Navigator
Follow the route and capture images by providing the project name:
```bash
node navigator/index.js <project-name>
```
Example: `node navigator/index.js N2`

The script will follow the route and save screenshots to `projects/<project-name>/images/`.
