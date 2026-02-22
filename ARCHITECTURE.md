# ARCHITECTURE.md

## 1. Project Structure

```plaintext
roadTripper/
├── cli.js                     # Entry point, CLI commands (plan, navigate)
├── navigator/
│   ├── index.js              # Main navigation loop, screenshot logic
│   ├── lib.js                # Pure functions: heading/distance calc, state management
│   ├── viewport.html         # Headless Street View wrapper injected into browser
│   ├── test-utils.js         # Test utilities (mockFs, mockPage, mockPanoData)
│   ├── lib.test.js           # Tests for lib.js
│   ├── run.test.js           # Tests for navigation loop
│   └── pano.test.js          # Tests for pano selection
├── planner/
│   ├── src/
│   │   ├── App.jsx           # React route planner (planned rewrite)
│   │   ├── utils.js          # Duplicate calculateDistance
│   │   └── main.jsx          # React entry point
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── package.json              # Root dependencies
├── eslint.config.js
└── README.md
```

## 2. High-Level System Diagram

```plaintext
[User CLI] --> [cli.js] --> [navigator/index.js] --> [Playwright Browser]
                                        |
                                        v
                              [Google Street View API]
                                        |
                                        v
                              [Screenshots + State Files]
```

## 3. Core Components

### 3.1. CLI

Name: Command Line Interface

Description: Entry point handling `plan` and `navigate` commands. Installs planner dependencies, spawns dev server, or runs navigation loop.

Technologies: Commander.js, child_process spawn

### 3.2. Navigator

Name: Navigation Engine

Description: Core component that automates browser navigation along a route, captures screenshots, manages state, and avoids backtracking.

Technologies: Playwright, Consola (logging), dotenv

Key Functions:

- `run()` - Main navigation loop (navigator/index.js:209-383)
- `getBestLink()` - Picks best Street View link within 90° of target (lib.js:23-39)
- `createForbiddenPanos()` - Manages bad/recent panos to prevent loops (lib.js:41-66)

### 3.3. Planner

Name: Route Planner Web App

Description: React application for visually planning routes by clicking start/end points and exporting route JSON.

Technologies: React, Vite, Google Maps JavaScript API

Note: Being rewritten - expect significant changes.

## 4. Data Stores

### 4.1. File System

Type: Local filesystem (JSON files)

Purpose: Stores route definitions, navigation state, and captured images

Key Files:

- `route.json` - Array of {lat, lng} waypoints
- `navigator_state.json` - Progress tracking (step, position, badPanos, bannedRoads)
- `navigator.log` - Runtime logs
- `images/` - Captured JPEG screenshots

## 5. External Integrations / APIs

### 5.1. Google Maps Platform

Service Name: Google Street View API

Purpose: Provides panorama data and imagery for navigation

Integration Method: Google Maps JavaScript API (loaded in headless browser)

Note: API key is embedded in client-side bundle - security warning in README

## 6. Deployment & Infrastructure

Development: Local machine only

Key Services Used: None (local execution)

CI/CD: None currently configured

Monitoring & Logging: Console + file logging via Consola to navigator.log

## 7. Security Considerations

Authentication: Google Maps API key in project.conf

Authorization: API key restricted by project.conf loading

Data Encryption: N/A (local only)

Key Security Tools/Practices:

- API key embedded in client bundle - DO NOT expose planner to public internet
- See README.md security warning

## 8. Development & Testing Environment

Local Setup Instructions:

```bash
npm install
npm test
npm run lint
```

Testing Frameworks: Node.js built-in test runner (`node --test`)

Code Quality Tools: ESLint

Test Utilities (navigator/test-utils.js):

- `createMockFs()` - Mock filesystem
- `createMockPage()` - Mock Playwright page
- `mockPanoData()` - Sample Street View data

## 9. Future Considerations / Roadmap

## 10. Project Identification

Project Name: RoadTripper

Repository URL: <https://github.com/MDCore/roadTripper>

## 11. Glossary / Acronyms

| Term | Definition |
| ------ | ------------ |
| Pano | Street View panorama ID (28-character string) |
| Route | Array of {lat, lng} waypoints |
| Forbidden Panos | badPanos + recentlyVisitedPanos used to prevent backtracking |
| Waypoint | A single lat/lng point in the route |
| Step | Current position index in the route |

## 12. Configuration Reference

Environment variables in project.conf:

| Variable | Default | Description |
| ---------- | --------- | ------------- |
| NAVIGATOR_STEP_DELAY | 1000 | ms to wait after panorama loads |
| NAVIGATOR_WIDTH | 1920 | Screenshot width |
| NAVIGATOR_HEIGHT | 1080 | Screenshot height |
| NAVIGATOR_JPEG_QUALITY | 60 | JPEG quality 0-100 |

## 13. Magic Numbers

Hardcoded values in navigator/index.js and lib.js:

| Value | Location | Meaning |
| ------- | ---------- | --------- |
| 25 | index.js:~323 | Distance threshold (meters) to increment step |
| 90 | lib.js:33 | Max heading difference to consider a link |
| 1000 | index.js:~244 | Canvas stable time before screenshot (ms) |
| 10000 | index.js:~253 | Max wait for canvas stability (ms) |
| 10 | lib.js:53 | Max recently visited panos to track |

## 14. Key Files Quick Reference

| File | Purpose | Key Functions |
| ------ | --------- | --------------- |
| navigator/index.js | Main loop | run(), getPanoData(), chooseBestPanoAtPosition(), captureScreenshot() |
| navigator/lib.js | Pure logic | calculateHeading(), calculateDistance(), getBestLink(), createForbiddenPanos(), loadState(), saveState() |
| navigator/viewport.html | Browser context | Injected JS: getPanoDataV, getCurrentPositionPanoV, initPanoramaV, moveToPanoV |
| cli.js | CLI commands | plan command, navigate command |
