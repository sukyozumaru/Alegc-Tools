# Alegc Tools

> Mi panel personal — construido conversando con IA en vez de escribir cada línea a mano.

Alegc Tools junta en un solo lugar las herramientas que uso todos los días, con una interfaz cuidada y organizada por categorías:

- **Red Social → Instagram** — análisis de seguidores y seguidos a partir de tu propio archivo exportado, sin bots ni logins riesgosos.
- **Productividad → IA** — generador de ideas, dividido entre "herramientas que ya existen" y "cosas para crear desde cero".
- **Aprendizaje → YouTube** — un feed de recomendaciones de video pensado a la medida de mis gustos.

Es un proyecto vivo: lo sigo ajustando con ayuda de IA (Claude para construirlo, DeepSeek para revisarlo y pulirlo), así que va a seguir sumando categorías con el tiempo.

**[→ Ver el sitio en vivo](PON_AQUI_TU_LINK_DE_GITHUB_PAGES)**

---

## Ver el sitio en tu navegador (sin subir nada)

Solo abre `index.html` con doble clic. Todo el diseño, el análisis de Instagram y el guardado local funcionan sin necesidad de internet ni de configurar nada.

## Qué funciona en GitHub Pages y qué no

**Funciona igual que en Claude:**
- Todo el diseño y la navegación del panel.
- Análisis de Instagram (subes tu archivo exportado de Instagram, todo se calcula en tu navegador).
- Guardado local de tus datos (usa `localStorage`, así que persiste en ese navegador/dispositivo).

**No funciona fuera de Claude** (muestra "no disponible" en vez de romperse):
- Mi potencial / Ideas de contenido (Instagram)
- Generar ideas (Productividad → IA)
- Recomendaciones de YouTube (Aprendizaje)

Estas tres dependen de `window.claude.use(...)`, una conexión que solo existe dentro del entorno de artefactos de Claude. Para tener esa misma funcionalidad de IA en tu propia página necesitas un backend propio (por ejemplo, una función serverless en Vercel o Cloudflare Workers) que guarde tu clave de API de forma segura y hable con el modelo de IA que elijas (DeepSeek, u otro) — nunca directo desde el navegador, porque cualquiera que vea el código fuente vería tu clave.

## Próximos pasos si quieres la IA funcionando ahí también

1. Consigue una clave de API del modelo que quieras usar (ej. DeepSeek).
2. Crea una función serverless simple que reciba la petición del navegador, la reenvíe al modelo con tu clave (guardada como variable de entorno, nunca en el código), y devuelva la respuesta.
3. Cambia las tres funciones de este archivo que hoy llaman a `sampler.json(...)` / `sampler(...)` para que en su lugar llamen a tu función serverless con `fetch(...)`.

Si llegas a ese punto, cuéntamelo y te ayudo a armar esa función paso a paso.
