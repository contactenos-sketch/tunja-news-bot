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

      // Extraer Título e Introducción directamente desde la página del artículo
      const datosInternos = await noticiaPage.evaluate(() => {
        // El título principal suele estar en un h1, h2 o clase principal de la cabecera
        const elementoTitulo = document.querySelector('h1') || 
                               document.querySelector('h2') || 
                               document.querySelector('.title-internal');
        
        const tituloReal = elementoTitulo ? elementoTitulo.innerText.trim() : '';

        // Extraer párrafos limpios para la descripción
        const parrafos = [...document.querySelectorAll('p')]
          .map(p => p.innerText.trim())
          .filter(t =>
            t.length > 70 &&
            t.length < 400 &&
            !t.toLowerCase().includes('youtube') &&
            !t.toLowerCase().includes('twitter') &&
            !t.toLowerCase().includes('facebook') &&
            !t.toLowerCase().includes('instagram') &&
            !t.toLowerCase().includes('boletín')
          );

        const descripcionReal = parrafos.find(t => t.includes('.') && t.split(' ').length > 8) || '';

        return { tituloReal, descripcionReal };
      });

      // Validamos que la página interna realmente tuviera un título
      if (datosInternos.tituloReal && datosInternos.tituloReal.length > 15) {
        noticiasFinal.push({
          titulo: datosInternos.tituloReal,
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
  console.log(JSON.stringify(noticiasFinal, null, 2));

  // Enviar a Webhook de Apps Script
  if (process.env.WEBHOOK_URL && noticiasFinal.length > 0) {
    try {
      await fetch(process.env.WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(noticiasFinal)
      });
      console.log('Noticias enviadas correctamente al Webhook.');
    } catch (e) {
      console.log('Error enviando al Webhook:', e.message);
    }
  }

  await browser.close();
})();
