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

    // Ir a la URL exacta indicada
    await page.goto('https://www.tunja-boyaca.gov.co/tema/noticias', {
      waitUntil: 'networkidle', // Esperar a que las peticiones de red finalicen
      timeout: 45000
    });

    // Esperar explícitamente 3 segundos a que los bloques dinámicos inyecten las noticias en el DOM
    await page.waitForTimeout(3000);

    // 2. Extraer los enlaces de las noticias cargadas
    const noticiasBase = await page.evaluate(() => {
      const usados = new Set();
      
      // Buscar todos los enlaces dentro del área principal de noticias
      const enlaces = [...document.querySelectorAll('a')].filter(a => {
        const href = a.href || '';
        return href.includes('/noticias/') && !href.endsWith('/tema/noticias');
      });

      return enlaces.map(a => {
        let titulo = a.innerText.replace(/\s+/g, ' ').trim();
        const enlace = a.href;

        // Si el enlace no tiene texto (ej. es solo la imagen clickeable), buscar el título en la tarjeta
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

    // 3. Obtener la descripción entrando a cada una
    const noticiasFinal = [];
    for (const noticia of noticiasBase.slice(0, 10)) {
      try {
        console.log(`Procesando: ${noticia.enlace}`);
        await page.goto(noticia.enlace, { waitUntil: 'domcontentloaded', timeout: 25000 });
        await page.waitForTimeout(1500);

        const descripcion = await page.evaluate(() => {
          // Extraer metaetiqueta o primer párrafo con texto continuo
          const meta = document.querySelector('meta[property="og:description"]')?.content ||
                     document.querySelector('meta[name="description"]')?.content;
          
          if (meta && meta.trim().length > 25) return meta.trim();

          const parrafos = [...document.querySelectorAll('.field--name-body p, article p, p')]
            .map(p => p.innerText.replace(/\s+/g, ' ').trim())
            .filter(t => t.length > 40 && !/Youtube|Twitter|Facebook|Boletín/i.test(t));

          return parrafos.length > 0 ? parrafos[0] : '';
        });

        console.log(`  -> Desc: "${descripcion.substring(0, 45)}..."`);

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
