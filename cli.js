#!/usr/bin/env node
import { Command } from 'commander';
import { spawn, execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import open from 'open';
import * as realFs from 'fs';

import { mainNavigate } from './navigator/index.js';

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
        console.error('\nUsage: roadtripper navigate <path>');
        console.error('\nExample: roadtripper navigate ./projects/N2/');
        console.error('\nRun "roadtripper --help" for more information.');
      } else {
        process.stderr.write(str);
      }
    }
  });

program
  .command('navigate <path>')
  .description('Navigate and capture screenshots for a project')
  .action(async (projectPath) => {
    await mainNavigate({ projectPath });
    process.exit(0);
  });

program
  .command('plan')
  .description('Open the route planner')
  .action(async () => {
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

    console.log('Starting planner at http://localhost:5173');
    spawn('npm', ['run', 'dev'], {
      cwd: plannerPath,
      stdio: 'inherit',
      shell: true
    });

    await open('http://localhost:5173');
  });

program.parse();
