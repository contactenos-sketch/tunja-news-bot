const { chromium } = require('playwright');

(async () => {

  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage();

  // Abrir portal de noticias
  await page.goto(
    'https://www.tunja-boyaca.gov.co/tema/noticias',
    {
      waitUntil: 'networkidle'
    }
  );

  // Esperar renderizado JS
  await page.waitForTimeout(5000);

  // Obtener noticias base
  const noticiasBase = await page.evaluate(() => {

    const usados = new Set();

    return [...document.querySelectorAll('a[href*="/noticias/"]')]
      .map(a => {

        const titulo = a.innerText
          .replace(/\n/g, ' ')
          .replace(/\r/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        const enlace = a.href;

        // Buscar imagen cercana
        let img =
          a.querySelector('img') ||
          a.parentElement?.querySelector('img') ||
          a.parentElement?.parentElement?.querySelector('img') ||
          a.parentElement?.parentElement?.parentElement?.querySelector('img');

        let imagen = '';

        if (img) {

          imagen =
            img.src ||
            img.dataset.src ||
            img.getAttribute('data-src') ||
            '';

        }

        return {
          titulo,
          enlace,
          imagen
        };

      })
      .filter(n => {

        // Validar enlace noticia
        if (!n.enlace.includes('/noticias/'))
          return false;

        // Validar título
        if (n.titulo.length < 10)
          return false;

        if (n.titulo.length > 180)
          return false;

        // Eliminar basura
        if (
          n.titulo.includes('Noticias') ||
          n.titulo.includes('am') ||
          n.titulo.includes('pm')
        )
          return false;

        // Evitar duplicados
        if (usados.has(n.enlace))
          return false;

        usados.add(n.enlace);

        return true;

      });

  });

  const noticiasFinal = [];

  // Entrar a cada noticia
  for (const noticia of noticiasBase) {

    try {

      const noticiaPage = await browser.newPage();

      await noticiaPage.goto(
        noticia.enlace,
        {
          waitUntil: 'networkidle'
        }
      );

      await noticiaPage.waitForTimeout(3000);

      // Extraer párrafo introductorio
      const descripcion = await noticiaPage.evaluate(() => {

  const parrafos = [
    ...document.querySelectorAll('p')
  ]
  .map(p => p.innerText.trim())
  .filter(t =>

    t.length > 80 &&
    t.length < 400 &&

    !t.includes('Youtube:') &&
    !t.includes('Soundcloud:') &&
    !t.includes('Twitter:') &&
    !t.includes('Facebook:') &&
    !t.includes('Instagram:') &&
    !t.includes('TikTok:') &&
    !t.includes('Issuu:') &&
    !t.includes('Descarga boletín')

  );

  // Buscar el primer párrafo válido REAL
  return parrafos.find(t =>
    t.includes('.') &&
    t.split(' ').length > 10
  ) || '';

});

      noticiasFinal.push({
        titulo: noticia.titulo,
        enlace: noticia.enlace,
        imagen: noticia.imagen,
        descripcion: descripcion
      });

      await noticiaPage.close();

    } catch(err) {

      console.log(
        'Error noticia:',
        noticia.enlace
      );

    }

  }

  // DEBUG
  console.log(
    JSON.stringify(
      noticiasFinal,
      null,
      2
    )
  );

  // Enviar a Apps Script
  await fetch(process.env.WEBHOOK_URL, {

    method: 'POST',

    headers: {
      'Content-Type': 'application/json'
    },

    body: JSON.stringify(noticiasFinal)

  });

  console.log('Noticias enviadas correctamente');

  await browser.close();

})();
