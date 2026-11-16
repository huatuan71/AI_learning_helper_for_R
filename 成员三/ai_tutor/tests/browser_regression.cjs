// Run each existing browser suite in its own temporary storage context.
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

async function main() {
  fs.mkdirSync('output/playwright', {recursive:true});
  const browser = await chromium.launch({headless:true});
  const results = [];
  try {
    for (const name of ['browser_check','browser_ai','browser_map_files','browser_glass_ui','browser_mobile_map','browser_scene_probe','browser_scene_motion','browser_offline','browser_learning_layout']) {
      const context = await browser.newContext({viewport:name==='browser_mobile_map'?{width:390,height:844}:{width:1440,height:1000},hasTouch:name==='browser_mobile_map',isMobile:name==='browser_mobile_map',timezoneId:'Asia/Shanghai'});
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      const base = name === 'browser_ai' ? process.env.AI_BASE_URL || 'http://127.0.0.1:8015' : process.env.BASE_URL || 'http://127.0.0.1:8014';
      try {
        await page.goto(base);
        await page.waitForFunction(() => document.querySelectorAll('.knowledge-orb').length === 43);
        if (name === 'browser_offline') {
          await context.route('**/api/**', route => route.abort('connectionrefused'));
        }
        const run = eval('(' + fs.readFileSync(path.join(__dirname,name+'.js'),'utf8') + ')');
        const result = await run(page,base);
        results.push({name,...result});
        console.log(name,JSON.stringify(result));
      } catch (error) {
        results.push({name,error:error.message});
        console.error(name,error);
        await page.screenshot({path:'output/playwright/'+name+'-failure.png',fullPage:true});
        process.exitCode = 1;
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
  fs.writeFileSync('output/playwright/regression-results.json', JSON.stringify({browser:browser.version(),results},null,2));
}
main().catch(error => {console.error(error);process.exitCode=1;});
