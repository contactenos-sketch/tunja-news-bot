// 4. Extracción de descripciones con espera activa de selector
    const noticiasFinal = [];
    const listaNoticias = noticiasBase.slice(0, 10);

    for (const noticia of listaNoticias) {
      try {
        console.log(`Procesando: ${noticia.enlace}`);
        
        await page.goto(noticia.enlace, {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });

        // ESPERA ACTIVA: Esperar hasta 4 segundos a que aparezca alguno de los contenedores de texto de Drupal
        try {
          await page.waitForSelector('.field--name-body, article, .contenido-noticia, p', { timeout: 4000 });
        } catch (e) {
          // Si no aparece a tiempo, continúa con el intento de extracción en DOM
        }

        const descripcion = await page.evaluate(() => {
          // 1. Intentar metaetiqueta og:description
          const metaOg = document.querySelector('meta[property="og:description"]')?.content;
          if (metaOg && metaOg.trim().length > 20) return metaOg.trim();

          const metaDesc = document.querySelector('meta[name="description"]')?.content;
          if (metaDesc && metaDesc.trim().length > 20) return metaDesc.trim();

          // 2. Buscar en los contenedores de texto específicos del CMS MiColombiaDigital / Drupal
          const contenedores = [
            document.querySelector('.field--name-body'),
            document.querySelector('.field--name-field-lead'),
            document.querySelector('article'),
            document.querySelector('.node__content'),
            document.body
          ];

          for (const c of contenedores) {
            if (!c) continue;

            // Buscar párrafos o divs con texto significativo
            const elementos = [...c.querySelectorAll('p, div.field__item, div')]
              .map(el => el.innerText.replace(/\s+/g, ' ').trim())
              .filter(t => 
                t.length > 40 && 
                t.length < 600 &&
                !/Youtube:|Soundcloud:|Twitter:|Facebook:|Instagram:|TikTok:|Descarga|Boletín/i.test(t)
              );

            if (elementos.length > 0) {
              return elementos[0];
            }
          }

          // 3. Fallback: extraer la primera oración completa con sentido
          const textoGeneral = document.body.innerText.replace(/\s+/g, ' ').trim();
          const frases = textoGeneral.split(/\.\s+/).filter(f => f.length > 40 && f.length < 300);
          return frases.length > 0 ? (frases[0] + '.') : '';
        });

        console.log(`-> Descripción: "${descripcion.substring(0, 60)}..."`);

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
