async (page, baseUrl = 'http://127.0.0.1:8014') => {
  await page.evaluate(() => { location.hash = '/chat'; });
  await page.waitForFunction(() => !document.querySelector('#layout').hidden);
  await page.getByLabel('你的问题').fill('mean怎么用');
  await page.locator('#send').click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('无法连接本地服务'));
  if(await page.locator('#send').isDisabled())throw Error('Send button did not recover');
  return {passed:2,checks:['Connection failure reports unavailable service','Send button recovered']};
}
