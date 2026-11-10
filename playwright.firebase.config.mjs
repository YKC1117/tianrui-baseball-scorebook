import base from './playwright.config.mjs';
import {defineConfig} from '@playwright/test';
export default defineConfig({...base,testDir:'./tests/firebase-browser',outputDir:'./test-results-firebase',timeout:90000,
 use:{...base.use,baseURL:'http://127.0.0.1:4175'},
 webServer:{command:'node tests/support/firebase-server.mjs',url:'http://127.0.0.1:4175',reuseExistingServer:false}});
