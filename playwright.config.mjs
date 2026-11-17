import {defineConfig,devices} from '@playwright/test';
export default defineConfig({testDir:'./tests/browser',fullyParallel:false,workers:1,timeout:30000,
 use:{baseURL:'http://127.0.0.1:4173',serviceWorkers:'block',trace:'retain-on-failure'},
 webServer:{command:'npm run serve',url:'http://127.0.0.1:4173',reuseExistingServer:true},
 projects:[{name:'chromium-mobile',use:{...devices['iPhone 13'],defaultBrowserType:'chromium'}},{name:'webkit-tablet',use:{...devices['iPad (gen 7)'],defaultBrowserType:'webkit',launchOptions:process.env.TR_WEBKIT_EXECUTABLE?{executablePath:process.env.TR_WEBKIT_EXECUTABLE}:{}}}]
});
