import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import dotenv from 'dotenv'
import fs from 'fs'

const saveApiPlugin = (projectPath) => ({
  name: 'save-api',
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (req.method === 'GET' && req.url === '/api/project-files') {
        try {
          const routePath = path.join(projectPath, 'route.json');
          const statePath = path.join(projectPath, 'navigator_state.json');
          const result = {};
          if (fs.existsSync(routePath)) {
            result.route = JSON.parse(fs.readFileSync(routePath, 'utf-8'));
          }
          if (fs.existsSync(statePath)) {
            result.navigatorState = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      } else if (req.method === 'POST' && req.url === '/api/save-route') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const routeData = JSON.parse(body);
            const routePath = path.join(projectPath, 'route.json');
            fs.writeFileSync(routePath, JSON.stringify(routeData, null, 2));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, path: routePath }));
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      } else if (req.method === 'POST' && req.url === '/api/save-navigator-state') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const stateData = JSON.parse(body);
            const statePath = path.join(projectPath, 'navigator_state.json');
            fs.writeFileSync(statePath, JSON.stringify(stateData, null, 2));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, path: statePath }));
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      } else {
        next();
      }
    });
  }
});

export default defineConfig(() => {
  const projectPath = process.env.PROJECT_PATH;
  if (!projectPath) {
    throw new Error('PROJECT_PATH environment variable is required. Use: roadtripper plan <project-path>');
  }

  const configPath = path.join(projectPath, 'project.conf');
  dotenv.config({ path: configPath, quiet: true });
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || '';

  if (!apiKey) {
    throw new Error(`GOOGLE_MAPS_API_KEY not found in ${configPath}`);
  }

  return {
    plugins: [react(), saveApiPlugin(projectPath)],
    define: {
      'import.meta.env.GOOGLE_MAPS_API_KEY': JSON.stringify(apiKey),
      'import.meta.env.PROJECT_PATH': JSON.stringify(projectPath)
    }
  };
})
