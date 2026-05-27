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

  // ---- EXTRACCIÓN DE DATOS REESTRUCTURADA E INTELIGENTE ----
  console.log('Extrayendo enlaces y títulos reales de noticias...');
  
  const noticiasBase = await page.evaluate(() => {
    const usados = new Set();
    const listaNoticias = [];

    // Buscamos todos los enlaces de noticias
    const todosLosEnlaces = Array.from(document.querySelectorAll('a[href*="/noticias/"]'));

    for (const a of todosLosEnlaces) {
      const enlace = a.href;

      // Evitar duplicados en el mismo barrido
      if (usados.has(enlace)) continue;

      // 1. Encontrar la tarjeta contenedora completa de la noticia
      const tarjeta = a.closest('.card') || a.closest('[class*="item"]') || a.closest('div') || a.parentElement;
      
      let titulo = '';

      // 2. Intentar buscar el título en las etiquetas jerárquicas reales dentro de esa tarjeta
      if (tarjeta) {
        const elementoTitulo = tarjeta.querySelector('h3') || 
                               tarjeta.querySelector('h4') || 
                               tarjeta.querySelector('.title') ||
                               tarjeta.querySelector('[class*="titulo"]');
        
        if (elementoTitulo) {
          titulo = elementoTitulo.innerText.trim();
        }
      }

      // 3. Si no encontró h3/h4, usamos el texto del enlace pero limpiando fechas conocidas
      if (!titulo) {
        titulo = a.innerText.trim();
      }

      // Limpieza general de caracteres raros y espacios masivos
      titulo = titulo
        .replace(/\n/g, ' ')
        .replace(/\r/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      // --- FILTRO ANTI-FECHAS Y BASURA ---
      // Si el título es solo una fecha (ej: "15 de mayo" o "2026") o es muy corto, lo descartamos o ignoramos
      const esSoloFecha = /^\d+.+de.+\d+$/i.test(titulo) || 
                          /^(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/i.test(titulo);
      
      if (esSoloFecha || titulo.length < 12) {
        // Si lo que agarramos fue una fecha, intentamos un último recurso: buscar texto en los hermanos del enlace
        const textoAlternativo = tarjeta?.innerText.replace(titulo, '').replace(/\s+/g, ' ').trim();
        if (textoAlternativo && textoAlternativo.length > 15 && textoAlternativo.length < 250) {
          titulo = textoAlternativo;
        } else {
          continue; // Si sigue siendo basura, saltamos al siguiente enlace
        }
      }

      if (titulo.length > 250 || titulo.toLowerCase().includes('leer más')) continue;

      // 4. Buscar la imagen dentro de la tarjeta
      const img = tarjeta ? tarjeta.querySelector('img') : null;
      let imagen = '';
      if (img) {
        imagen = img.src || img.dataset.src || img.getAttribute('data-src') || '';
      }

      usados.add(enlace);
      listaNoticias.push({ titulo, enlace, imagen });
    }

    return listaNoticias;
  });

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
