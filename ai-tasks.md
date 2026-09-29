# Tasks for AI

[] Los filtros de busqueda en /experience no deberia ser seleccion multiple por empresa.

[x] Atributos UTM:

    - Hacer que el componente LinkGenerator exponga una utilidad (o declarar la utilidad y hacer que el componente lo use, lo que sea mejor practica en Astro), para entregarle un link base, y si el link es /es/ o no, le agregara los atributos UTM que se requieran en el idioma correcto. Esta funcionalidad debe ser totalmente replicable por la interfaz grafica del componente (entregar los mismos resultados).
    - En la pagina /resume/ al final deberia haber un input (para modificar el prefijo) como el de /links/ para agregar en tiempo real a los links arturonavax.dev del CV el utm_content con un boton de aleatoriedad y copia. (Apenas se entra a la pagina /resume/ todos los atributos UTM para CV en su respectivo idioma son aplicados).

[] Botones de copia en la parte inferior del CV/Resume, para copiarlo en el markdown original, JSON, TOML y XML (estos ultimos haciendo un parseo correcto del markdown original o del HTML, lo que sea mas rentable)

[] (Human) Parece que hay demasiadas peticiones "503 (Service Unavailable)" en la consola, quizas por los prefetch, investigar.

[] (Human) Considerar mas skills para SEO y JSON-LD:

    - https://www.skills.sh/coreyhaines31/marketingskills/seo-audit
    - https://www.skills.sh/coreyhaines31/marketingskills/schema
    - https://www.skills.sh/coreyhaines31/marketingskills/schema-markup
    - https://www.skills.sh/hainrixz/claude-seo-ai/seo-schema-jsonld

[] (Human) Integrar boton de descarga de CV (Aparte del Print) (Yo proporcionare el archivo PDF donde me digas).

[] Reanalizar configuracion de impresion de CV en Firefox para que todos los navegadores luzcan igual al imprimir.

[] En mobile el nombre al print PDF sigue siendo el Title de la pagina en vez del nombre "ArturoNava-CV-{lang}.pdf", arreglalo.

[] En mobile y Firefox el page index no hace buen scroll (el objetivo queda debajo de la barra superior), arreglalo.

[] (Human) Confirmar situacion de notranslate inteligente que no perjudique el SEO. (Duplicacion de resultados en 2 idiomas)

[] Si se presiona About (o el logo) ya estando en About solo deberia subir el scroll al top.

[] Cambiar toda referencia en ingles en codigo y estructura de archivo "cv" por "resume", para evitar colision o confusion futura con Computer Vision.

[] En la mayoria de situaciones la animacion de de onda al cambiar de tema luce perfecto, sobre todo en mobile, pero en ciertos navegadores se ve un corte entre la animacion, un salto, aveces solo de claro a oscuro. (Firefox)

[] Investigar si publicar mi CV en una ruta de archivos publico en formato PDF y Markdown mejorara el SEO y la exposicion.

    [] Considerar integrar boton de Download PDF (archivo .pdf directo) si se detecta que el navegador no es composible con print local de PDF, como en Smartwatches.

[] Confirmar que worker.ts este en la version mas profesional y refinada posible, que se ignore ninguna acceso real y tenga un mecanismo para tratar de ignorar peticiones de prefetch que no garanticen visita real.
