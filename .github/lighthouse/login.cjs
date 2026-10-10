// Runs before each audited URL (`lhci collect --puppeteerScript`): signs the shared browser in once,
// so Lighthouse then loads every page with a real session.
const attempt = async (page, origin) => {
  await page.goto(`${origin}/auth/sign-in`, { waitUntil: 'networkidle0' })
  if (!new URL(page.url()).pathname.startsWith('/auth/sign-in')) return
  await page.waitForSelector('[data-cy="auth-email-input"]')
  await page.type('[data-cy="auth-email-input"]', process.env.LH_EMAIL)
  await page.type('[data-cy="auth-password-input"]', process.env.LH_PASSWORD)
  await Promise.all([
    page.waitForFunction(() => location.pathname.startsWith('/dashboard'), { timeout: 30000 }),
    page.click('[data-cy="auth-submit-btn"]'),
  ])
}

module.exports = async function login(browser, context) {
  const origin = new URL(context.url).origin
  const page = await browser.newPage()
  try {
    for (let i = 1; ; i += 1) {
      try {
        await attempt(page, origin)
        return
      } catch (error) {
        console.error(`login attempt ${i} failed at ${page.url()}: ${error.message}`)
        if (i === 3) throw error
      }
    }
  } finally {
    await page.close()
  }
}
