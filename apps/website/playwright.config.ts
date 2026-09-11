import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./e2e/browser',fullyParallel:false,workers:1,timeout:60000,expect:{timeout:30000},reporter:[['list'],['json',{outputFile:'e2e-artifacts/browser-results.json'}]],outputDir:'e2e-artifacts/browser',
 use:{baseURL:'http://localhost:4101',channel:'msedge',headless:true,trace:'retain-on-failure',screenshot:'only-on-failure'},
 projects:[{name:'desktop',use:{viewport:{width:1920,height:1080}}},{name:'small-android',use:{viewport:{width:360,height:640},hasTouch:true,isMobile:true}},{name:'tablet',use:{viewport:{width:1024,height:768},hasTouch:true}},{name:'mobile-manager',use:{viewport:{width:390,height:844},hasTouch:true,isMobile:true}}],
 webServer:[{command:'node e2e/fixtures/server.mjs',url:'http://127.0.0.1:4901/health',reuseExistingServer:false},{command:'node node_modules/next/dist/bin/next start -p 4101',url:'http://localhost:4101/operator/login',env:{OPA_API_URL:'http://127.0.0.1:4901'},reuseExistingServer:false,timeout:120000}]
});
