# Ligas

La ruta principal es `/ligas`, con pestañas `partidos`, `clasificacion`, `noticias` y `estadisticas` en el parámetro `tab`. `/partidos` redirige conservando competición, temporada y jornada. Los enlaces internos y la navegación lateral/inferior usan Ligas. Las cuatro pestañas comparten competición y temporada; los cambios no recargan la página. El menú ocupa el ancho disponible y mide la altura de la cabecera fija, incluida el área segura del iPhone. Al bajar se reduce a los tres logos; al subir recupera nombres y pestañas. El foco de teclado también lo expande. El indicador y el contenido se desplazan lateralmente según el orden de las pestañas, respetando movimiento reducido. Se elimina la cabecera visual y el selector de temporada; se conserva la resolución de temporadas desde enlaces y se usa la más reciente por defecto.

## Datos y temporada

- **Partidos:** reutiliza tarjetas, jornadas, fichas y el criterio de jornada actual. La temporada se filtra antes de elegir jornadas o mostrar resultados. Un enlace a una jornada histórica permite resolver su temporada si no hay una temporada explícita.
- **Clasificación:** `CompetitionTable` reutiliza `LeagueTable`, compartida con la nueva ficha de partido, en su modalidad de columnas completas. Reutiliza los resultados normalizados y muestra PJ, V, E, D, goles a favor/en contra en una sola columna +/− (20-10), DG y puntos, con equipos a cero cuando ya están en el calendario. Las columnas compactas caben sin desplazamiento lateral desde 320 px; los nombres largos se truncan visualmente conservando el nombre accesible. La cabecera permanece fija debajo de la navegación y sigue su reducción. La tabla compacta de la ficha de partido conserva sus columnas anteriores. Se usa solo la fase liga de la competición y temporada elegidas, sin mezclar eliminatorias. El orden por puntos/diferencia/goles es una clasificación calculada: no sustituye los desempates particulares ni sanciones del organizador. La interfaz lo indica.
- **Noticias:** conserva `news/football` y sus seis titulares generales para Inicio. Añade hasta seis titulares por competición en `competitionArticles`, de manera que una competición no desplace los de las otras. La app filtra competición, temporada deportiva julio–junio y antigüedad máxima de siete días; ordena por fecha descendente. No muestra noticias actuales al elegir una temporada histórica. La caché local es de una hora (ausencias dos minutos), sin consultas por pestaña o competición adicionales al mismo feed.
- **Estadísticas de jugadores:** `leagueStats/{PD|CL|PL}-{año}` contiene únicamente los primeros cinco registros normalizados de cada clasificación disponible. Las categorías y validaciones se concentran en `leagueStats.ts`. Una visita a la pestaña lee un documento de temporada, con caché compartida de quince minutos. Los cambios de competición/temporada cancelan la presentación de respuestas anteriores. Hay estados de carga, error con reintento y ausencia de datos.
- **Estadísticas de equipos:** máximos goleadores y menos goleados se calculan con todos los resultados reglamentarios de la competición y temporada seleccionadas, incluidas eliminatorias. Solo se consideran equipos con partidos jugados; no se atribuyen porterías a cero a un portero sin evidencia de sus apariciones.

## Fuente de los rankings

Se verificaron el 6 de noviembre de 2026 la [documentación de SportAPI](https://sportapi.ai/docs) y su [OpenAPI](https://sportapi.ai/api/openapi.json). Los endpoints publicados son:

- `/leagues/{id}/topscorers?limit=100` → `goals`.
- `/leagues/{id}/topassists?limit=100` → `assists`.
- `/leagues/{id}/topcards?limit=100` → `yellow_cards` y `red_cards`.

IDs publicados: PD=1, CL=18, PL=24. Se exige `success: true`, la fecha `season_from` correspondiente al año de inicio de la temporada deportiva y recuentos enteros no negativos. No se usa `season=all`: mezclaría temporadas. Las fechas locales de enero–mayo no se confunden con el inicio de la siguiente temporada. Los escudos se asocian mediante los alias de equipos y los calendarios de la misma competición/temporada, sin exponer la clave en URLs de imágenes.

Las listas del proveedor tienen límite de cien registros: especialmente tarjetas, ordenadas originalmente por total de tarjetas, pueden ser parciales al separarlas por color. La interfaz informa del límite y la cobertura. Participación en goles suma solo cuando ambas cifras están publicadas para la misma combinación de nombre y equipo; no interpreta una ausencia como cero y avisa de que ese ranking es parcial. Los empates comparten posición.

No se ha verificado un ranking global de minutos por competición/temporada ni de porterías a cero por portero en los endpoints disponibles. Las dos categorías tienen mensajes explícitos de ausencia. El endpoint individual `/players/stats` mezcla totales y partidos de varias competiciones sin parámetros de temporada: no se usa para inventar esas clasificaciones.

## Sincronización y consumo

`scripts/syncLeagueStats.ts` se ejecuta desde `scripts/officialSync.ts` dentro de la sincronización completa con el `SPORTAPI_KEY` existente, nunca desde el navegador ni en cada actualización de diez minutos. Caché mínima de seis horas por competición/temporada: máximo nueve peticiones en una renovación de las tres ligas. Comparte los límites transaccionales diarios/mensuales de SportAPI con resultados rápidos. Una clave rechazada, una cuota agotada o una temporada no verificable conserva la edición anterior y detiene nuevas consultas de esa ejecución.

Firestore permite solo obtener documentos públicos de temporada con IDs válidos; el cliente no puede listar la colección ni escribir estadísticas. `rankings` y los titulares por competición no se indexan. La publicación de reglas e índices va incluida en Deploy frontend. Después de publicar, las primeras estadísticas requieren una ejecución correcta de Synchronize football and standings. No hacen falta secretos nuevos. La cobertura con la clave del repositorio se verifica en Actions; las pruebas locales usan respuestas simuladas.

## Compartir

Se retira «Copiar texto» de `ShareDialog`, el menú compartido de quinielas y clasificaciones. Se conserva la vista previa PNG, Compartir nativo y Descargar. Sin compartir nativo se indica que se descargue la imagen, sin copiar automáticamente al portapapeles. Las opciones de la hoja del sistema dependen de iOS/Android. La herramienta de porras y la copia de invitaciones conservan su funcionamiento.

## Comprobaciones

Pruebas unitarias: filtros por liga/temporada, tabla, normalización de rankings, cuotas, rechazo de temporadas incorrectas, caché, noticias y conservación ante fallos. El emulador verifica acceso público por ID y denegación de listados/escrituras. El navegador comprueba 320–1440 px, sticky bajo la cabecera móvil, todas las columnas de clasificación, aislamiento de temporadas, carga/vacío/error/reintento, teclado, enlaces antiguos y compartir únicamente imagen.
