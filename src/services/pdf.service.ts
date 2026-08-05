import puppeteer, { type Browser } from 'puppeteer'
import { getEnv } from '../config/env.js'
import { wrapTinyMceHtml } from '../lib/html-wrap.js'
import { sanitizeGeneratedHtml } from '../lib/sanitize-html.js'

let browserInstance: Browser | null = null

async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.connected) return browserInstance
  const { PUPPETEER_EXECUTABLE_PATH } = getEnv()
  browserInstance = await puppeteer.launch({
    headless: true,
    ...(PUPPETEER_EXECUTABLE_PATH && { executablePath: PUPPETEER_EXECUTABLE_PATH }),
    args: [
      // Chromium's namespace sandbox needs unprivileged user namespaces, which
      // Docker's default seccomp profile blocks — without this flag the browser
      // fails to launch. Two things limit the blast radius instead: the
      // container runs as the non-root `node` user (see Dockerfile) and every
      // page request other than data:/about:blank is aborted below.
      // To actually drop the flag: run with a seccomp profile that permits
      // clone(CLONE_NEWUSER), then remove both sandbox args and smoke-test.
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
    // The wrapped TinyMCE HTML must render self-contained (inline styles +
    // data: images). Block every other request so attacker-controlled markup
    // cannot make the renderer fetch remote http(s) resources (SSRF/exfil).
    await page.setRequestInterception(true)
    page.on('request', (request) => {
      const url = request.url()
      if (url === 'about:blank' || url.startsWith('data:')) {
        void request.continue()
      } else {
        void request.abort()
      }
    })

    const safeBody = sanitizeGeneratedHtml(html)
    // 'load' (not 'domcontentloaded') so inline data: images finish decoding
    // before page.pdf() snapshots. Remote requests are aborted above, so this
    // cannot hang on a slow third-party host.
    await page.setContent(wrapTinyMceHtml(safeBody), { waitUntil: 'load' })
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
