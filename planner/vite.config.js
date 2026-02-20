import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import dotenv from 'dotenv'

// https://vite.dev/config/
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
    plugins: [react()],
    define: {
      'import.meta.env.GOOGLE_MAPS_API_KEY': JSON.stringify(apiKey)
    }
  };
})
