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

  // Obtener noticias básicas
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

        return {
          titulo,
          enlace,
          imagen
        };

      })
      .filter(n => {

        if (!n.enlace.includes('/noticias/'))
          return false;

        if (n.titulo.length < 10)
          return false;

        if (n.titulo.length > 120)
          return false;

        if (
          n.titulo.includes('Noticias') ||
          n.titulo.includes('am') ||
          n.titulo.includes('pm')
        )
          return false;

        if (usados.has(n.enlace))
          return false;

        usados.add(n.enlace);

        return true;

      });

  });

  // Entrar a cada noticia y sacar primer párrafo
  const noticiasFinal = [];

  for (const noticia of noticiasBase) {

    try {

      const noticiaPage = await browser.newPage();

      await noticiaPage.goto(noticia.enlace, {
        waitUntil: 'networkidle'
      });

      await noticiaPage.waitForTimeout(3000);

      const descripcion = await noticiaPage.evaluate(() => {

  const parrafos = [
    ...document.querySelectorAll('p')
  ]
  .map(p => p.innerText.trim())
  .filter(t =>
    t.length > 50 &&
    t.length < 500 &&
    !t.includes('Youtube:') &&
    !t.includes('Soundcloud:') &&
    !t.includes('Twitter:') &&
    !t.includes('Facebook:') &&
    !t.includes('Instagram:')
  );

  return parrafos[1] || parrafos[0] || '';

});

noticiasFinal.push({
  ...noticia,
  descripcion
});

console.log({
  titulo: noticia.titulo,
  descripcion: descripcion
});

await noticiaPage.close();
  await fetch(process.env.WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(noticiasFinal)
  });

  await browser.close();

})();
