import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 }
  });

  const page = await context.newPage();

  try {
    console.log('1. Navegando al enlace de noticias oficial...');

    await page.goto('https://www.tunja-boyaca.gov.co/tema/noticias', {
      waitUntil: 'networkidle',
      timeout: 45000
    });

    await page.waitForTimeout(3000);

    // 2. Extraer los enlaces de las noticias
    const noticiasBase = await page.evaluate(() => {
      const usados = new Set();
      
      const enlaces = [...document.querySelectorAll('a')].filter(a => {
        const href = a.href || '';
        return href.includes('/noticias/') && !href.endsWith('/tema/noticias');
      });

      return enlaces.map(a => {
        let titulo = a.innerText.replace(/\s+/g, ' ').trim();
        const enlace = a.href;

        if (titulo.length < 10) {
          const card = a.closest('.card, .views-row, .item, div');
          const heading = card?.querySelector('h1, h2, h3, h4, .titulo');
          if (heading) titulo = heading.innerText.replace(/\s+/g, ' ').trim();
        }

        let img = a.querySelector('img') || a.parentElement?.querySelector('img');
        let imagen = img ? (img.src || img.getAttribute('data-src') || '') : '';

        return { titulo, enlace, imagen };
      }).filter(n => {
        if (n.titulo.length < 10 || usados.has(n.enlace)) return false;
        usados.add(n.enlace);
        return true;
      });
    });

    console.log(`Noticias encontradas en la página: ${noticiasBase.length}`);

    // 3. Extraer la descripción REAL del cuerpo de la noticia
    const noticiasFinal = [];
    for (const noticia of noticiasBase.slice(0, 10)) {
      try {
        console.log(`Procesando: ${noticia.enlace}`);
        await page.goto(noticia.enlace, { waitUntil: 'domcontentloaded', timeout: 25000 });
        await page.waitForTimeout(1500);

        const descripcion = await page.evaluate(() => {
          // ESTRATEGIA 1: Metaetiqueta OpenGraph específica (og:description suele traer el resumen real)
          const metaOg = document.querySelector('meta[property="og:description"]')?.content;
          if (metaOg && metaOg.trim().length > 30 && !metaOg.includes('La alcaldía de Tunja es una entidad')) {
            return metaOg.trim();
          }

          // ESTRATEGIA 2: Extraer directamente de los párrafos del cuerpo del artículo (Evitando footers y menus)
          const contenedorNoticia = document.querySelector('.field--name-body') || 
                                    document.querySelector('.node__content') || 
                                    document.querySelector('article') || 
                                    document.body;

          const parrafos = [...contenedorNoticia.querySelectorAll('p')]
            .map(p => p.innerText.replace(/\s+/g, ' ').trim())
            .filter(texto => {
              if (texto.length < 40) return false;
              if (texto.includes('La alcaldía de Tunja es una entidad')) return false; // Filtrar texto genérico del sitio
              if (/Youtube|Twitter|Facebook|Boletín|Derechos reservados/i.test(texto)) return false;
              return true;
            });

          return parrafos.length > 0 ? parrafos[0] : '';
        });

        console.log(`  -> Desc: "${descripcion.substring(0, 50)}..."`);

        noticiasFinal.push({
          titulo: noticia.titulo,
          enlace: noticia.enlace,
          imagen: noticia.imagen,
          descripcion: descripcion
        });

      } catch (err) {
        console.log(`Error abriendo ${noticia.enlace}: ${err.message}`);
      }
    }

    console.log(`Total final procesadas: ${noticiasFinal.length}`);

    // 4. Enviar datos al Webhook
    const webhookUrl = process.env.WEBHOOK_URL;
    if (webhookUrl && noticiasFinal.length > 0) {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(noticiasFinal)
      });
      console.log(`Estado HTTP de Apps Script: ${res.status}`);
    }

  } catch (error) {
    console.error('Error durante la ejecución:', error.message);
  } finally {
    await browser.close();
  }
})();
