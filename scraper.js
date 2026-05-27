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
        // Esperar a que aparezcan nuevos enlaces en el DOM
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

  // ---- RECOLECCIÓN EXCLUSIVA DE ENLACES E IMÁGENES ----
  const fuentesNoticias = await page.evaluate(() => {
    const usados = new Set();
    const resultado = [];

    const todosLosEnlaces = Array.from(document.querySelectorAll('a[href*="/noticias/"]'));

    for (const a of todosLosEnlaces) {
      const enlace = a.href;

      // Si el enlace ya existe o es basura de paginación, lo saltamos
      if (!enlace.includes('/noticias/') || usados.has(enlace)) continue;

      // Capturar imagen cercana
      const tarjeta = a.closest('.card') || a.parentElement?.parentElement || a;
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

  console.log(`Enlaces únicos recolectados: ${fuentesNoticias.length}. Entrando a extraer contenido real...`);

  // ---- EXTRACCIÓN INTERNA (TÍTULO Y DESCRIPCIÓN) ----
  const noticiasFinal = [];

  for (const item of fuentesNoticias) {
    let noticiaPage;
    try {
      noticiaPage = await browser.newPage();
      await noticiaPage.goto(item.enlace, {
        waitUntil: 'domcontentloaded',
        timeout: 45000
      });

      // Esperar un momento corto a que el contenido se pinte
      await noticiaPage.waitForTimeout(1000);

      // Extraer Título e Introducción directamente desde la página del artículo
      const datosInternos = await noticiaPage.evaluate(() => {
        // SELECTOR ULTRA-FLEXIBLE: Buscamos h1, h2, h3 o clases comunes de títulos de este CMS
        const selectorTitulo = document.querySelector('.enphasis-title') || 
                               document.querySelector('.title-internal') ||
                               document.querySelector('.titulo-noticia') ||
                               document.querySelector('h1') || 
                               document.querySelector('h2') ||
                               document.querySelector('h3');
        
        // Si no encuentra ninguno, agarra el título de la pestaña del navegador (meta title)
        const tituloReal = selectorTitulo ? selectorTitulo.innerText.trim() : document.title.split('|')[0].trim();

        // Extraer párrafos limpios para la descripción
        const parrafos = [...document.querySelectorAll('p')]
          .map(p => p.innerText.trim())
          .filter(t =>
            t.length > 60 &&
            t.length < 500 &&
            !t.toLowerCase().includes('youtube') &&
            !t.toLowerCase().includes('twitter') &&
            !t.toLowerCase().includes('facebook') &&
            !t.toLowerCase().includes('instagram') &&
            !t.toLowerCase().includes('boletín')
          );

        // Intentar sacar el primer párrafo, si no, sacar el que tenga texto coherente
        const descripcionReal = parrafos.find(t => t.includes('.') && t.split(' ').length > 6) || parrafos[0] || '';

        return { tituloReal, descripcionReal };
      });

      // Validamos y limpiamos el título obtenido
      let tituloFinal = datosInternos.tituloReal
        .replace(/\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (tituloFinal && tituloFinal.length > 5) {
        noticiasFinal.push({
          titulo: tituloFinal,
          enlace: item.enlace,
          imagen: item.imagen,
          descripcion: datosInternos.descripcionReal
        });
        console.log(`✔ Procesada con éxito: ${tituloFinal.substring(0, 50)}...`);
      } else {
        console.log(`⚠ No se pudo extraer título válido en: ${item.enlace}`);
      }

    } catch (err) {
      console.log(`❌ Error abriendo enlace: ${item.enlace}`);
    } finally {
      if (noticiaPage) await noticiaPage.close();
    }
  }

  // REPORTE FINAL
  console.log('\n--- RESULTADO GENERAL ---');
  console.log(`Total noticias estructuradas: ${noticiasFinal.length}`);
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
  } else {
    console.log('No se enviaron datos. Webhook ausente o lista vacía.');
  }

  await browser.close();
})();
