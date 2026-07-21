import puppeteer, { type Browser } from 'puppeteer'
import { getEnv } from '../config/env.js'
import { wrapTinyMceHtml } from '../lib/html-wrap.js'

let browserInstance: Browser | null = null

async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.connected) return browserInstance
  const { PUPPETEER_EXECUTABLE_PATH } = getEnv()
  browserInstance = await puppeteer.launch({
    headless: true,
    ...(PUPPETEER_EXECUTABLE_PATH && { executablePath: PUPPETEER_EXECUTABLE_PATH }),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      // Containers without a GPU/zygote-friendly environment: Chromium can
      // crash at startup (exit code null) without these
      '--disable-gpu',
      '--no-zygote',
      '--disable-crash-reporter',
    ],
  })
  browserInstance.once('disconnected', () => {
    browserInstance = null
  })
  return browserInstance
}

export async function generatePdfFromHtml(html: string): Promise<Buffer> {
  const browser = await getBrowser()
  const page = await browser.newPage()
  try {
    await page.setContent(wrapTinyMceHtml(html), { waitUntil: 'load' })
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '2cm', right: '2cm', bottom: '2cm', left: '3cm' },
    })
    return Buffer.from(pdf)
  } finally {
    await page.close()
  }
}
