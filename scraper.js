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

    const resultados = [];

    // Buscar posibles tarjetas de noticias
    const cards = document.querySelectorAll(
      'article, .card, .views-row, .news-item, .view-content > div'
    );

    cards.forEach(card => {

      // Buscar enlace noticia
      const link = card.querySelector('a[href*="/noticias/"]');

      if (!link) return;

      const enlace = link.href;

      if (usados.has(enlace)) return;

      usados.add(enlace);

      // Buscar título
      let titulo = '';

      const posiblesTitulos = [
        card.querySelector('h1'),
        card.querySelector('h2'),
        card.querySelector('h3'),
        card.querySelector('h4'),
        link
      ];

      for (const el of posiblesTitulos) {

        if (el?.innerText?.trim()) {

          titulo = el.innerText
            .replace(/\n/g, ' ')
            .replace(/\r/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

          if (titulo.length > 10) break;
        }
      }

      // Buscar descripción
      let descripcion = '';

      const posiblesDescripciones = [
        card.querySelector('p'),
        card.querySelector('.summary'),
        card.querySelector('.description'),
        card.querySelector('.field-content'),
        card.querySelector('.views-field-body')
      ];

      for (const el of posiblesDescripciones) {

        if (el?.innerText?.trim()) {

          descripcion = el.innerText
            .replace(/\n/g, ' ')
            .replace(/\r/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

          if (
            descripcion.length > 30 &&
            descripcion !== titulo
          ) {
            break;
          }
        }
      }

      // Buscar imagen
      let imagen = '';

      const img = card.querySelector('img');

      if (img) {

        imagen =
          img.src ||
          img.dataset.src ||
          img.getAttribute('data-src') ||
          '';
      }

      // Validaciones
      if (!titulo) return;

      resultados.push({
        titulo,
        enlace,
        imagen,
        descripcion
      });

    });

    return resultados;

  });

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
