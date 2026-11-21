// Renders a one-page PDF through the image's own compiled renderer (render-pdf.js, the code path
// every invoice PDF takes) and checks the result is a PDF. Run inside the image by docker-smoke.yml,
// from /usr/share/nginx/backend/src. Prints which Chromium sandbox mode was asked for.
const { renderPdf, resolveChromiumSandboxMode } = require(
  `${process.cwd()}/modules/documents/rendering/render-pdf.js`,
);

const mode = resolveChromiumSandboxMode();
renderPdf('<html><body><h1>Invoicerr smoke test</h1></body></html>')
  .then((pdf) => {
    const header = pdf.subarray(0, 5).toString();
    console.log(`uid=${process.getuid()} CHROMIUM_SANDBOX=${mode} -> ${header} (${pdf.length} bytes)`);
    process.exit(header === '%PDF-' ? 0 : 1);
  })
  .catch((err) => {
    console.error(`uid=${process.getuid()} CHROMIUM_SANDBOX=${mode} -> render failed: ${err.message}`);
    process.exit(1);
  });
