const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  // Crear contexto con User-Agent real para evitar bloqueos
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  try {
    // 1. Navegación usando domcontentloaded
    await page.goto('https://www.tunja-boyaca.gov.co/tema/noticias', {
      waitUntil: 'domcontentloaded',
      timeout: 45000
    });

    await page.waitForTimeout(2000);

    // 2. Cargar más contenido
    for (let i = 0; i < 3; i++) {
      try {
        const boton = page.locator('text=CARGAR MÁS CONTENIDO');
        if (await boton.isVisible()) {
          await boton.click();
          console.log(`Botón cargar más pulsado (${i + 1}/3)`);
          await page.waitForTimeout(2000);
        } else {
          break;
        }
      } catch (err) {
        console.log('No hay más botón de carga disponible');
        break;
      }
    }

    // 3. Extracción de la lista base de noticias
    const noticiasBase = await page.evaluate(() => {
      const usados = new Set();

      return [...document.querySelectorAll('a[href*="/noticias/"]')]
        .map(a => {
          let titulo = a.innerText.replace(/\s+/g, ' ').trim();
          const enlace = a.href;

          if (titulo.length < 10 || /^\d/.test(titulo) || /de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/i.test(titulo)) {
            const contenedor = a.closest('.card') || a.parentElement?.parentElement || a;
            const hReal = contenedor.querySelector('h3') || contenedor.querySelector('h4') || contenedor.querySelector('[class*="titulo"]');
            if (hReal) {
              titulo = hReal.innerText.replace(/\s+/g, ' ').trim();
            }
          }

          let img = a.querySelector('img') ||
                    a.parentElement?.querySelector('img') ||
                    a.parentElement?.parentElement?.querySelector('img');

          let imagen = img ? (img.src || img.dataset.src || img.getAttribute('data-src') || '') : '';

          return { titulo, enlace, imagen };
        })
        .filter(n => {
          if (!n.enlace.includes('/noticias/')) return false;
          if (n.titulo.length < 10 || n.titulo.length > 250) return false;
          if (n.titulo.includes('Noticias') || n.titulo.toLowerCase() === 'tunja, boyacá') return false;
          if (/\b(am|pm)\b/i.test(n.titulo)) return false;

          if (usados.has(n.enlace)) return false;
          usados.add(n.enlace);

          return true;
        });
    });

    console.log(`Noticias encontradas para procesar: ${noticiasBase.length}`);

    // 4. Extracción de descripciones (limitado a 10 noticias)
    const noticiasFinal = [];
    const listaNoticias = noticiasBase.slice(0, 10);

    for (const noticia of listaNoticias) {
      let noticiaPage;
      try {
        noticiaPage = await context.newPage();
        await noticiaPage.goto(noticia.enlace, {
          waitUntil: 'domcontentloaded',
          timeout: 20000
        });

        // Esperar a que el cuerpo principal esté listo
        await noticiaPage.waitForTimeout(1000);

        const descripcion = await noticiaPage.evaluate(() => {
          // Opción A: Obtener desde la etiqueta meta (más fiable y rápida)
          const metaDesc = document.querySelector('meta[property="og:description"]')?.content ||
                           document.querySelector('meta[name="description"]')?.content;

          if (metaDesc && metaDesc.trim().length > 20) {
            return metaDesc.trim();
          }

          // Opción B: Buscar dentro del contenido principal
          const contenedor = document.querySelector('article') ||
                             document.querySelector('.contenido-noticia') ||
                             document.querySelector('.field-item') ||
                             document.body;

          const parrafos = [...contenedor.querySelectorAll('p')]
            .map(p => p.innerText.replace(/\s+/g, ' ').trim())
            .filter(t =>
              t.length > 30 &&
              !/Youtube:|Soundcloud:|Twitter:|Facebook:|Instagram:|TikTok:|Issuu:|Descarga boletín/i.test(t)
            );

          return parrafos.slice(0, 2).join(' ') || '';
        });

        noticiasFinal.push({
          titulo: noticia.titulo,
          enlace: noticia.enlace,
          imagen: noticia.imagen,
          descripcion: descripcion
        });

      } catch (err) {
        console.log(`Error al procesar noticia ${noticia.enlace}:`, err.message);
      } finally {
        if (noticiaPage) await noticiaPage.close();
      }
    }

    console.log(`Procesadas exitosamente: ${noticiasFinal.length}`);

    // 5. Envío al Webhook
    if (process.env.WEBHOOK_URL && noticiasFinal.length > 0) {
      const response = await fetch(process.env.WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(noticiasFinal)
      });
      console.log(`Noticias enviadas. Estado HTTP: ${response.status}`);
    } else {
      console.log('No se enviaron datos (lista vacía o falta la variable WEBHOOK_URL)');
    }

  } catch (errorGeneral) {
    console.error('Error general en el flujo:', errorGeneral.message);
  } finally {
    await browser.close();
  }
})();
