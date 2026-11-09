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

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
    locale: 'es-CO',
    timezoneId: 'America/Bogota'
  });

  const page = await context.newPage();

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  try {
    console.log('1. Navegando a la sección de noticias...');

    // Rutas alternativas en caso de redirección al Home
    const urlsPrueba = [
      'https://www.tunja-boyaca.gov.co/noticias',
      'https://www.tunja-boyaca.gov.co/tema/noticias',
      'https://www.tunja-boyaca.gov.co/transparencia/prensa/noticias'
    ];

    let navegacionExitosa = false;
    for (const url of urlsPrueba) {
      console.log(`Intentando acceder a: ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);

      const titulo = await page.title();
      console.log(`  -> Título actual: "${titulo}"`);

      // Verificar si no nos mandó a la portada genérica
      if (!titulo.includes('entidad del sector público') || url.includes('/noticias')) {
        navegacionExitosa = true;
        break;
      }
    }

    // Intentar hacer click en "CARGAR MÁS" si existe
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

    // 2. Extracción de enlaces con selectores ampliados (Drupal / MiColombiaDigital)
    console.log('2. Extrayendo noticias base...');
    const noticiasBase = await page.evaluate(() => {
      const usados = new Set();
      
      // Capturar cualquier enlace relativo/absoluto que apunte a noticias o artículos
      const candidatos = [
        ...document.querySelectorAll('a[href*="/noticias/"]'),
        ...document.querySelectorAll('a[href*="/noticia/"]'),
        ...document.querySelectorAll('.card a'),
        ...document.querySelectorAll('.views-row a')
      ];

      return candidatos
        .map(a => {
          let titulo = a.innerText.replace(/\s+/g, ' ').trim();
          const enlace = a.href;

          if (titulo.length < 10 || /de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/i.test(titulo)) {
            const contenedor = a.closest('.card') || a.closest('.views-row') || a.parentElement?.parentElement || a;
            const hReal = contenedor.querySelector('h3, h4, h2, [class*="titulo"], .field--name-title');
            if (hReal) titulo = hReal.innerText.replace(/\s+/g, ' ').trim();
          }

          let img = a.querySelector('img') || a.parentElement?.querySelector('img') || a.parentElement?.parentElement?.querySelector('img');
          let imagen = img ? (img.src || img.dataset.src || img.getAttribute('data-src') || '') : '';

          return { titulo, enlace, imagen };
        })
        .filter(n => {
          if (!n.enlace || !n.enlace.includes('tunja-boyaca.gov.co')) return false;
          if (!n.enlace.includes('/noticias/') && !n.enlace.includes('/noticia/')) return false;
          if (n.titulo.length < 10 || n.titulo.length > 250) return false;
          if (n.titulo.includes('Noticias') || n.titulo.toLowerCase() === 'tunja, boyacá') return false;
          
          if (usados.has(n.enlace)) return false;
          usados.add(n.enlace);
          return true;
        });
    });

    console.log(`Total noticias encontradas: ${noticiasBase.length}`);

    if (!noticiasBase || noticiasBase.length === 0) {
      console.log('No se encontraron noticias. Verifica las URLs o selectores.');
      await browser.close();
      return;
    }

    // 3. Extraer descripciones visitando cada noticia
    const noticiasFinal = [];
    const listaNoticias = noticiasBase.slice(0, 10);

    for (const noticia of listaNoticias) {
      try {
        console.log(`Procesando: ${noticia.enlace}`);

        await page.goto(noticia.enlace, {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });

        await page.waitForTimeout(1500);

        const descripcion = await page.evaluate(() => {
          // 1. Metaetiquetas
          const metaOg = document.querySelector('meta[property="og:description"]')?.content;
          if (metaOg && metaOg.trim().length > 20) return metaOg.trim();

          const metaDesc = document.querySelector('meta[name="description"]')?.content;
          if (metaDesc && metaDesc.trim().length > 20) return metaDesc.trim();

          // 2. Cuerpo del artículo
          const contenedores = [
            document.querySelector('.field--name-body'),
            document.querySelector('.field--name-field-lead'),
            document.querySelector('article'),
            document.querySelector('.node__content'),
            document.body
          ];

          for (const c of contenedores) {
            if (!c) continue;
            const elementos = [...c.querySelectorAll('p, div.field__item')]
              .map(el => el.innerText.replace(/\s+/g, ' ').trim())
              .filter(t =>
                t.length > 30 &&
                t.length < 600 &&
                !/Youtube:|Soundcloud:|Twitter:|Facebook:|Instagram:|TikTok:|Descarga|Boletín/i.test(t)
              );

            if (elementos.length > 0) return elementos[0];
          }

          return '';
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

    console.log(`Noticias procesadas exitosamente: ${noticiasFinal.length}`);

    // 4. Enviar al Webhook
    const webhookUrl = process.env.WEBHOOK_URL;
    if (webhookUrl && noticiasFinal.length > 0) {
      const resp = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(noticiasFinal)
      });
      console.log(`Webhook llamado. Estado HTTP: ${resp.status}`);
    } else {
      console.log('No se enviaron datos (lista vacía o WEBHOOK_URL no configurada).');
    }

  } catch (errGen) {
    console.error('Error general durante la ejecución:', errGen.message);
  } finally {
    await browser.close();
  }
})();
