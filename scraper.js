const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true // Puedes cambiarlo a false para ver el navegador en acción
  });

  const page = await browser.newPage();

  console.log('Abriendo el portal de noticias...');
  await page.goto('https://www.tunja-boyaca.gov.co/tema/noticias', {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });

  // Esperar a que aparezcan las primeras noticias en pantalla
  await page.waitForSelector('a[href*="/noticias/"]', { timeout: 20000 });
  await page.waitForTimeout(2000);

  // ---- PROCESO DE CLICS CON ESPERA REAL EN EL DOM ----
  const clicsDeseados = 3; // 3 clics × 4 noticias aprox = ~16 noticias
  
  for (let i = 0; i < clicsDeseados; i++) {
    try {
      // Contar cuántas noticias hay ANTES del clic
      const noticiasAntes = await page.evaluate(() => document.querySelectorAll('a[href*="/noticias/"]').length);

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
        console.log(`Botón pulsado (Iteración ${i + 1}). Esperando nuevos contenidos...`);
        
        // REGLA DE ORO: Esperar a que el número de enlaces en el HTML aumente
        // Si no aumenta, el script se detiene un momento antes de continuar
        await page.waitForFunction(
          (antes) => document.querySelectorAll('a[href*="/noticias/"]').length > antes,
          noticiasAntes,
          { timeout: 8000 }
        ).catch(() => console.log('La página tardó en responder, continuando...'));

        await page.waitForTimeout(2000); // Pausa de estabilidad
      } else {
        console.log('No se encontró el botón "Cargar más". Fin del bucle.');
        break;
      }
    } catch (err) {
      console.log('Aviso en iteración:', err.message);
      break;
    }
  }

  // ---- EXTRACCIÓN DE DATOS REESTRUCTURADA ----
  console.log('Extrayendo enlaces de noticias...');
  
  const noticiasBase = await page.evaluate(() => {
    const usados = new Set();
    const listaNoticias = [];

    // Buscamos TODOS los enlaces que lleven a una noticia
    const todosLosEnlaces = Array.from(document.querySelectorAll('a[href*="/noticias/"]'));

    for (const a of todosLosEnlaces) {
      const enlace = a.href;

      // Si el enlace ya lo procesamos en esta misma limpieza, lo ignoramos
      if (usados.has(enlace)) continue;

      // Intentamos capturar un título limpio
      let titulo = a.innerText
        .replace(/\n/g, ' ')
        .replace(/\r/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      // Si el enlace no tenía texto (era una imagen envolvente), buscamos texto a su alrededor
      if (titulo.length < 10) {
        const tarjetaContenedora = a.closest('div') || a.parentElement;
        const enlaceConTexto = tarjetaContenedora?.querySelector('a[href*="/noticias/"] h3') || 
                               tarjetaContenedora?.querySelector('h3') || 
                               tarjetaContenedora?.querySelector('a[href*="/noticias/"]');
        if (enlaceConTexto) {
          titulo = enlaceConTexto.innerText.replace(/\s+/g, ' ').trim();
        }
      }

      // Validaciones de seguridad para el título
      if (titulo.length < 10 || titulo.length > 250) continue;
      if (titulo.toLowerCase() === 'noticias' || titulo.toLowerCase().includes('leer más')) continue;

      // Buscar imagen dentro de la misma estructura de la tarjeta
      const tarjeta = a.closest('div[class*="card"]') || a.parentElement?.parentElement || a;
      const img = tarjeta.querySelector('img');
      let imagen = '';
      if (img) {
        imagen = img.src || img.dataset.src || img.getAttribute('data-src') || '';
      }

      usados.add(enlace);
      listaNoticias.push({ titulo, enlace, imagen });
    }

    return listaNoticias;
  });

  console.log(`¡Éxito! Total de noticias reales encontradas: ${noticiasBase.length}`);

  // ---- CONSUMO DE CADA NOTICIA INTERNA ----
  const noticiasFinal = [];

  for (const noticia of noticiasBase) {
    try {
      const noticiaPage = await browser.newPage();
      await noticiaPage.goto(noticia.enlace, {
        waitUntil: 'domcontentloaded',
        timeout: 45000
      });

      await noticiaPage.waitForSelector('p', { timeout: 10000 }).catch(() => {});
      
      const descripcion = await noticiaPage.evaluate(() => {
        const parrafos = [...document.querySelectorAll('p')]
          .map(p => p.innerText.trim())
          .filter(t =>
            t.length > 70 &&
            t.length < 400 &&
            !t.includes('Youtube:') &&
            !t.includes('Twitter:') &&
            !t.includes('Facebook:') &&
            !t.includes('Instagram:')
          );

        return parrafos.find(t => t.includes('.') && t.split(' ').length > 8) || '';
      });

      noticiasFinal.push({
        titulo: noticia.titulo,
        enlace: noticia.enlace,
        imagen: noticia.imagen,
        descripcion: descripcion
      });

      await noticiaPage.close();
    } catch (err) {
      console.log('Error leyendo noticia individual, saltando:', noticia.enlace);
    }
  }

  // Imprimir resultado en consola
  console.log(JSON.stringify(noticiasFinal, null, 2));

  // Enviar a Webhook de Apps Script si existe la variable
  if (process.env.WEBHOOK_URL) {
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
