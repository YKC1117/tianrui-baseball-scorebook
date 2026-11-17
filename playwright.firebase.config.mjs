import base from './playwright.config.mjs';
import {defineConfig,devices} from '@playwright/test';
export default defineConfig({...base,testDir:'./tests/firebase-browser',outputDir:'./test-results-firebase',timeout:120000,expect:{timeout:15000},
 use:{...base.use,baseURL:'http://127.0.0.1:4175'},
 projects:[...base.projects,{name:'chromium-tablet',use:{...devices['iPad (gen 7)'],defaultBrowserType:'chromium'}},{name:'chromium-desktop',use:{browserName:'chromium',viewport:{width:1440,height:1000}}},{name:'webkit-phone',use:{...devices['iPhone 13'],launchOptions:process.env.TR_WEBKIT_EXECUTABLE?{executablePath:process.env.TR_WEBKIT_EXECUTABLE}:{}}}],
 webServer:{command:'node tests/support/firebase-server.mjs',url:'http://127.0.0.1:4175',reuseExistingServer:false}});
