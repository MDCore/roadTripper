# RoadTripper Rebuilt

A modern reconstruction of the original RoadTripper with a route-aware navigation engine.

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
NAVIGATOR_WIDTH=1920         # Screenshot width (default: 1920)
NAVIGATOR_HEIGHT=1080        # Screenshot height (default: 1080)
NAVIGATOR_JPEG_QUALITY=60   # JPEG quality 0-100 (default: 60)
```

### 2. Plan a Route

Use the Route Planner to define your journey:

```bash
roadtripper plan ./projects/my-trip/
```

This will install dependencies (if needed) and start the planner at `http://localhost:5173`.

1. Click on the map to set a **Start** point.
2. Click again to set an **End** point.
3. Click **Calculate Route**.
4. Click **Export Route**. You will be prompted for a **Project Name** (e.g., `N2`).
5. A file named `<ProjectName>_route.json` will be downloaded.
6. Save this file to your project folder.

### 3. Run the Navigator

Follow the route and capture images by providing the project path:

```bash
roadtripper navigate ./projects/N2/
```

The script will follow the route and save screenshots to `<project-path>/images/`.

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

- if your screenshots look like they're not fully loaded, increase `NAVIGATOR_STEP_DELAY` in `project.conf`
- You can replace `navigator_state.json` with session data from the log to restart at a point
- If a position is taking an obviously wrong link, try adding that link's pano to badPanos in `navigator_state.json`
- you can watch the current cli progress with this command: `feh --sort mtime --reverse --reload 1 --slideshow-delay 1 --on-last-slide hold --geometry 800x600 --scale-down /path/to/project/images`
