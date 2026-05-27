const { chromium } = require('playwright');

(async () => {

  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage();

  await page.goto(
    'https://www.tunja-boyaca.gov.co/tema/noticias',
    {
      waitUntil: 'networkidle'
    }
  );

  await page.waitForTimeout(5000);

  const noticias = await page.evaluate(() => {

    const usados = new Set();

    return [...document.querySelectorAll('a')]
  .map(a => {

    const titulo = a.innerText
      .replace(/\n/g, ' ')
      .replace(/\r/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const enlace = a.href;

    // Buscar imagen
    let img =
      a.querySelector('img') ||
      a.parentElement?.querySelector('img') ||
      a.parentElement?.parentElement?.querySelector('img');

    let imagen = '';

    if (img) {
      imagen =
        img.src ||
        img.dataset.src ||
        img.getAttribute('data-src') ||
        '';
    }

    // Buscar descripción cercana
    let descripcion = '';

    const posiblesTextos = [
      a.parentElement?.innerText,
      a.parentElement?.parentElement?.innerText,
      a.parentElement?.parentElement?.parentElement?.innerText
    ];

    for (const texto of posiblesTextos) {

      if (!texto) continue;

      const limpio = texto
        .replace(/\n/g, ' ')
        .replace(/\r/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      // Buscar texto más largo que el título
      if (
        limpio.length > titulo.length + 20 &&
        limpio.length < 400
      ) {

        descripcion = limpio
          .replace(titulo, '')
          .trim();

        break;
      }
    }

    return {
      titulo,
      enlace,
      imagen,
      descripcion
    };
  })

  console.log(noticias);

  await fetch(process.env.WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(noticias)
  });

  await browser.close();

})();
