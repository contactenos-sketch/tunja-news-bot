const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled' // Evita detección básica de bots
    ]
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 }
  });

  const page = await context.newPage();

  try {
    console.log('Navegando a la lista de noticias...');
    await page.goto('https://www.tunja-boyaca.gov.co/tema/noticias', {
      waitUntil: 'networkidle', // Espera a que la red se estabilice
      timeout: 60000
    });

    // 1. Cargar más noticias
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

    // 2. Extraer enlaces base
    const noticiasBase = await page.evaluate(() => {
      const usados = new Set();
      return [...document.querySelectorAll('a[href*="/noticias/"]')]
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

    console.log(`Noticias encontradas: ${noticiasBase.length}`);

    // 3. Extracción de descripciones usando la MISMA pestaña (evita bloqueos)
    const noticiasFinal = [];
    const listaNoticias = noticiasBase.slice(0, 10);

    for (const noticia of listaNoticias) {
      try {
        console.log(`Procesando: ${noticia.enlace}`);
        
        // Reutilizar la página en lugar de abrir contextos nuevos constantemente
        const response = await page.goto(noticia.enlace, {
          waitUntil: 'domcontentloaded',
          timeout: 25000
        });

        // Verificar status HTTP
        if (response && response.status() >= 400) {
          console.log(`Error HTTP ${response.status()} en ${noticia.enlace}`);
          continue;
        }

        await page.waitForTimeout(1500);

        const descripcion = await page.evaluate(() => {
          // ESTRATEGIA 1: Metaetiquetas OpenGraph o Description
          const metaOg = document.querySelector('meta[property="og:description"]')?.content;
          if (metaOg && metaOg.trim().length > 20) return metaOg.trim();

          const metaDesc = document.querySelector('meta[name="description"]')?.content;
          if (metaDesc && metaDesc.trim().length > 20) return metaDesc.trim();

          // ESTRATEGIA 2: Párrafos dentro del contenedor de contenido de la alcaldía
          const selectors = [
            '.field--name-body', 
            '.node__content', 
            '.articulo-contenido', 
            'article', 
            'main'
          ];
          
          let contenedor = null;
          for (const s of selectors) {
            contenedor = document.querySelector(s);
            if (contenedor) break;
          }
          if (!contenedor) contenedor = document.body;

          const parrafos = [...contenedor.querySelectorAll('p, div')]
            .map(el => el.innerText.replace(/\s+/g, ' ').trim())
            .filter(t => 
              t.length > 40 && 
              t.length < 500 &&
              !/Youtube:|Soundcloud:|Twitter:|Facebook:|Instagram:|TikTok:|Descarga|Compartir/i.test(t)
            );

          if (parrafos.length > 0) {
            return parrafos[0];
          }

          // ESTRATEGIA 3: Fallback de texto crudo si los párrafos están envueltos en spans o div sin <p>
          const textoCompleto = contenedor.innerText.replace(/\s+/g, ' ').trim();
          const frases = textoCompleto.split('.').filter(f => f.trim().length > 30);
          return frases.length > 0 ? (frases[0].trim() + '.') : '';
        });

        console.log(`-> Descripción extraída (${descripcion.length} caracteres): "${descripcion.substring(0, 50)}..."`);

        noticiasFinal.push({
          titulo: noticia.titulo,
          enlace: noticia.enlace,
          imagen: noticia.imagen,
          descripcion: descripcion
        });

      } catch (err) {
        console.log(`Fallo en noticia ${noticia.enlace}:`, err.message);
      }
    }

    console.log(`Procesadas correctamente: ${noticiasFinal.length}`);

    // 4. Envío al Webhook
    if (process.env.WEBHOOK_URL && noticiasFinal.length > 0) {
      const resp = await fetch(process.env.WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(noticiasFinal)
      });
      console.log(`Respuesta del Webhook: ${resp.status}`);
    }

  } catch (errGen) {
    console.error('Error general:', errGen.message);
  } finally {
    await browser.close();
  }
})();
