const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage();

  console.log('Abriendo portal de noticias de Tunja...');
  await page.goto('https://www.tunja-boyaca.gov.co/tema/noticias', {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });

  // Esperar carga de las primeras noticias
  await page.waitForSelector('a[href*="/noticias/"]', { timeout: 20000 });
  await page.waitForTimeout(2000);

  // ---- CONTROL DE CLICS (CARGAR MÁS) ----
  const clicsDeseados = 4; 
  
  for (let i = 0; i < clicsDeseados; i++) {
    try {
      const enlacesAntes = await page.evaluate(() => document.querySelectorAll('a[href*="/noticias/"]').length);

      const clickExitoso = await page.evaluate(() => {
        const botones = Array.from(document.querySelectorAll('button'));
        const botonCargar = botones.find(b => b.innerText.toLowerCase().includes('cargar más'));
        if (botonCargar) {
          botonCargar.click();
          return true;
        }
        return false;
      });

      if (clickExitoso) {
        console.log(`Botón 'Cargar más' pulsado (${i + 1}/${clicsDeseados})`);
        await page.waitForFunction(
          (antes) => document.querySelectorAll('a[href*="/noticias/"]').length > antes,
          enlacesAntes,
          { timeout: 8000 }
        ).catch(() => {});
        await page.waitForTimeout(2500);
      } else {
        console.log('No se encontró más el botón.');
        break;
      }
    } catch (err) {
      console.log('Aviso en iteración:', err.message);
      break;
    }
  }

  // ---- RECOLECCIÓN DE ENLACES E IMÁGENES ----
  const fuentesNoticias = await page.evaluate(() => {
    const usados = new Set();
    const resultado = [];

    const todosLosEnlaces = Array.from(document.querySelectorAll('a[href*="/noticias/"]'));

    for (const a of todosLosEnlaces) {
      const enlace = a.href;

      if (!enlace.includes('/noticias/') || usados.has(enlace)) continue;

      const tarjeta = a.closest('.card') || a.closest('.item') || a.parentElement?.parentElement || a;
      const img = tarjeta.querySelector('img');
      let imagen = '';
      if (img) {
        imagen = img.src || img.dataset.src || img.getAttribute('data-src') || '';
      }

      usados.add(enlace);
      resultado.push({ enlace, imagen });
    }

    return resultado;
  });

  console.log(`Enlaces únicos recolectados: ${fuentesNoticias.length}. Extrayendo títulos reales de las notas...`);

  // ---- EXTRACCIÓN INTERNA REAL DE TÍTULOS ----
  const noticiasFinal = [];

  for (const item of fuentesNoticias) {
    let noticiaPage;
    try {
      noticiaPage = await browser.newPage();
      await noticiaPage.goto(item.enlace, {
        waitUntil: 'domcontentloaded',
        timeout: 45000
      });

      await noticiaPage.waitForTimeout(1000);

      const datosInternos = await noticiaPage.evaluate(() => {
        // SELECTORES EXCLUSIVOS PARA EL CMS "MI COLOMBIA DIGITAL"
        // Buscamos las clases exactas donde esconden el título principal de la noticia
        const elementoTitulo = document.querySelector('.title_page') || 
                               document.querySelector('.title-page') ||
                               document.querySelector('.heading-title') ||
                               document.querySelector('.news-detail-title') ||
                               document.querySelector('.container .title') ||
                               document.querySelector('h1.title');
        
        let tituloReal = '';
        if (elementoTitulo) {
          tituloReal = elementoTitulo.innerText.trim();
        } else {
          // Si falla, intentamos extraer el texto del h1 o h2 más grande de la zona central
          const h1Comun = document.querySelector('main h1') || document.querySelector('article h1') || document.querySelector('h1');
          tituloReal = h1Comun ? h1Comun.innerText.trim() : '';
        }

        // Si el título capturado sigue siendo "Tunja, Boyacá", lo vaciamos para forzar el descarte de basura
        if (tituloReal.toLowerCase() === 'tunja, boyacá' || tituloReal.toLowerCase() === 'tunja, boyaca') {
          tituloReal = '';
        }

        // Extraer párrafos limpios para la descripción
        const parrafos = [...document.querySelectorAll('p')]
          .map(p => p.innerText.trim())
          .filter(t =>
            t.length > 60 &&
            t.length < 500 &&
            !t.toLowerCase().includes('youtube') &&
            !t.toLowerCase().includes('twitter') &&
            !t.toLowerCase().includes('facebook') &&
            !t.toLowerCase().includes('instagram')
          );

        const descripcionReal = parrafos.find(t => t.includes('.') && t.split(' ').length > 6) || parrafos[0] || '';

        return { tituloReal, descripcionReal };
      });

      // Validar que el título sea legítimo y no la cabecera genérica
      if (datosInternos.tituloReal && datosInternos.tituloReal.length > 10) {
        noticiasFinal.push({
          titulo: datosInternos.tituloReal.replace(/\s+/g, ' ').trim(),
          enlace: item.enlace,
          imagen: item.imagen,
          descripcion: datosInternos.descripcionReal
        });
        console.log(`✔ Procesada: ${datosInternos.tituloReal.substring(0, 50)}...`);
      }

    } catch (err) {
      console.log(`❌ Error en enlace: ${item.enlace}`);
    } finally {
      if (noticiaPage) await noticiaPage.close();
    }
  }

  // REPORTE FINAL
  console.log('\n--- RESULTADO GENERAL ---');
  console.log(`Total noticias procesadas correctamente: ${noticiasFinal.length}`);
  console.log(JSON.stringify(noticiasFinal, null, 2));

  // Enviar a Webhook de Apps Script
  if (process.env.WEBHOOK_URL && noticiasFinal.length > 0) {
    try {
      await fetch(process.env.WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(noticiasFinal)
      });
      console.log('¡Noticias enviadas correctamente al Google Sheet!');
    } catch (e) {
      console.log('Error enviando al Webhook:', e.message);
    }
  }

  await browser.close();
})();
