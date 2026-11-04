# SportAPI: resultados rápidos

Integración activa en backend cuando existe el repository secret `SPORTAPI_KEY`. No se coloca ninguna clave en `VITE_`, el frontend ni los logs. El contrato se verificó en la [documentación oficial](https://sportapi.ai/docs), su [OpenAPI](https://sportapi.ai/api/openapi.json), [precios](https://sportapi.ai/pricing) y [condiciones](https://sportapi.ai/terms) el 4 de noviembre de 2026. La documentación pública se pudo consultar; las llamadas autenticadas y el retraso real deben confirmarse en GitHub Actions, porque la clave solo está guardada allí.

## Funcionamiento

- `Update live football scores` ejecuta `npm run sync:live` cada diez minutos, en los minutos 03, 13, 23, 33, 43 y 53 UTC, y admite ejecución manual. Al subir la integración o ejecutarla manualmente, hace además una consulta de diagnóstico de la fecha actual para comprobar el acceso aunque no haya partidos cercanos. Comparte la exclusión mutua `football-sync` con la sincronización completa.
- Lee los tres documentos agregados de la temporada actual. Si no hay partidos entre los quince minutos previos al inicio y las ocho horas siguientes, no hace ninguna petición a SportAPI. Los resultados ya finalizados por Football-Data se excluyen; los adelantados por SportAPI se revisan hasta cuatro horas después del inicio para posibles correcciones.
- Consulta `https://sportapi.ai/api/fixtures/date/YYYY-MM-DD` con `X-Api-Key`. La fecha es la del calendario CET/CEST del proveedor; los encuentros se asocian por `kickoff_utc`. Una consulta por fecha sirve para todas las competiciones y usuarios, con un máximo de tres fechas por ejecución.
- Liga española: ID 1; Champions: 18; Premier: 24, según los ejemplos y catálogo publicados. Se exigen ambos equipos con alias explícitos, localía, competición, hora con diferencia máxima de diez minutos y una coincidencia única. Los IDs de Football-Data siguen siendo los IDs internos y el ID externo se conserva en `sportApiId`. Una coincidencia ambigua o ausente no cambia el encuentro; el log cuenta las coincidencias verificadas.
- Publica `LIVE` y `HT` solo con minutos reglamentarios reconocidos. Solo `FT`, con marcador entero válido, sin tanda y después de noventa minutos desde el inicio, pasa a `FINISHED`. Los estados `AET`, `PENS`, minutos de prórroga o datos obsoletos no se utilizan para puntuar. Football-Data sigue proporcionando el resultado reglamentario de esas eliminatorias.
- Las fechas de inicio, rondas y plazos de entrega proceden de Football-Data y no se modifican desde esta tarea. Los resultados rápidos se identifican como SportAPI. Una respuesta retrasada de Football-Data no reabre el encuentro; su resultado final válido y sus correcciones posteriores tienen prioridad.
- Guarda únicamente los cambios en `matches` y en los calendarios agregados. No crea listeners, consultas por usuario ni nuevas lecturas de detalle en la aplicación. La web conserva su caché y revisión del calendario cada cinco minutos mientras está visible.
- Al aparecer un resultado final, calcula los puntos en el backend con el proceso idempotente existente. `scoringPending` permite reintentar ese cálculo si una ejecución se interrumpe después de publicar el marcador. Las ejecuciones sin cambios no vuelven a escribir partidos ni clasificaciones.
- La sincronización completa mantiene sus doce ejecuciones cada dos horas más las dos de las 21:10 y 23:00 peninsulares. También comprueba SportAPI al terminar, cuando existe su clave. Noticias, plantillas y estadísticas ESPN conservan sus tareas y cachés actuales: esta integración incorpora resultados, no sustituye aún esas fichas.

## Cuotas y fallos

El plan Free publica 2.000 peticiones/día y 14.000/mes UTC desde el 1 de noviembre de 2026. Límites internos: **1.800 intentos en una ventana móvil de 24 horas y 12.000 por mes UTC**, con margen respecto del proveedor. `providerBudgets/sportapi` reserva transaccionalmente las peticiones antes de enviarlas. Cuenta fallos y reservas sin utilizar, y bloquea el gasto repetido del mismo trabajo. El array de reservas queda sin indexar y la colección continúa sin acceso desde el cliente.

Se reserva solo el número de fechas que se va a consultar, hasta tres, sin consumir un bloque fijo de cuarenta. No hay reintentos HTTP automáticos. Un error detiene el resto de peticiones de esa ejecución; 401/403/429 se registran sin cuerpos ni claves y la tarea rápida informa de fallo. Se conservan los datos anteriores. La cuota solo contabiliza esta aplicación; el uso de la misma clave fuera de ella puede agotar antes la cuota real. Los encabezados de cuota a cero detienen nuevas llamadas.

Sin partidos no hay llamadas al proveedor, pero cada tarea ligera realiza tres lecturas de calendario: hasta unas 432 lecturas diarias para su programación de diez minutos, además de las de puntuación/cuota cuando corresponda. Una consulta de una fecha cada diez minutos durante seis horas son 36 peticiones/día para los tres torneos juntos, antes de otras fechas o tareas completas.

GitHub Actions puede retrasar o saltarse ejecuciones. La fuente anuncia resultados renovados cada minuto, pero nuestra frecuencia objetivo es diez minutos, más el tiempo de la tarea, la publicación del proveedor y hasta cinco minutos de caché de la web. No se promete actualización inmediata al pitido final. No se mantienen conexiones WebSocket ni se ejecuta el proveedor desde los móviles.

## Activación y comprobación

1. Crear el repository secret `SPORTAPI_KEY`, conservando `FIREBASE_SERVICE_ACCOUNT` y `FOOTBALL_DATA_TOKEN`.
2. Esperar a `Deploy frontend` y a las tareas de sincronización disparadas por el cambio. El índice de reservas se despliega con los demás índices.
3. En Actions → **Update live football scores** → **Run workflow**, revisar `SportAPI YYYY-MM-DD: … coincidencias verificadas` y el resumen de peticiones y partidos. Fuera de la ventana de partidos puede ser correcto ver cero consultas.
4. Un HTTP 401/403 requiere revisar la clave o el acceso; un 429, revisar los consumos diarios/mensuales. No pegar credenciales en incidencias ni logs.

Las pruebas locales cubren el cliente HTTP con respuestas simuladas, alias y rechazo de coincidencias, fechas, cuotas, prórroga/penaltis y prioridad de fuentes. Las pruebas del emulador verifican publicación, puntos de ambos modos, repetición sin escrituras, recuperación del cálculo tras fallos y protección de resultados rápidos frente al calendario retrasado.
