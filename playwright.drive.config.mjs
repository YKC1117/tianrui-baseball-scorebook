import {defineConfig,devices} from '@playwright/test';
const webkit=process.env.TR_WEBKIT_EXECUTABLE?{executablePath:process.env.TR_WEBKIT_EXECUTABLE}:{};
export default defineConfig({testDir:'./tests/drive-browser',outputDir:'test-results-drive',workers:1,fullyParallel:false,timeout:90000,use:{baseURL:'http://127.0.0.1:4192',trace:'retain-on-failure',serviceWorkers:'block'},webServer:{command:'python3 -m http.server 4192 --bind 127.0.0.1 --directory dist-drive',url:'http://127.0.0.1:4192',reuseExistingServer:!process.env.CI},projects:[
 {name:'chromium-phone',use:{...devices['iPhone 13'],viewport:{width:390,height:844},defaultBrowserType:'chromium'}},
 {name:'chromium-tablet',use:{...devices['iPad (gen 7)'],viewport:{width:834,height:1112},defaultBrowserType:'chromium'}},
 {name:'chromium-desktop',use:{browserName:'chromium',viewport:{width:1440,height:1000}}},
 {name:'webkit-phone',use:{...devices['iPhone 13'],viewport:{width:390,height:844},launchOptions:webkit}},
 {name:'webkit-tablet',use:{...devices['iPad (gen 7)'],viewport:{width:834,height:1112},launchOptions:webkit}}
]});
