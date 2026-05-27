const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true // Cambiar a false si quieres ver el proceso en vivo
  });

  const page = await browser.newPage();

 // Abrir portal de noticias
  await page.goto(
    'https://www.tunja-boyaca.gov.co/tema/noticias',
    {
      // 1. Cambiamos a 'domcontentloaded': el script continuará 
      // tan pronto como el HTML básico esté listo, sin esperar imágenes o scripts pesados.
      waitUntil: 'domcontentloaded', 
      // 2. Aumentamos el tiempo de espera a 60 segundos por si el servidor está lento.
      timeout: 60000 
    }
  );

  console.log('Página inicial cargada (DOM listo).');

  // 3. Esperamos un elemento real en lugar de confiar en la red.
  // Esto asegura que las primeras 4 noticias ya se pintaron en pantalla.
  await page.waitForSelector('a[href*="/noticias/"]', { timeout: 20000 });
  
  // Una pequeña pausa de seguridad antes de empezar a interactuar con el botón
  await page.waitForTimeout(3000);

  // ---- SECCIÓN OPTIMIZADA PARA CARGAR MÁS CONTENIDOS ----
  const iteraciones = 5; // Cambia este número para cargar aún más noticias (ej. 5 clics = muchas más noticias)
  
  for (let i = 0; i < iteraciones; i++) {
    try {
      // Selector flexible que busca el botón por texto sin importar mayúsculas/minúsculas
      const boton = page.getByRole('button', { name: /cargar más contenido/i });
      
      // Validar si el botón existe y es visible
      if (await boton.count() > 0 && await boton.isVisible()) {
        
        // 1. Hacer scroll hasta el botón para asegurar que la web cargue los elementos
        await boton.scrollIntoViewIfNeeded();
        await page.waitForTimeout(1000); // Pausa breve post-scroll

        // 2. Hacer clic de manera forzada si es necesario
        await boton.click({ force: true });
        console.log(`Botón cargar más pulsado (Iteración ${i + 1})`);

        // 3. Esperar a que la red se estabilice y aparezcan las nuevas noticias
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2500); 
      } else {
        console.log('El botón ya no está visible o no existe.');
        break;
      }
    } catch (err) {
      console.log('No se pudo presionar el botón en esta iteración:', err.message);
      break;
    }
  }
  // --------------------------------------------------------

  // Obtener noticias base (Tu lógica se mantiene igual)
  const noticiasBase = await page.evaluate(() => {
    const usados = new Set();

    return [...document.querySelectorAll('a[href*="/noticias/"]')]
      .map(a => {
        const titulo = a.innerText
          .replace(/\n/g, ' ')
          .replace(/\r/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        const enlace = a.href;

        let img =
          a.querySelector('img') ||
          a.parentElement?.querySelector('img') ||
          a.parentElement?.parentElement?.querySelector('img') ||
          a.parentElement?.parentElement?.parentElement?.querySelector('img');

        let imagen = '';
        if (img) {
          imagen = img.src || img.dataset.src || img.getAttribute('data-src') || '';
        }

        return { titulo, enlace, imagen };
      })
      .filter(n => {
        if (!n.enlace.includes('/noticias/')) return false;
        if (n.titulo.length < 10 || n.titulo.length > 180) return false;
        if (n.titulo.includes('Noticias') || n.titulo.includes('am') || n.titulo.includes('pm')) return false;
        if (usados.has(n.enlace)) return false;
        
        usados.add(n.enlace);
        return true;
      });
  });

  console.log(`Total de noticias base encontradas: ${noticiasBase.length}`);

  const noticiasFinal = [];

  // Entrar a cada noticia
  for (const noticia of noticiasBase) {
    try {
      const noticiaPage = await browser.newPage();
      await noticiaPage.goto(noticia.enlace, {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });

      await noticiaPage.waitForSelector('p', { timeout: 15000 });
      
      const descripcion = await noticiaPage.evaluate(() => {
        const parrafos = [...document.querySelectorAll('p')]
          .map(p => p.innerText.trim())
          .filter(t =>
            t.length > 80 &&
            t.length < 400 &&
            !t.includes('Youtube:') &&
            !t.includes('Soundcloud:') &&
            !t.includes('Twitter:') &&
            !t.includes('Facebook:') &&
            !t.includes('Instagram:') &&
            !t.includes('TikTok:') &&
            !t.includes('Issuu:') &&
            !t.includes('Descarga boletín')
          );

        return parrafos.find(t => t.includes('.') && t.split(' ').length > 10) || '';
      });

      noticiasFinal.push({
        titulo: noticia.titulo,
        enlace: noticia.enlace,
        imagen: noticia.imagen,
        descripcion: descripcion
      });

      await noticiaPage.close();
    } catch (err) {
      console.log('Error noticia:', noticia.enlace, err.message);
    }
  }

  // DEBUG
  console.log(JSON.stringify(noticiasFinal, null, 2));

  // Enviar a Apps Script
  if (process.env.WEBHOOK_URL) {
    await fetch(process.env.WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(noticiasFinal)
    });
    console.log('Noticias enviadas correctamente');
  } else {
    console.log('WEBHOOK_URL no definida, omitiendo envío.');
  }

  await browser.close();
})();
