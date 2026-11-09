import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  // Contexto simulando un navegador Chrome real en Windows
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
    locale: 'es-CO',
    timezoneId: 'America/Bogota'
  });

  const page = await context.newPage();

  // Ocultar banderas de automatización frente al servidor
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  try {
    console.log('1. Navegando a la lista de noticias...');
    const response = await page.goto('https://www.tunja-boyaca.gov.co/tema/noticias', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    console.log(`Estado de respuesta HTTP: ${response ? response.status() : 'Sin respuesta'}`);

    // Esperar explícitamente a que carguen los enlaces en la página
    try {
      await page.waitForSelector('a[href*="/noticias/"]', { timeout: 10000 });
      console.log('Selector de enlaces detectado correctamente.');
    } catch (e) {
      console.log('Timeout: El selector a[href*="/noticias/"] no apareció a tiempo.');
    }

    // Intentar presionar el botón "Cargar más"
    for (let i = 0; i < 3; i++) {
      try {
        const boton = page.locator('text=CARGAR MÁS CONTENIDO');
        if (await boton.isVisible()) {
          await boton.click();
          console.log(`Cargando más contenido (${i + 1}/3)...`);
          await page.waitForTimeout(2500);
        } else {
          break;
        }
      } catch (err) {
        break;
      }
    }

    // 2. Extracción de noticias base
    console.log('2. Extrayendo enlaces de noticias...');
    const noticiasBase = await page.evaluate(() => {
      const usados = new Set();

      // Busca enlaces que contengan /noticias/ o estén dentro del bloque principal de artículos
      const enlaces = [...document.querySelectorAll('a[href*="/noticias/"]')];

      return enlaces
        .map(a => {
          let titulo = a.innerText.replace(/\s+/g, ' ').trim();
          const enlace = a.href;

          if (titulo.length < 10 || /de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/i.test(titulo)) {
            const contenedor = a.closest('.card') || a.parentElement?.parentElement || a;
            const hReal = contenedor.querySelector('h3, h4, h2, [class*="titulo"]');
            if (hReal) titulo = hReal.innerText.replace(/\s+/g, ' ').trim();
          }

          let img = a.querySelector('img') || a.parentElement?.querySelector('img') || a.parentElement?.parentElement?.querySelector('img');
          let imagen = img ? (img.src || img.dataset.src || img.getAttribute('data-src') || '') : '';

          return { titulo, enlace, imagen };
        })
        .filter(n => {
          if (!n.enlace.includes('/noticias/')) return false;
          if (n.titulo.length < 10 || n.titulo.length > 250) return false;
          if (n.titulo.includes('Noticias') || n.titulo.toLowerCase() === 'tunja, boyacá') return false;
          if (usados.has(n.enlace)) return false;
          usados.add(n.enlace);
          return true;
        });
    });

    console.log(`Total noticias base encontradas: ${noticiasBase.length}`);

    if (!noticiasBase || noticiasBase.length === 0) {
      console.log('No se encontraron noticias. Tomando captura para diagnóstico...');
      // Muestra el título de la página abierta para verificar si fue bloqueada por Cloudflare / 403
      const tituloPagina = await page.title();
      console.log(`Título de la página cargada: "${tituloPagina}"`);
      await browser.close();
      return;
    }

    // 3. Extracción de descripciones
    const noticiasFinal = [];
    const listaNoticias = noticiasBase.slice(0, 10);

    for (const noticia of listaNoticias) {
      try {
        console.log(`Procesando: ${noticia.enlace}`);

        await page.goto(noticia.enlace, {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });

        try {
          await page.waitForSelector('.field--name-body, article, .contenido-noticia, p', { timeout: 4000 });
        } catch (e) {}

        const descripcion = await page.evaluate(() => {
          const metaOg = document.querySelector('meta[property="og:description"]')?.content;
          if (metaOg && metaOg.trim().length > 20) return metaOg.trim();

          const metaDesc = document.querySelector('meta[name="description"]')?.content;
          if (metaDesc && metaDesc.trim().length > 20) return metaDesc.trim();

          const contenedores = [
            document.querySelector('.field--name-body'),
            document.querySelector('.field--name-field-lead'),
            document.querySelector('article'),
            document.querySelector('.node__content'),
            document.body
          ];

          for (const c of contenedores) {
            if (!c) continue;
            const elementos = [...c.querySelectorAll('p, div.field__item, div')]
              .map(el => el.innerText.replace(/\s+/g, ' ').trim())
              .filter(t =>
                t.length > 40 &&
                t.length < 600 &&
                !/Youtube:|Soundcloud:|Twitter:|Facebook:|Instagram:|TikTok:|Descarga|Boletín/i.test(t)
              );

            if (elementos.length > 0) return elementos[0];
          }

          const textoGeneral = document.body.innerText.replace(/\s+/g, ' ').trim();
          const frases = textoGeneral.split(/\.\s+/).filter(f => f.length > 40 && f.length < 300);
          return frases.length > 0 ? (frases[0] + '.') : '';
        });

        console.log(`-> Descripción: "${descripcion.substring(0, 50)}..."`);

        noticiasFinal.push({
          titulo: noticia.titulo,
          enlace: noticia.enlace,
          imagen: noticia.imagen,
          descripcion: descripcion
        });

      } catch (err) {
        console.log(`Fallo al procesar noticia ${noticia.enlace}:`, err.message);
      }
    }

    console.log(`Procesadas exitosamente: ${noticiasFinal.length}`);

    // 4. Envío al Webhook de Google Apps Script
    const webhookUrl = process.env.WEBHOOK_URL;
    if (webhookUrl && noticiasFinal.length > 0) {
      const resp = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(noticiasFinal)
      });
      console.log(`Noticias enviadas. Estado HTTP del Webhook: ${resp.status}`);
    } else {
      console.log('No se enviaron datos (lista vacía o la variable WEBHOOK_URL no está configurada).');
    }

  } catch (errGen) {
    console.error('Error general durante la ejecución:', errGen.message);
  } finally {
    await browser.close();
  }
})();
