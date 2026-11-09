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
    console.log('1. Navegando al portal de noticias...');

    await page.goto('https://www.tunja-boyaca.gov.co/tema/noticias', {
      waitUntil: 'networkidle',
      timeout: 45000
    });

    await page.waitForTimeout(3000);

    // 2. Extraer lista base con título limpio e imagen completa
    const noticiasBase = await page.evaluate(() => {
      const usados = new Set();
      const enlaces = [...document.querySelectorAll('a[href*="/noticias/"]')];

      return enlaces.map(a => {
        const contenedor = a.closest('.card') || a.closest('.views-row') || a.parentElement?.parentElement || a;

        // Extraer el título directamente del encabezado
        const hReal = contenedor.querySelector('h3, h4, h2, [class*="titulo"], .field--name-title');
        let titulo = hReal ? hReal.innerText : a.innerText;

        // Limpiar saltos de línea y textos residuales como "Noticia hace X días"
        titulo = titulo.replace(/\s+/g, ' ').trim();
        titulo = titulo.replace(/^Noticia\s+hace\s+\d+\s+días\s*/i, '');
        titulo = titulo.replace(/^Noticia\s+hace\s+\d+\s+horas\s*/i, '');

        const enlace = a.href;

        // Buscar la imagen en el contenedor
        let img = contenedor.querySelector('img') || a.querySelector('img');
        let imagen = '';
        if (img) {
          imagen = img.src || img.getAttribute('data-src') || img.dataset.src || '';
        }

        return { titulo, enlace, imagen };
      }).filter(n => {
        if (!n.enlace || n.enlace.endsWith('/tema/noticias')) return false;
        if (n.titulo.length < 10 || n.titulo.includes('CARGAR MÁS')) return false;
        if (usados.has(n.enlace)) return false;
        usados.add(n.enlace);
        return true;
      });
    });

    console.log(`Noticias encontradas: ${noticiasBase.length}`);

    // 3. Extraer el TEXTO COMPLETO de cada noticia
    const noticiasFinal = [];
    for (const noticia of noticiasBase.slice(0, 10)) {
      try {
        console.log(`Procesando contenido completo: ${noticia.enlace}`);
        await page.goto(noticia.enlace, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(1500);

        const detalle = await page.evaluate(() => {
          // Si la imagen no venía desde la lista, intentamos capturarla dentro de la página del artículo
          const imgArticulo = document.querySelector('article img, .field--name-body img, meta[property="og:image"]');
          let imagenDetalle = '';
          if (imgArticulo) {
            imagenDetalle = imgArticulo.content || imgArticulo.src || imgArticulo.getAttribute('data-src') || '';
          }

          // Seleccionar el contenedor principal del texto
          const contenedor = document.querySelector('.field--name-body') || 
                             document.querySelector('.node__content') || 
                             document.querySelector('article') || 
                             document.body;

          // Extraer TODOS los párrafos con contenido real
          const parrafos = [...contenedor.querySelectorAll('p, div.field__item')]
            .map(p => p.innerText.replace(/\s+/g, ' ').trim())
            .filter(texto => {
              if (texto.length < 20) return false;
              if (texto.includes('La alcaldía de Tunja es una entidad')) return false;
              if (/Youtube|Twitter|Facebook|Boletín|Derechos reservados|Compartir/i.test(texto)) return false;
              return true;
            });

          // Unir todos los párrafos encontrados con saltos de línea doble para conservar el texto completo
          const textoCompleto = parrafos.join('\n\n');

          return {
            textoCompleto: textoCompleto || 'Sin contenido de texto disponible.',
            imagen: imagenDetalle
          };
        });

        const imagenFinal = noticia.imagen || detalle.imagen;

        console.log(`  -> Título: "${noticia.titulo.substring(0, 40)}..."`);
        console.log(`  -> Imagen URL: ${imagenFinal ? 'Encontrada' : 'No encontrada'}`);
        console.log(`  -> Longitud texto: ${detalle.textoCompleto.length} caracteres`);

        noticiasFinal.push({
          titulo: noticia.titulo,
          enlace: noticia.enlace,
          imagen: imagenFinal,
          descripcion: detalle.textoCompleto // Envía la noticia completa sin recortar
        });

      } catch (err) {
        console.log(`Error al abrir ${noticia.enlace}: ${err.message}`);
      }
    }

    console.log(`Noticias procesadas exitosamente: ${noticiasFinal.length}`);

    // 4. Enviar datos completos al Webhook
    const webhookUrl = process.env.WEBHOOK_URL;
    if (webhookUrl && noticiasFinal.length > 0) {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(noticiasFinal)
      });
      console.log(`Estado HTTP de Apps Script: ${res.status}`);
    } else {
      console.log('No se envió información (WEBHOOK_URL vacía o no hay datos).');
    }

  } catch (error) {
    console.error('Error en el proceso general:', error.message);
  } finally {
    await browser.close();
  }
})();
