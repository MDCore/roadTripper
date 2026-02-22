#!/usr/bin/env node
import { Command } from 'commander';
import { spawn, execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import open from 'open';
import * as realFs from 'fs';
import dotenv from 'dotenv';

import { mainNavigate, retakeImage } from './navigator/index.js';
import { parseImageFilename } from './navigator/lib.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const plannerPath = path.join(__dirname, 'planner');

const program = new Command();

program
  .name('roadtripper')
  .description('Navigate Street View and capture time-lapse screenshots')
  .version('2.0.0')
  .showHelpAfterError()
  .configureOutput({
    writeErr: (str) => {
      if (str.includes('missing required argument')) {
        console.error('Error: Missing project path.');
        console.error('\nUsage:');
        console.error('  roadtripper plan <path>');
        console.error('  roadtripper navigate <path>');
        console.error('\nExample: roadtripper plan ./projects/N2/');
        console.error('\nRun "roadtripper --help" for more information.');
      } else {
        process.stderr.write(str);
      }
    }
  });

program
  .command('navigate <path>')
  .description('Navigate and capture screenshots for a project')
  .option('--debug', 'Open browser in debug mode with visible window and devtools')
  .option('--watch', 'Launch feh to watch incoming images')
  .action(async (projectPath, options) => {
    let watchProcess = null;

    const cleanup = () => {
      if (watchProcess && !watchProcess.killed) {
        watchProcess.kill();
      }
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    if (options.watch) {
      const imagesDir = path.join(path.resolve(projectPath), 'images');

      const waitForImages = () => new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout waiting for images')), 30000);
        const check = () => {
          const files = realFs.readdirSync(imagesDir).filter(f => f.match(/\.(jpg|jpeg|png)$/i));
          if (files.length > 0) {
            clearTimeout(timeout);
            resolve();
          } else {
            setTimeout(check, 500);
          }
        };
        check();
      });

      const navigatorPromise = mainNavigate({ projectPath, debug: options.debug });

      try {
        await waitForImages();
      } catch (err) {
        console.error('Error:', err.message);
        cleanup();
        process.exit(1);
      }

      watchProcess = spawn('feh', [
        '--sort', 'name',
        '--reload', '1',
        '--slideshow-delay', '1',
        '--on-last-slide', 'hold',
        '--geometry', '1024x768',
        '--scale-down',
        imagesDir
      ], {
        detached: true,
        stdio: 'ignore',
        cwd: imagesDir
      });
      watchProcess.unref();

      await navigatorPromise;
    } else {
      await mainNavigate({ projectPath, debug: options.debug });
    }

    cleanup();
    process.exit(0);
  });

const retakeCommand = new Command('retake');
retakeCommand
  .description('Retake a single screenshot for an existing image')
  .argument('<imagePath>', 'Path to the image file to retake')
  .option('--debug', 'Open browser in debug mode with visible window and devtools')
  .action(async (imagePath, options) => {
    const resolvedPath = path.resolve(imagePath);

    if (!realFs.existsSync(resolvedPath)) {
      console.error(`Error: Image file not found: ${resolvedPath}`);
      process.exit(1);
    }

    let projectPath = null;
    let currentDir = path.dirname(resolvedPath);
    while (currentDir !== path.parse(currentDir).root) {
      if (realFs.existsSync(path.join(currentDir, 'project.conf'))) {
        projectPath = currentDir;
        break;
      }
      currentDir = path.dirname(currentDir);
    }

    if (!projectPath) {
      console.error('Error: Image must be inside a project directory (project.conf not found)');
      process.exit(1);
    }

    const configPath = path.join(projectPath, 'project.conf');
    dotenv.config({ path: configPath, quiet: true });

    const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
    if (!API_KEY) {
      console.error('Error: GOOGLE_MAPS_API_KEY not found in project.conf');
      process.exit(1);
    }

    const retakeDelay = parseInt(process.env.NAVIGATOR_RETAKE_DELAY || '5000', 10);

    const parsed = parseImageFilename(path.basename(resolvedPath));
    if (!parsed) {
      console.error('Error: Could not parse image filename. Expected format: timestamp lat lng date pano heading.jpg');
      process.exit(1);
    }

    const project = {
      name: path.basename(projectPath),
      projectPath: projectPath + '/',
      imagePath: path.join(projectPath, 'images'),
      routeFile: path.join(projectPath, 'route.json'),
      stateFile: path.join(projectPath, 'navigator_state.json')
    };

    console.log(`Retaking: ${parsed.pano} at heading ${parsed.heading}`);
    await retakeImage(project, resolvedPath, parsed.pano, parsed.heading, { debug: options.debug, retakeDelay });

    console.log(`Retake complete: ${imagePath}`);
    process.exit(0);
  });

program.addCommand(retakeCommand);

program
  .command('plan <path>')
  .description('Open the route planner for a project')
  .action(async (projectPath) => {
    const nodeModulesPath = path.join(plannerPath, 'node_modules');

    if (!realFs.existsSync(nodeModulesPath)) {
      console.log('Installing planner dependencies...');
      try {
        execSync('npm install', { cwd: plannerPath, stdio: 'inherit' });
      } catch {
        console.error('Failed to install dependencies');
        process.exit(1);
      }
    }

    projectPath = path.resolve(projectPath);
    projectPath = projectPath.endsWith('/') ? projectPath : projectPath + '/';
    const configPath = path.join(projectPath, 'project.conf');
    if (!realFs.existsSync(configPath)) {
      console.error(`Error: project.conf not found in ${projectPath}`);
      console.error('Please create a project.conf file with your GOOGLE_MAPS_API_KEY');
      process.exit(1);
    }

    console.log(`Starting planner with project: ${path.basename(projectPath.slice(0, -1))}`);
    console.log('Starting planner at http://localhost:5173');
    const env = { ...process.env, PROJECT_PATH: projectPath };
    spawn('npm', ['run', 'dev'], {
      cwd: plannerPath,
      stdio: 'inherit',
      env
    });

    await open('http://localhost:5173');
  });

program.parse();
