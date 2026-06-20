import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('Navigating to preview server...');
    await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });

    // Wait for upload overlay and file input
    await page.waitForSelector('#file-input', { state: 'attached', timeout: 10000 });

    // Set file to upload (project contains Code Breaker.pdf)
    const filePath = 'F:\\TechVruk\\Code Breaker.pdf';
    console.log('Uploading sample PDF:', filePath);
    const input = await page.$('#file-input');
    await input.setInputFiles(filePath);

    // Wait for toast notification indicating extraction success or failure
    console.log('Waiting for extraction toast...');
    const toast = await page.waitForSelector('#toast-container .toast', { timeout: 30000 });
    const toastText = await toast.textContent();
    console.log('Toast:', toastText.trim());

    // Also check symbol count update
    await page.waitForFunction(() => {
      const el = document.getElementById('symbol-count');
      if (!el) return false;
      const n = parseInt(el.textContent || '0', 10);
      return n > 0;
    }, { timeout: 30000 });

    const symbolCount = await page.$eval('#symbol-count', el => el.textContent.trim());
    console.log('Symbol count:', symbolCount);

    console.log('Smoke test PASSED');
    await browser.close();
    process.exit(0);
  } catch (err) {
    console.error('Smoke test FAILED:', err);
    await browser.close();
    process.exit(2);
  }
})();
