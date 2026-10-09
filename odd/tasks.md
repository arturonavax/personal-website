# Tareas del Proyecto (ODD)

## Eliminar imagenes og-default personalizadas por ruta

La calidad de la generacion de los og's personalizados por ruta no es buena, por lo que quiero desactivarlo por ahora y solo dejar el og-default principal para todas las rutas.

## Arreglar estetica de banner en pagina de experience

En la pagina dedicada de un experience se rompio el diseño de el banner, la linea de timeline deberia estar por dentras del banner pero ahora esta delante y no deberia. Y las flechas se cortan como si su contenedor tuviera una clase de overflow hidden (las fechas deben sobresalir).

## Ajuste de animacion de switch theme

En pantallas muy grandes la animacion circular se ve a bajos FPS o va muy rapido. Ajustalo para que indistintamente el tamaño de pantalla la animacion se vea fluida y dure lo mismo.

## Refinar /admin - SKILL taste-skills SKILL.md

Reanaliza totalmente la implementacion de la pagina /admin, debe ser esteticamente igual que las demas, reutilizar el mismo frontend Astro+Tailwind con la misma estetica, solo que el centro tendra las metricas.

Elimina los graficos, monta un dashboards extremadamente funcional y util con los datos disponibles.

Fallas actuales: No muestra los datos totales, no recarga, no muestro los datos en tiempo real, los selects no cambian nada.

Aparte de lo que consideres conveniente en un dashboard de metricas me interesa poder ver totales y filtros: Por pais, Humanos, Robots, Hace 1, 2, 3 dia, 1 semana, 1 mes, todo el tiempo, y plazos de tiempo personalizados. Paginas destacadas. Usuarios unicos. Prefetchs. Atribuciones UTM, etc.
