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

    // 3. Extraer la descripción del cuerpo de la noticia
    const noticiasFinal = [];
    for (const noticia of noticiasBase.slice(0, 10)) {
      try {
        console.log(`Procesando: ${noticia.enlace}`);
        await page.goto(noticia.enlace, { waitUntil: 'domcontentloaded', timeout: 25000 });
        await page.waitForTimeout(1500);

        const descripcion = await page.evaluate(() => {
          // ESTRATEGIA 1: Metaetiqueta OpenGraph (og:description)
          const metaOg = document.querySelector('meta[property="og:description"]')?.content;
          if (metaOg && metaOg.trim().length > 25 && !metaOg.includes('La alcaldía de Tunja es una entidad')) {
            return metaOg.trim();
          }

          // ESTRATEGIA 2: Párrafos dentro del contenedor del artículo
          const contenedor = document.querySelector('.field--name-body') || 
                             document.querySelector('.node__content') || 
                             document.querySelector('article') || 
                             document.body;

          const parrafos = [...contenedor.querySelectorAll('p, div.field__item')]
            .map(p => p.innerText.replace(/\s+/g, ' ').trim())
            .filter(texto => {
              if (texto.length < 40) return false;
              if (texto.includes('La alcaldía de Tunja es una entidad')) return false;
              if (/Youtube|Twitter|Facebook|Boletín|Derechos reservados/i.test(texto)) return false;
              return true;
            });

          if (parrafos.length > 0) return parrafos[0];

          // ESTRATEGIA 3: Fallback de texto libre (extrae la primera frase con sentido si no hay párrafos estándar)
          const textoCompleto = contenedor.innerText.replace(/\s+/g, ' ').trim();
          const frases = textoCompleto.split(/\.\s+/).filter(f => f.length > 40 && f.length < 300);
          return frases.length > 0 ? (frases[0] + '.') : 'Descripción no disponible';
        });

        // Muestra en consola hasta 80 caracteres para verificar que traiga texto real
        console.log(`  -> Desc: "${descripcion.substring(0, 80)}..."`);

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

    // 4. Enviar datos al Webhook de Google Apps Script
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
