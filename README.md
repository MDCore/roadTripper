# RoadTripper Rebuilt

A modern reconstruction of the original RoadTripper with a route-aware navigation engine.

## Security Warning

> **The Route Planner (`roadtripper plan`) embeds your Google Maps API key in the client-side JavaScript bundle.** Do not expose the planner to the public internet. Only run it locally or on a trusted network.

## Prerequisites

- Node.js (v18+)
- A Google Maps API Key

## Setup

1. Clone the repository.
2. Install dependencies:

    ```bash
    npm install
    ```

## Usage

### 1. Create a Project

1. Create a folder for your project (e.g., `projects/my-trip/`).
2. Create a `project.conf` file in your project folder:

```bash
GOOGLE_MAPS_API_KEY=your_api_key_here

# Optional settings
NAVIGATOR_STEP_DELAY=1000    # ms delay between panorama loading and screenshot (default: 1000)
NAVIGATOR_RETAKE_DELAY=5000  # ms delay for retake command (default: 5000)
NAVIGATOR_WIDTH=1920          # Screenshot width (default: 1920)
NAVIGATOR_HEIGHT=1080         # Screenshot height (default: 1080)
NAVIGATOR_JPEG_QUALITY=60     # JPEG quality 0-100 (default: 60)
```

### 2. Plan a Route

Use the Route Planner to define your journey e.g.:

```bash
roadtripper plan ./projects/N2/
```

This will install dependencies (if needed) and start the planner at `http://localhost:5173`.

1. Click on the map to set a **Start** point.
2. Click again to set an **End** point.
3. Click **Calculate Route**.
4. Click **Export Route**. You will be prompted for a **Project Name** (e.g., `N2`).
5. A file named `<ProjectName>_route.json` will be downloaded.
6. Save this file to your project folder.

### 3. Run the Navigator

Follow the route and capture images by providing the project path e.g.:

```bash
roadtripper navigate --watch ./projects/N2/
```

The script will follow the route and save screenshots to `<project-path>/images/`.

### Retaking Images

If an individual image didn't capture correctly, you can retake it e.g.:

```bash
roadtripper retake ""./projects/N2/images/2024-01-15\ 40.712800 -74.006000 2024-01-15 abc123 123.4567.jpg"
```

The command will:

- Validate the image is inside a project directory (finds `project.conf` automatically)
- Parse the filename to extract the panorama ID and heading
- Navigate to that exact location and retake the screenshot
- Overwrite the original file (preserving the filename)

You can also use `--debug` to see the browser window while retaking:

```bash
roadtripper retake --debug <image-path>
```

## Project Structure

```plaintext
└── <project-path>/
    ├── project.conf         # Required: Project configuration
    ├── route.json           # Required: The exported route
    ├── navigator.log        # Auto-generated: log of output messages
    ├── navigator_state.json # Auto-generated: Current progress
    └── images/              # Auto-generated: Captured screenshots
```

## Navigation Tips

- If your screenshots look like they're not fully loaded, increase `NAVIGATOR_STEP_DELAY` in `project.conf`
- You can replace `navigator_state.json` with session data from the log to restart at that point
- If a position is taking an obviously wrong link, try adding that link's pano to badPanos in `navigator_state.json`
- If the navigator tries to go down a road you don't want, add the road description to "bannedRoads" in `navigator_state.json`
