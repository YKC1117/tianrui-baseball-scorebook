import {defineConfig,devices} from '@playwright/test';
const webkitLaunch=process.env.TR_WEBKIT_EXECUTABLE?{executablePath:process.env.TR_WEBKIT_EXECUTABLE}:{};
export default defineConfig({testDir:'./tests/ui-browser',outputDir:'./test-results-ui',workers:1,fullyParallel:false,timeout:45000,
 use:{baseURL:'http://127.0.0.1:4180',serviceWorkers:'block',trace:'retain-on-failure'},
 webServer:{command:'python3 -m http.server 4180 --bind 127.0.0.1 --directory dist-ui',url:'http://127.0.0.1:4180',reuseExistingServer:!process.env.CI},
 projects:[
  {name:'chromium-phone',use:{...devices['iPhone 13'],viewport:{width:390,height:844},defaultBrowserType:'chromium'}},
  {name:'chromium-tablet',use:{...devices['iPad (gen 7)'],viewport:{width:834,height:1112},defaultBrowserType:'chromium'}},
  {name:'chromium-desktop',use:{browserName:'chromium',viewport:{width:1440,height:1000}}},
  {name:'webkit-phone',use:{...devices['iPhone 13'],viewport:{width:390,height:844},launchOptions:webkitLaunch}},
  {name:'webkit-tablet',use:{...devices['iPad (gen 7)'],viewport:{width:834,height:1112},launchOptions:webkitLaunch}}
 ]});
